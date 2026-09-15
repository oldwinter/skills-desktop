import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  STUDIO_MAX_DRAFT_TEXT_LENGTH,
  WELL_KNOWN_LIMITS,
  type Result,
} from "@skills-desktop/skills-runtime";

import type { RendererError } from "../../contracts/workspace.js";

/**
 * Studio Draft records (ADR 0018). Every Draft is its own versioned file so a
 * corrupt or newer record is quarantined on its own without hiding unrelated
 * work. Writes are compare-and-swap on `revision` and land by atomic
 * replacement of a same-directory temporary file. Draft text is sensitive:
 * failures report the Draft id and a reason, never content.
 */
export const STUDIO_DRAFT_SCHEMA_VERSION = 1 as const;
export const MAX_STUDIO_DRAFTS = 32;
export const STUDIO_DRAFT_STORE_NAME = "studio-drafts";

const DRAFT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const studioDraftRecordSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().regex(DRAFT_ID),
    /** Skill directory name the Draft exports to; empty until frontmatter parses. */
    name: z.string().max(WELL_KNOWN_LIMITS.maxSkillNameLength),
    revision: z.number().int().positive(),
    schemaVersion: z.literal(STUDIO_DRAFT_SCHEMA_VERSION),
    skillMd: z.string().max(STUDIO_MAX_DRAFT_TEXT_LENGTH),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type StudioDraftRecord = z.infer<typeof studioDraftRecordSchema>;

export interface StudioDraftFailure {
  readonly draftId: string;
  readonly reason: "corrupt" | "newer-schema" | "unreadable";
}

export interface RestoredStudioDrafts {
  readonly drafts: readonly StudioDraftRecord[];
  readonly failures: readonly StudioDraftFailure[];
}

export interface StudioDraftRecords {
  /** Loads every readable Draft; unreadable ones are quarantined and listed. */
  restore(): Promise<RestoredStudioDrafts>;
  /**
   * Stores `record` when the stored revision equals `expectedRevision`
   * (`null` means "must not exist yet"). Conflicts fail closed.
   */
  put(
    record: StudioDraftRecord,
    expectedRevision: number | null,
  ): Promise<Result<void, RendererError>>;
  delete(
    draftId: string,
    expectedRevision: number,
  ): Promise<Result<void, RendererError>>;
}

function conflict(message: string): Result<never, RendererError> {
  return {
    error: {
      code: "studio_draft_conflict",
      effects: "none",
      message,
      phase: "studio",
      retryable: false,
    },
    ok: false,
  };
}

function persistFailed(message: string): Result<never, RendererError> {
  return {
    error: {
      code: "persist_failed",
      effects: "possible",
      message,
      phase: "studio",
      retryable: true,
    },
    ok: false,
  };
}

function checkRecord(record: StudioDraftRecord): RendererError | undefined {
  const parsed = studioDraftRecordSchema.safeParse(record);
  if (parsed.success) return undefined;
  return {
    code: "studio_draft_invalid",
    effects: "none",
    message: "The Draft record is malformed.",
    phase: "studio",
    retryable: false,
  };
}

export function createMemoryStudioDraftRecords(
  initial: readonly StudioDraftRecord[] = [],
): StudioDraftRecords {
  const drafts = new Map(initial.map((draft) => [draft.id, draft]));
  return {
    async delete(draftId, expectedRevision) {
      const current = drafts.get(draftId);
      if (current === undefined || current.revision !== expectedRevision) {
        return conflict("The Draft changed or no longer exists.");
      }
      drafts.delete(draftId);
      return { ok: true, value: undefined };
    },
    async put(record, expectedRevision) {
      const invalid = checkRecord(record);
      if (invalid !== undefined) return { error: invalid, ok: false };
      const current = drafts.get(record.id);
      if ((current?.revision ?? null) !== expectedRevision) {
        return conflict("The Draft was changed elsewhere.");
      }
      if (current === undefined && drafts.size >= MAX_STUDIO_DRAFTS) {
        return conflict(`At most ${MAX_STUDIO_DRAFTS} Drafts are kept.`);
      }
      drafts.set(record.id, structuredClone(record));
      return { ok: true, value: undefined };
    },
    async restore() {
      return { drafts: structuredClone([...drafts.values()]), failures: [] };
    },
  };
}

export interface JsonStudioDraftRecordsOptions {
  readonly directory: string;
  readonly id: () => string;
}

