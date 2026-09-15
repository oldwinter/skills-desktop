import {
  isValidSkillName,
  readSkillFrontmatter,
  renderStudioPreview,
  STUDIO_MAX_DRAFT_TEXT_LENGTH,
  validateSkillTree,
  type Result,
  type StudioTreeEntry,
  type StudioValidation,
} from "@skills-desktop/skills-runtime";

import { MAX_STUDIO_GRANTS } from "../../contracts/workspace.js";
import type {
  PublicStudioDraft,
  PublicStudioGrant,
  PublicStudioState,
  RendererError,
} from "../../contracts/workspace.js";
import {
  STUDIO_DRAFT_SCHEMA_VERSION,
  type StudioDraftRecord,
  type StudioDraftRecords,
} from "../persistence/studio-draft-records.js";
import type { FolderPick } from "./publication.js";

/**
 * ADR 0018 Studio coordinator. Owns every filesystem fact the renderer must
 * never see: canonical roots behind opaque grants, observed trees, Draft
 * bytes on disk, and the export destination. A grant authorizes only its
 * named Studio operation for the endpoint that opened it and dies with that
 * endpoint, on explicit release, or at shutdown; grants never persist.
 */

export interface StudioExportFile {
  readonly bytes: Uint8Array;
  readonly path: string;
}

export interface StudioHost {
  /** Native directory dialog; returns the canonical root plus a label. */
  chooseSkillFolder(): Promise<FolderPick>;
  /** Native directory dialog for the parent of a new export directory. */
  chooseExportParent(): Promise<FolderPick>;
  /** Observes `<root>/**` without following links; bounded and inert. */
  readTree(
    root: string,
  ): Promise<Result<readonly StudioTreeEntry[], RendererError>>;
  /**
   * Writes `<parent>/<name>` atomically: owned sibling temporary tree,
   * verify, flush, then no-replace rename. Never touches an existing path.
   */
  exportSkill(
    parent: string,
    name: string,
    files: readonly StudioExportFile[],
  ): Promise<Result<{ readonly fileCount: number }, RendererError>>;
}

type RequestValue = { readonly operationId: string };
type RequestResult = Result<RequestValue, RendererError>;

export interface StudioCoordinatorOptions {
  readonly clock: () => Date;
  readonly drafts: StudioDraftRecords;
  readonly host?: StudioHost;
  readonly id: () => string;
  readonly onChange: () => void;
}

export interface StudioCoordinator {
  /** True while a dialog, tree observation, or export is running. */
  busy(): boolean;
  createDraft(
    ownerEndpointId: string,
    grantId?: string,
  ): Promise<RequestResult>;
  deleteDraft(
    draftId: string,
    expectedRevision: number,
  ): Promise<RequestResult>;
  exportDraft(draftId: string): Promise<RequestResult>;
  /** Restores Drafts; quarantined ids are reported without content. */
  initialize(): Promise<void>;
  open(ownerEndpointId: string): Promise<RequestResult>;
  preview(draftId: string): Promise<RequestResult>;
  release(ownerEndpointId: string, grantId: string): Promise<RequestResult>;
  /** Expires every grant the endpoint held. Called on renderer teardown. */
  releaseGrantsFor(ownerEndpointId: string): void;
  saveDraft(
    draftId: string,
    expectedRevision: number,
    skillMd: string,
  ): Promise<RequestResult>;
  shutdown(): Promise<void>;
  state(): PublicStudioState;
  validate(ownerEndpointId: string, grantId: string): Promise<RequestResult>;
}

interface Grant {
  readonly ownerEndpointId: string;
  readonly public: PublicStudioGrant;
  readonly root: string;
  tree: readonly StudioTreeEntry[];
}

const encoder = new TextEncoder();

function publicError<Code extends RendererError["code"]>(
  code: Code,
  message: string,
  phase: string,
  retryable = false,
  effects: RendererError["effects"] = "none",
): RendererError {
  return { code, effects, message, phase, retryable };
}

