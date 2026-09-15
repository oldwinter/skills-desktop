import {
  PUBLICATION_PLAN_SCHEMA_VERSION,
  PUBLICATION_PLAN_TTL_MS,
  exportWellKnownTree,
  sanitizePublicationRemote,
  sealPublicationPlan,
  validatePublicationBranch,
  type PublicError,
  type PublicationPlanBody,
  type PublicationPlanV1,
  type Result,
  type WellKnownCodec,
  type WellKnownExport,
  type WellKnownExportFile,
  type WellKnownSkillInput,
} from "@skills-desktop/skills-runtime";

import type {
  PublicPublicationState,
  RendererError,
} from "../../contracts/workspace.js";
import type {
  GitPublisher,
  PreparedPublication,
} from "../git/git-publisher.js";
import type { PublicationGuardRecord } from "../persistence/publication-guard-records.js";

/**
 * ADR 0019 / ADR 0020 publication coordinator. Owns every Git and filesystem
 * fact the renderer must never see: the chosen source folder path, the export
 * bytes, the prepared temporary root, and the sealed plan. The renderer only
 * ever names an opaque grant or plan id and supplies remote text plus a branch
 * name; everything else is derived here and validated in main.
 */

export type FolderPick =
  | { readonly status: "cancelled" }
  | {
      readonly label: string;
      readonly path: string;
      readonly status: "picked";
    };

export type PublicationHostErrorCode = "export_invalid";
export type PublicationHostError = PublicError<PublicationHostErrorCode>;

export interface PublicationHost {
  /** Native folder dialog for the export source. Never returns file bytes. */
  chooseSourceFolder(): Promise<FolderPick>;
  /** Native folder dialog for export-only output. */
  chooseExportDestination(): Promise<FolderPick>;
  /** Reads `<path>/<skill>/**` into bounded Skill inputs. */
  readSourceFolder(
    path: string,
  ): Promise<Result<readonly WellKnownSkillInput[], PublicationHostError>>;
  /** Writes the exact export tree into a new or empty destination. */
  writeExport(
    destination: string,
    files: readonly WellKnownExportFile[],
  ): Promise<Result<void, PublicationHostError>>;
}

type RequestValue = { readonly operationId: string };
type RequestResult = Result<RequestValue, RendererError>;

export interface PublicationCoordinatorOptions {
  readonly clock: () => Date;
  readonly codec: WellKnownCodec;
  readonly commitGuard: (
    guard: PublicationGuardRecord | null,
  ) => Promise<Result<void, RendererError>>;
  readonly host?: PublicationHost;
  readonly id: () => string;
  readonly initialGuard?: PublicationGuardRecord | null;
  /** Called after every state change so the owner can republish snapshots. */
  readonly onChange: () => void;
  readonly publisher?: GitPublisher;
}

export interface PublicationCoordinator {
  approve(planId: string): Promise<RequestResult>;
  chooseSource(): Promise<RequestResult>;
  discard(planId: string): Promise<RequestResult>;
  export(): Promise<RequestResult>;
  /** True while any dialog, export, prepare, push, or readback is running. */
  busy(): boolean;
  /** True while a durable Guard is retained and awaits reconciliation. */
  guarded(): boolean;
  /** Returns the current sealed plan when `planId` names it and it is unexpired. */
  planForReview(planId: string): PublicationPlanV1 | undefined;
  prepare(remote: string, branch: string): Promise<RequestResult>;
  reconcile(): Promise<RequestResult>;
  /** Adopts a Guard restored from durable records at startup. */
  restoreGuard(guard: PublicationGuardRecord | null): void;
  /** Discards any prepared temporary root. Idempotent. */
  shutdown(): Promise<void>;
  state(): PublicPublicationState;
}

function publicError<Code extends RendererError["code"]>(
  code: Code,
  message: string,
  phase: string,
  retryable: boolean,
  effects: RendererError["effects"] = "none",
): RendererError {
  return { code, effects, message, phase, retryable };
}

function failure(error: RendererError): RequestResult {
  return { error, ok: false };
}