export function createJsonStudioDraftRecords(
  options: JsonStudioDraftRecordsOptions,
): StudioDraftRecords {
  const known = new Map<string, number>();
  let loaded = false;

  const pathFor = (draftId: string) =>
    join(options.directory, `${draftId}.json`);

  const quarantine = async (draftId: string) => {
    await rename(
      pathFor(draftId),
      join(options.directory, `${draftId}.quarantine-${options.id()}.json`),
    ).catch(() => undefined);
  };

  const readOne = async (
    draftId: string,
  ): Promise<
    | { readonly record: StudioDraftRecord; readonly status: "ok" }
    | {
        readonly reason: StudioDraftFailure["reason"];
        readonly status: "failed";
      }
  > => {
    let text: string;
    try {
      text = await readFile(pathFor(draftId), "utf8");
    } catch {
      return { reason: "unreadable", status: "failed" };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { reason: "corrupt", status: "failed" };
    }
    const version =
      typeof json === "object" && json !== null && "schemaVersion" in json
        ? (json as { schemaVersion: unknown }).schemaVersion
        : undefined;
    if (typeof version === "number" && version > STUDIO_DRAFT_SCHEMA_VERSION) {
      return { reason: "newer-schema", status: "failed" };
    }
    const parsed = studioDraftRecordSchema.safeParse(json);
    if (!parsed.success || parsed.data.id !== draftId) {
      return { reason: "corrupt", status: "failed" };
    }
    return { record: parsed.data, status: "ok" };
  };

  const ensureLoaded = async () => {
    if (loaded) return;
    await mkdir(options.directory, { mode: 0o700, recursive: true });
    loaded = true;
  };

  const writeAtomic = async (draftId: string, contents: string) => {
    const temporary = join(
      options.directory,
      `.${draftId}.${options.id()}.tmp`,
    );
    let owns = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      owns = true;
      try {
        await handle.writeFile(contents, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, pathFor(draftId));
      owns = false;
    } finally {
      if (owns) await unlink(temporary).catch(() => undefined);
    }
  };

  return {
    async delete(draftId, expectedRevision) {
      await ensureLoaded();
      if (!DRAFT_ID.test(draftId)) {
        return conflict("The Draft changed or no longer exists.");
      }
      const current = await readOne(draftId);
      if (
        current.status !== "ok" ||
        current.record.revision !== expectedRevision
      ) {
        return conflict("The Draft changed or no longer exists.");
      }
      try {
        await unlink(pathFor(draftId));
      } catch {
        return persistFailed("The Draft could not be deleted.");
      }
      known.delete(draftId);
      return { ok: true, value: undefined };
    },

    async put(record, expectedRevision) {
      await ensureLoaded();
      const invalid = checkRecord(record);
      if (invalid !== undefined) return { error: invalid, ok: false };
      const current = await readOne(record.id);
      const currentRevision =
        current.status === "ok" ? current.record.revision : null;
      if (current.status === "failed" && current.reason !== "unreadable") {
        return conflict(
          "The stored Draft is unreadable; restart to quarantine it.",
        );
      }
      if (currentRevision !== expectedRevision) {
        return conflict("The Draft was changed elsewhere.");
      }
      if (currentRevision === null && known.size >= MAX_STUDIO_DRAFTS) {
        return conflict(`At most ${MAX_STUDIO_DRAFTS} Drafts are kept.`);
      }
      try {
        await writeAtomic(record.id, `${JSON.stringify(record, null, 2)}\n`);
      } catch {
        return persistFailed("The Draft could not be saved.");
      }
      known.set(record.id, record.revision);
      return { ok: true, value: undefined };
    },

    async restore() {
      await ensureLoaded();
      let names: string[];
      try {
        names = await readdir(options.directory);
      } catch {
        return { drafts: [], failures: [] };
      }
      const drafts: StudioDraftRecord[] = [];
      const failures: StudioDraftFailure[] = [];
      for (const name of names.sort()) {
        if (!name.endsWith(".json") || name.includes(".quarantine-")) continue;
        if (name.startsWith(".")) continue;
        const draftId = name.slice(0, -".json".length);
        if (!DRAFT_ID.test(draftId)) continue;
        const result = await readOne(draftId);
        if (result.status === "ok") {
          drafts.push(result.record);
          known.set(draftId, result.record.revision);
          continue;
        }
        await quarantine(draftId);
        failures.push({ draftId, reason: result.reason });
      }
      return { drafts, failures };
    },
  };
}