function failure(error: RendererError): RequestResult {
  return { error, ok: false };
}

function unavailable(): RendererError {
  return publicError(
    "studio_unavailable",
    "Studio is unavailable in this session.",
    "studio",
  );
}

function busyError(): RendererError {
  return publicError(
    "mutation_conflict",
    "Another Studio step is already running.",
    "studio",
    true,
  );
}

function grantInvalid(): RendererError {
  return publicError(
    "studio_grant_invalid",
    "That folder grant is not held by this window.",
    "studio",
  );
}

function draftMissing(): RendererError {
  return publicError(
    "studio_draft_invalid",
    "That Draft does not exist.",
    "studio",
  );
}

function emptyState(available: boolean): PublicStudioState {
  return {
    activeOperationId: null,
    available,
    draftFailures: [],
    drafts: [],
    grants: [],
    lastError: null,
    lastExport: null,
    preview: null,
  };
}

/** Frontmatter `name` when it is a valid Skill name; empty otherwise. */
export function draftSkillName(skillMd: string): string {
  const frontmatter = readSkillFrontmatter(encoder.encode(skillMd));
  if (!frontmatter.ok || !isValidSkillName(frontmatter.value.name)) return "";
  return frontmatter.value.name;
}

export function validateDraft(skillMd: string): StudioValidation {
  const bytes = encoder.encode(skillMd);
  return validateSkillTree({
    directoryName: draftSkillName(skillMd),
    entries: [
      { bytes, kind: "file", path: "SKILL.md", size: bytes.byteLength },
    ],
  });
}

function projectDraft(record: StudioDraftRecord): PublicStudioDraft {
  return {
    createdAt: record.createdAt,
    id: record.id,
    name: record.name,
    revision: record.revision,
    skillMd: record.skillMd,
    updatedAt: record.updatedAt,
    validation: validateDraft(record.skillMd),
  };
}

const DEFAULT_SKILL_MD = `---
name: my-skill
description: Describe when an agent should use this Skill.
---

# My Skill

Explain the workflow this Skill teaches.
`;