/** The schema already pins `ref` to `refs/heads/*`; this narrows the type. */
function planRef(plan: PublicationPlanV1): `refs/heads/${string}` {
  if (!plan.ref.startsWith("refs/heads/")) {
    throw new Error("Publication plan ref is outside refs/heads.");
  }
  return plan.ref as `refs/heads/${string}`;
}

function unavailable(): RendererError {
  return publicError(
    "publication_unavailable",
    "Publication is unavailable in this session.",
    "publication",
    false,
  );
}

function busy(): RendererError {
  return publicError(
    "mutation_conflict",
    "Another publication step is already running.",
    "publication",
    true,
  );
}

function emptyState(
  available: boolean,
  guard: PublicationGuardRecord | null,
): PublicPublicationState {
  return {
    activeOperationId: null,
    available,
    export: null,
    guard,
    lastError: null,
    lastOutcome: null,
    phase: "idle",
    plan: null,
    source: null,
  };
}

export function createPublicationCoordinator(
  options: PublicationCoordinatorOptions,
): PublicationCoordinator {
  const { clock, codec, commitGuard, host, id, publisher } = options;
  let state = emptyState(host !== undefined, options.initialGuard ?? null);
  let sourcePath: string | undefined;
  let currentExport: WellKnownExport | undefined;
  let prepared: PreparedPublication | undefined;
  let plan: PublicationPlanV1 | undefined;
  let running = false;

  const update = (patch: Partial<PublicPublicationState>) => {
    state = { ...state, ...patch };
    options.onChange();
  };

  const restingPhase = (): PublicPublicationState["phase"] =>
    plan === undefined ? "idle" : "planned";

  const discardPrepared = async () => {
    const current = prepared;
    prepared = undefined;
    plan = undefined;
    if (current !== undefined && publisher !== undefined) {
      await publisher.discard(current);
    }
  };

  const planIs = (planId: string): PublicationPlanV1 | undefined =>
    plan !== undefined &&
    plan.id === planId &&
    clock().getTime() < Date.parse(plan.expiresAt)
      ? plan
      : undefined;

  const persistGuard = async (
    guard: PublicationGuardRecord | null,
  ): Promise<RendererError | undefined> => {
    const committed = await commitGuard(guard);
    if (!committed.ok) return committed.error;
    state = { ...state, guard: structuredClone(guard) };
    return undefined;
  };

  const withRun = async (
    phase: PublicPublicationState["phase"],
    body: (operationId: string) => Promise<RequestResult>,
  ): Promise<RequestResult> => {
    if (running) return failure(busy());
    running = true;
    const operationId = id();
    update({ activeOperationId: operationId, lastError: null, phase });
    try {
      const result = await body(operationId);
      update({
        activeOperationId: null,
        lastError: result.ok ? null : result.error,
        phase: restingPhase(),
      });
      return result;
    } finally {
      running = false;
    }
  };

  return {
    state: () => structuredClone(state),

    busy: () => running,

    guarded: () => state.guard !== null,

    planForReview: planIs,

    restoreGuard(guard) {
      if (running) return;
      update({ guard: structuredClone(guard) });
    },

    async chooseSource() {
      if (host === undefined) return failure(unavailable());
      return withRun("choosing", async (operationId) => {
        const pick = await host.chooseSourceFolder();
        if (pick.status === "cancelled") {
          return { ok: true, value: { operationId } };
        }
        const skills = await host.readSourceFolder(pick.path);
        if (!skills.ok) return failure(skills.error);
        const exported = exportWellKnownTree(skills.value, codec);
        if (!exported.ok) {
          return failure(
            publicError(
              "export_invalid",
              exported.error.message,
              "export",
              false,
            ),
          );
        }
        await discardPrepared();
        sourcePath = pick.path;
        currentExport = exported.value;
        update({
          export: null,
          lastOutcome: null,
          plan: null,
          source: {
            chosenAt: clock().toISOString(),
            exporterVersion: exported.value.exporterVersion,
            fileCount: exported.value.files.length,
            grantId: id(),
            label: pick.label,
            skills: exported.value.index.skills.map(({ name }) => name),
            treeDigest: exported.value.treeDigest,
          },
        });
        return { ok: true, value: { operationId } };
      });
    },

    async export() {
      if (host === undefined) return failure(unavailable());
      const source = state.source;
      const files = currentExport?.files;
      if (source === null || files === undefined || sourcePath === undefined) {
        return failure(
          publicError(
            "export_invalid",
            "Choose a source folder before exporting.",
            "export",
            false,
          ),
        );
      }
      return withRun("exporting", async (operationId) => {
        const pick = await host.chooseExportDestination();
        if (pick.status === "cancelled") {
          return { ok: true, value: { operationId } };
        }
        const written = await host.writeExport(pick.path, files);
        if (!written.ok) return failure(written.error);
        update({
          export: {
            destinationLabel: pick.label,
            fileCount: files.length,
            treeDigest: source.treeDigest,
            writtenAt: clock().toISOString(),
          },
        });
        return { ok: true, value: { operationId } };
      });
    },

    async prepare(remoteInput, branchInput) {
      if (host === undefined || publisher === undefined) {
        return failure(
          publisher === undefined && host !== undefined
            ? publicError(
                "git_unavailable",
                "Git publication is unavailable in this session; export-only remains available.",
                "publication",
                false,
              )
            : unavailable(),
        );
      }
      if (state.guard !== null) {
        return failure(
          publicError(
            "publication_guarded",
            "A prior publication needs reconciliation before another push can be planned.",
            "publication",
            false,
          ),
        );
      }
      const source = state.source;
      const exported = currentExport;
      if (source === null || exported === undefined) {
        return failure(
          publicError(
            "export_invalid",
            "Choose a source folder before planning a publication.",
            "prepare",
            false,
          ),
        );
      }
      const remote = sanitizePublicationRemote(remoteInput);
      if (!remote.ok) return failure(remote.error);
      const branch = validatePublicationBranch(branchInput);
      if (!branch.ok) return failure(branch.error);
      return withRun("preparing", async (operationId) => {
        await discardPrepared();
        update({ plan: null });
        const result = await publisher.prepare({
          files: exported.files,
          ref: branch.value.ref,
          remote: remote.value,
          treeDigest: exported.treeDigest,
        });
        if (!result.ok) return failure(result.error);
        const createdAt = clock();
        const body: PublicationPlanBody = {
          base: result.value.base,
          branch: branch.value.branch,
          candidateCommit: result.value.candidateCommit,
          createdAt: createdAt.toISOString(),
          expiresAt: new Date(
            createdAt.getTime() + PUBLICATION_PLAN_TTL_MS,
          ).toISOString(),
          exporterVersion: exported.exporterVersion,
          files: [...result.value.files],
          id: id(),
          ref: branch.value.ref,
          remote: remote.value,
          schemaVersion: PUBLICATION_PLAN_SCHEMA_VERSION,
          skills: [...source.skills],
          treeDigest: exported.treeDigest,
        };
        prepared = result.value;
        plan = sealPublicationPlan(body, codec.sha256Hex);
        update({ lastOutcome: null, plan: structuredClone(plan) });
        return { ok: true, value: { operationId } };
      });
    },

    async approve(planId) {
      const reviewed = planIs(planId);
      const exported = currentExport;
      if (
        reviewed === undefined ||
        prepared === undefined ||
        exported === undefined ||
        publisher === undefined
      ) {
        await discardPrepared();
        update({ phase: restingPhase(), plan: null });
        return failure(
          publicError(
            "publication_invalid",
            "The publication plan is unavailable for approval.",
            "approve",
            false,
          ),
        );
      }
      if (state.guard !== null) {
        return failure(
          publicError(
            "publication_guarded",
            "A prior publication needs reconciliation before another push.",
            "approve",
            false,
          ),
        );
      }
      const current = prepared;
      return withRun("pushing", async (operationId) => {
        const committedAt = clock().toISOString();
        const guardError = await persistGuard({
          committedAt,
          lastReadback: null,
          lastReadbackAt: null,
          phase: "pushing",
          plan: reviewed,
        });
        if (guardError !== undefined) return failure(guardError);
        const pushed = await publisher.push({
          files: exported.files,
          prepared: current,
          ref: planRef(reviewed),
          remote: reviewed.remote,
        });
        const recordedAt = clock().toISOString();
        if (!pushed.ok) {
          if (pushed.error.code === "git_unavailable") {
            // Git may have died mid-transport; keep the Guard until readback.
            const retained = await persistGuard({
              committedAt,
              lastReadback: "uncertain",
              lastReadbackAt: recordedAt,
              phase: "uncertain",
              plan: reviewed,
            });
            await discardPrepared();
            update({ plan: null });
            return failure(
              retained ?? {
                ...pushed.error,
                effects: "possible",
              },
            );
          }
          // Revalidation, drift, and pre-push reachability all fail closed
          // before any transport, so the Guard can be released.
          const released = await persistGuard(null);
          await discardPrepared();
          update({ plan: null });
          return failure(released ?? pushed.error);
        }
        const outcome = pushed.value;
        const retainGuard = outcome.status === "uncertain";
        const guardError2 = await persistGuard(
          retainGuard
            ? {
                committedAt,
                lastReadback: "uncertain",
                lastReadbackAt: recordedAt,
                phase: "uncertain",
                plan: reviewed,
              }
            : null,
        );
        await discardPrepared();
        update({
          lastOutcome: {
            branch: reviewed.branch,
            candidateCommit: reviewed.candidateCommit,
            planId: reviewed.id,
            recordedAt,
            remote: reviewed.remote,
            status: outcome.status,
            ...(outcome.observed === undefined
              ? {}
              : { observedCommit: outcome.observed }),
          },
          plan: null,
        });
        if (guardError2 !== undefined) return failure(guardError2);
        return { ok: true, value: { operationId } };
      });
    },

    async discard(planId) {
      if (running) return failure(busy());
      if (plan !== undefined && plan.id !== planId) {
        return failure(
          publicError(
            "publication_invalid",
            "That publication plan is not the current plan.",
            "discard",
            false,
          ),
        );
      }
      await discardPrepared();
      update({ lastError: null, phase: restingPhase(), plan: null });
      return { ok: true, value: { operationId: id() } };
    },

    async reconcile() {
      const guard = state.guard;
      if (guard === null) {
        return failure(
          publicError(
            "publication_invalid",
            "No publication needs reconciliation.",
            "reconcile",
            false,
          ),
        );
      }
      if (publisher === undefined) {
        return failure(
          publicError(
            "git_unavailable",
            "Git is unavailable; the publication cannot be read back yet.",
            "reconcile",
            true,
          ),
        );
      }
      return withRun("reconciling", async (operationId) => {
        const readback = await publisher.readback({
          base: guard.plan.base,
          candidateCommit: guard.plan.candidateCommit,
          ref: planRef(guard.plan),
          remote: guard.plan.remote,
        });
        const recordedAt = clock().toISOString();
        const guardError = await persistGuard(
          readback.status === "uncertain"
            ? {
                ...guard,
                lastReadback: "uncertain",
                lastReadbackAt: recordedAt,
                phase: "uncertain",
              }
            : null,
        );
        update({
          lastOutcome: {
            branch: guard.plan.branch,
            candidateCommit: guard.plan.candidateCommit,
            planId: guard.plan.id,
            recordedAt,
            remote: guard.plan.remote,
            status: readback.status,
            ...(readback.observed === undefined
              ? {}
              : { observedCommit: readback.observed }),
          },
        });
        if (guardError !== undefined) return failure(guardError);
        if (readback.status === "uncertain") {
          return failure(
            publicError(
              "remote_unreachable",
              "The remote branch could not be read; the publication remains guarded.",
              "reconcile",
              true,
              "possible",
            ),
          );
        }
        return { ok: true, value: { operationId } };
      });
    },

    async shutdown() {
      await discardPrepared();
    },
  };
}