export function createStudioCoordinator(
  options: StudioCoordinatorOptions,
): StudioCoordinator {
  const { clock, drafts, host, id } = options;
  let state = emptyState(host !== undefined);
  const grants = new Map<string, Grant>();
  const records = new Map<string, StudioDraftRecord>();
  let running = false;
  let draftQueue: Promise<unknown> = Promise.resolve();

  const update = (patch: Partial<PublicStudioState>) => {
    state = { ...state, ...patch };
    options.onChange();
  };

  const publicGrants = () => [...grants.values()].map(({ public: g }) => g);
  const publicDrafts = () =>
    [...records.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(projectDraft);

  const grantFor = (ownerEndpointId: string, grantId: string) => {
    const grant = grants.get(grantId);
    return grant !== undefined && grant.ownerEndpointId === ownerEndpointId
      ? grant
      : undefined;
  };

  const withRun = async (
    body: (operationId: string) => Promise<RequestResult>,
  ): Promise<RequestResult> => {
    if (running) return failure(busyError());
    running = true;
    const operationId = id();
    update({ activeOperationId: operationId, lastError: null });
    try {
      const result = await body(operationId);
      update({
        activeOperationId: null,
        lastError: result.ok ? null : result.error,
      });
      return result;
    } finally {
      running = false;
    }
  };

  const serialized = <Value>(body: () => Promise<Value>): Promise<Value> => {
    const next = draftQueue.then(body, body);
    draftQueue = next.catch(() => undefined);
    return next;
  };

  const observe = async (
    grant: Grant,
  ): Promise<Result<PublicStudioGrant, RendererError>> => {
    if (host === undefined) return { error: unavailable(), ok: false };
    const tree = await host.readTree(grant.root);
    if (!tree.ok) return tree;
    grant.tree = tree.value;
    const validation = validateSkillTree({
      directoryName: grant.public.label,
      entries: tree.value,
    });
    return { ok: true, value: { ...grant.public, validation } };
  };

  const finishDraftWrite = (
    record: StudioDraftRecord,
    operationId: string,
  ): RequestResult => {
    records.set(record.id, record);
    const preview =
      state.preview?.draftId === record.id
        ? {
            draftId: record.id,
            preview: renderStudioPreview(record.skillMd),
            renderedAt: clock().toISOString(),
            revision: record.revision,
          }
        : state.preview;
    update({ drafts: publicDrafts(), lastError: null, preview });
    return { ok: true, value: { operationId } };
  };

  return {
    state: () => structuredClone(state),

    busy: () => running,

    async initialize() {
      const restored = await drafts.restore();
      records.clear();
      for (const record of restored.drafts) records.set(record.id, record);
      update({
        draftFailures: [...restored.failures],
        drafts: publicDrafts(),
      });
    },

    async open(ownerEndpointId) {
      if (host === undefined) return failure(unavailable());
      if (grants.size >= MAX_STUDIO_GRANTS) {
        return failure(
          publicError(
            "studio_grant_invalid",
            `At most ${MAX_STUDIO_GRANTS} folders can be open in Studio.`,
            "studio",
          ),
        );
      }
      return withRun(async (operationId) => {
        const pick = await host.chooseSkillFolder();
        if (pick.status === "cancelled") {
          return { ok: true, value: { operationId } };
        }
        for (const existing of grants.values()) {
          if (existing.root === pick.path) {
            grants.delete(existing.public.id);
          }
        }
        const grant: Grant = {
          ownerEndpointId,
          public: {
            grantedAt: clock().toISOString(),
            id: id(),
            label: pick.label,
            purpose: "author",
            validation: validateSkillTree({
              directoryName: pick.label,
              entries: [],
            }),
          },
          root: pick.path,
          tree: [],
        };
        const observed = await observe(grant);
        if (!observed.ok) return failure(observed.error);
        grants.set(grant.public.id, { ...grant, public: observed.value });
        update({ grants: publicGrants() });
        return { ok: true, value: { operationId } };
      });
    },

    async validate(ownerEndpointId, grantId) {
      if (host === undefined) return failure(unavailable());
      const grant = grantFor(ownerEndpointId, grantId);
      if (grant === undefined) return failure(grantInvalid());
      return withRun(async (operationId) => {
        const observed = await observe(grant);
        if (!observed.ok) return failure(observed.error);
        grants.set(grantId, { ...grant, public: observed.value });
        update({ grants: publicGrants() });
        return { ok: true, value: { operationId } };
      });
    },

    async release(ownerEndpointId, grantId) {
      if (grantFor(ownerEndpointId, grantId) === undefined) {
        return failure(grantInvalid());
      }
      grants.delete(grantId);
      update({ grants: publicGrants(), lastError: null });
      return { ok: true, value: { operationId: id() } };
    },

    releaseGrantsFor(ownerEndpointId) {
      let changed = false;
      for (const [grantId, grant] of grants) {
        if (grant.ownerEndpointId === ownerEndpointId) {
          grants.delete(grantId);
          changed = true;
        }
      }
      if (changed) update({ grants: publicGrants() });
    },

    async createDraft(ownerEndpointId, grantId) {
      let skillMd = DEFAULT_SKILL_MD;
      if (grantId !== undefined) {
        const grant = grantFor(ownerEndpointId, grantId);
        if (grant === undefined) return failure(grantInvalid());
        const skillFile = grant.tree.find(
          (entry) => entry.path === "SKILL.md" && entry.kind === "file",
        );
        if (skillFile?.bytes === undefined) {
          return failure(
            publicError(
              "studio_validation_failed",
              "The granted folder has no readable SKILL.md to start from.",
              "studio",
            ),
          );
        }
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(
            skillFile.bytes,
          );
        } catch {
          return failure(
            publicError(
              "studio_validation_failed",
              "SKILL.md is not valid UTF-8.",
              "studio",
            ),
          );
        }
        if (text.length > STUDIO_MAX_DRAFT_TEXT_LENGTH) {
          return failure(
            publicError(
              "studio_draft_invalid",
              `SKILL.md exceeds ${STUDIO_MAX_DRAFT_TEXT_LENGTH} characters.`,
              "studio",
            ),
          );
        }
        skillMd = text;
      }
      return serialized(async () => {
        const now = clock().toISOString();
        const record: StudioDraftRecord = {
          createdAt: now,
          id: id(),
          name: draftSkillName(skillMd),
          revision: 1,
          schemaVersion: STUDIO_DRAFT_SCHEMA_VERSION,
          skillMd,
          updatedAt: now,
        };
        const stored = await drafts.put(record, null);
        if (!stored.ok) {
          update({ lastError: stored.error });
          return failure(stored.error);
        }
        return finishDraftWrite(record, id());
      });
    },

    async saveDraft(draftId, expectedRevision, skillMd) {
      if (skillMd.length > STUDIO_MAX_DRAFT_TEXT_LENGTH) {
        return failure(
          publicError(
            "studio_draft_invalid",
            `Draft text exceeds ${STUDIO_MAX_DRAFT_TEXT_LENGTH} characters.`,
            "studio",
          ),
        );
      }
      return serialized(async () => {
        const current = records.get(draftId);
        if (current === undefined) return failure(draftMissing());
        if (current.revision !== expectedRevision) {
          const error = publicError(
            "studio_draft_conflict",
            "The Draft changed since this window last loaded it.",
            "studio",
          );
          update({ lastError: error });
          return failure(error);
        }
        const record: StudioDraftRecord = {
          ...current,
          name: draftSkillName(skillMd),
          revision: current.revision + 1,
          skillMd,
          updatedAt: clock().toISOString(),
        };
        const stored = await drafts.put(record, expectedRevision);
        if (!stored.ok) {
          update({ lastError: stored.error });
          return failure(stored.error);
        }
        return finishDraftWrite(record, id());
      });
    },

    async deleteDraft(draftId, expectedRevision) {
      return serialized(async () => {
        const current = records.get(draftId);
        if (current === undefined) return failure(draftMissing());
        const deleted = await drafts.delete(draftId, expectedRevision);
        if (!deleted.ok) {
          update({ lastError: deleted.error });
          return failure(deleted.error);
        }
        records.delete(draftId);
        update({
          drafts: publicDrafts(),
          lastError: null,
          preview: state.preview?.draftId === draftId ? null : state.preview,
        });
        return { ok: true, value: { operationId: id() } };
      });
    },

    async preview(draftId) {
      const record = records.get(draftId);
      if (record === undefined) return failure(draftMissing());
      update({
        lastError: null,
        preview: {
          draftId,
          preview: renderStudioPreview(record.skillMd),
          renderedAt: clock().toISOString(),
          revision: record.revision,
        },
      });
      return { ok: true, value: { operationId: id() } };
    },

    async exportDraft(draftId) {
      if (host === undefined) return failure(unavailable());
      const record = records.get(draftId);
      if (record === undefined) return failure(draftMissing());
      const validation = validateDraft(record.skillMd);
      if (!validation.ok || record.name === "") {
        return failure(
          publicError(
            "studio_validation_failed",
            "Fix every validation error before exporting the Draft.",
            "export",
          ),
        );
      }
      return withRun(async (operationId) => {
        const pick = await host.chooseExportParent();
        if (pick.status === "cancelled") {
          return { ok: true, value: { operationId } };
        }
        const exported = await host.exportSkill(pick.path, record.name, [
          { bytes: encoder.encode(record.skillMd), path: "SKILL.md" },
        ]);
        if (!exported.ok) return failure(exported.error);
        update({
          lastExport: {
            destinationLabel: pick.label,
            draftId,
            fileCount: exported.value.fileCount,
            name: record.name,
            writtenAt: clock().toISOString(),
          },
        });
        return { ok: true, value: { operationId } };
      });
    },

    async shutdown() {
      grants.clear();
      state = { ...state, grants: [] };
    },
  };
}
