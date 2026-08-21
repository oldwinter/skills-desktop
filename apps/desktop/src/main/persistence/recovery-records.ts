import { constants } from "node:fs";
import {
  copyFile as nodeCopyFile,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  rename as nodeRename,
  unlink as nodeUnlink,
} from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type {
  Inventory,
  PublicError,
  Result,
} from "@skills-desktop/skills-runtime";

const STORE_NAME = "inventorySnapshots" as const;
const DOCUMENT_NAME = "inventory-snapshots.json";
const CURRENT_SCHEMA_VERSION = 2 as const;

const persistedEntrySchema = z
  .object({
    agents: z.array(z.string().min(1).max(128)).max(256),
    declaredSource: z
      .object({
        source: z.string().min(1).max(2_048).nullable(),
        sourceType: z.string().min(1).max(128).nullable(),
      })
      .strict(),
    name: z.string().min(1).max(256),
    scope: z.enum(["project", "global"]),
  })
  .strict();

const snapshotSchema = z
  .object({
    cliVersion: z.literal("1.5.23"),
    entries: z.array(persistedEntrySchema).max(10_000),
    generation: z.number().int().positive(),
    observedAt: z.string().datetime({ offset: true }),
    targetId: z.string().min(1).max(256),
  })
  .strict();

const currentDocumentSchema = z
  .object({
    kind: z.literal("inventory-snapshots"),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    snapshots: z.array(snapshotSchema).max(1_000),
  })
  .strict();

const legacyEntrySchema = z
  .object({
    agents: z.array(z.string().min(1).max(128)).max(256),
    name: z.string().min(1).max(256),
    scope: z.enum(["project", "global"]),
    source: z.string().min(1).max(2_048).nullable(),
    sourceType: z.string().min(1).max(128).nullable(),
  })
  .strict();

const legacyDocumentSchema = z
  .object({
    kind: z.literal("inventory-snapshots"),
    records: z
      .array(
        z
          .object({
            capturedAt: z.string().datetime({ offset: true }),
            cliVersion: z.literal("1.5.23"),
            generation: z.number().int().positive(),
            skills: z.array(legacyEntrySchema).max(10_000),
            target: z.string().min(1).max(256),
          })
          .strict(),
      )
      .max(1_000),
    schemaVersion: z.literal(1),
  })
  .strict();

export type PersistedInventoryEntry = z.infer<typeof persistedEntrySchema>;

export interface InventorySnapshot {
  readonly cliVersion: "1.5.23";
  readonly entries: PersistedInventoryEntry[];
  readonly generation: number;
  readonly observedAt: string;
  readonly targetId: string;
}

export interface RecoveryFailure {
  readonly code: "corrupt_store" | "migration_failed" | "unsupported_schema";
  readonly store: typeof STORE_NAME;
}

export interface RestoredRecoveryRecords {
  readonly failures: readonly RecoveryFailure[];
  readonly inventorySnapshots: readonly InventorySnapshot[];
}

export type DurableChange = {
  readonly generation: number;
  readonly inventory: Inventory;
  readonly targetId: string;
  readonly type: "inventory.replace";
};

export type RecoveryCommitError = PublicError<
  "persist_failed" | "unsupported_schema"
>;

export interface RecoveryRecords {
  commit(change: DurableChange): Promise<Result<void, RecoveryCommitError>>;
  restore(): Promise<RestoredRecoveryRecords>;
}

export interface JsonRecoveryRecordsOptions {
  readonly directory: string;
  readonly fileSystem?: RecoveryFileSystem;
  readonly id: () => string;
  readonly platform?: NodeJS.Platform;
}

export interface RecoveryFileHandle {
  close(): Promise<void>;
  sync(): Promise<void>;
  writeFile(
    data: string,
    options: { readonly encoding: "utf8" },
  ): Promise<void>;
}

export interface RecoveryFileSystem {
  copyFile(source: string, destination: string, mode: number): Promise<void>;
  mkdir(
    path: string,
    options: { readonly mode: number; readonly recursive: true },
  ): Promise<void>;
  open(
    path: string,
    flags: "r" | "wx",
    mode?: number,
  ): Promise<RecoveryFileHandle>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rename(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export function createNodeRecoveryFileSystem(): RecoveryFileSystem {
  return {
    async copyFile(source, destination, mode) {
      await nodeCopyFile(source, destination, mode);
    },
    async mkdir(path, options) {
      await nodeMkdir(path, options);
    },
    async open(path, flags, mode) {
      const handle = await nodeOpen(path, flags, mode);
      return {
        async close() {
          await handle.close();
        },
        async sync() {
          await handle.sync();
        },
        async writeFile(data, options) {
          await handle.writeFile(data, options);
        },
      };
    },
    async readFile(path, encoding) {
      return nodeReadFile(path, encoding);
    },
    async rename(source, destination) {
      await nodeRename(source, destination);
    },
    async unlink(path) {
      await nodeUnlink(path);
    },
  };
}

type CurrentDocument = z.infer<typeof currentDocumentSchema>;

function allowlistSnapshot(change: DurableChange): InventorySnapshot {
  return {
    cliVersion: change.inventory.cliVersion,
    entries: change.inventory.entries.map((entry) => ({
      agents: [...entry.agents],
      declaredSource: { ...entry.declaredSource },
      name: entry.name,
      scope: entry.scope,
    })),
    generation: change.generation,
    observedAt: change.inventory.observedAt,
    targetId: change.targetId,
  };
}

function commitFailure(
  code: RecoveryCommitError["code"],
  message: string,
): Result<never, RecoveryCommitError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "persistence",
      retryable: code === "persist_failed",
    },
    ok: false,
  };
}

function replaceSnapshot(
  snapshots: readonly InventorySnapshot[],
  replacement: InventorySnapshot,
): InventorySnapshot[] {
  return [
    ...snapshots.filter(({ targetId }) => targetId !== replacement.targetId),
    replacement,
  ];
}

export function createMemoryRecoveryRecords(
  initialSnapshots: readonly InventorySnapshot[] = [],
): RecoveryRecords {
  let snapshots = [...initialSnapshots];
  return {
    async commit(change) {
      snapshots = replaceSnapshot(snapshots, allowlistSnapshot(change));
      return { ok: true, value: undefined };
    },
    async restore() {
      return { failures: [], inventorySnapshots: structuredClone(snapshots) };
    },
  };
}

function migrateLegacyDocument(
  input: z.infer<typeof legacyDocumentSchema>,
): CurrentDocument {
  return {
    kind: "inventory-snapshots",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    snapshots: input.records.map((record) => ({
      cliVersion: record.cliVersion,
      entries: record.skills.map((entry) => ({
        agents: entry.agents,
        declaredSource: { source: entry.source, sourceType: entry.sourceType },
        name: entry.name,
        scope: entry.scope,
      })),
      generation: record.generation,
      observedAt: record.capturedAt,
      targetId: record.target,
    })),
  };
}

export function createJsonRecoveryRecords(
  options: JsonRecoveryRecordsOptions,
): RecoveryRecords {
  const documentPath = join(options.directory, DOCUMENT_NAME);
  const fileSystem = options.fileSystem ?? createNodeRecoveryFileSystem();
  let document: CurrentDocument = {
    kind: "inventory-snapshots",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    snapshots: [],
  };
  let failures: RecoveryFailure[] = [];
  let loaded = false;
  let unsupportedSchema = false;
  let writeBlocked = false;
  let applicationLock = Promise.resolve();

  const underApplicationLock = <Value>(work: () => Promise<Value>) => {
    const result = applicationLock.then(work, work);
    applicationLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const writeDocument = async (nextDocument: CurrentDocument) => {
    await fileSystem.mkdir(options.directory, { recursive: true, mode: 0o700 });
    const temporaryPath = join(
      options.directory,
      `.${DOCUMENT_NAME}.${options.id()}.tmp`,
    );
    let ownsTemporary = false;
    try {
      const handle = await fileSystem.open(temporaryPath, "wx", 0o600);
      ownsTemporary = true;
      try {
        await handle.writeFile(JSON.stringify(nextDocument), {
          encoding: "utf8",
        });
        await handle.sync();
      } finally {
        await handle.close();
      }

      await fileSystem.rename(temporaryPath, documentPath);
      ownsTemporary = false;
      if ((options.platform ?? process.platform) !== "win32") {
        const directoryHandle = await fileSystem.open(options.directory, "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } catch (error) {
      if (ownsTemporary)
        await fileSystem.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  };

  const quarantine = async () => {
    const quarantinePath = join(
      options.directory,
      `inventory-snapshots.quarantine-${options.id()}.json`,
    );
    await fileSystem.rename(documentPath, quarantinePath);
  };

  const load = async () => {
    if (loaded) return;
    loaded = true;
    failures = [];

    let raw: string;
    try {
      raw = await fileSystem.readFile(documentPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      writeBlocked = true;
      failures = [{ code: "corrupt_store", store: STORE_NAME }];
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      const quarantined = await quarantine().then(
        () => true,
        () => false,
      );
      writeBlocked = !quarantined;
      failures = [{ code: "corrupt_store", store: STORE_NAME }];
      return;
    }

    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "schemaVersion" in decoded &&
      typeof decoded.schemaVersion === "number" &&
      decoded.schemaVersion > CURRENT_SCHEMA_VERSION
    ) {
      unsupportedSchema = true;
      failures = [{ code: "unsupported_schema", store: STORE_NAME }];
      return;
    }

    const current = currentDocumentSchema.safeParse(decoded);
    if (current.success) {
      document = current.data;
      return;
    }

    const legacy = legacyDocumentSchema.safeParse(decoded);
    if (!legacy.success) {
      const quarantined = await quarantine().then(
        () => true,
        () => false,
      );
      writeBlocked = !quarantined;
      failures = [{ code: "corrupt_store", store: STORE_NAME }];
      return;
    }

    const migrated = migrateLegacyDocument(legacy.data);
    try {
      await fileSystem.copyFile(
        documentPath,
        `${documentPath}.v1.backup`,
        constants.COPYFILE_EXCL,
      );
      await writeDocument(migrated);
      document = migrated;
    } catch {
      await quarantine().catch(() => undefined);
      writeBlocked = true;
      failures = [{ code: "migration_failed", store: STORE_NAME }];
    }
  };

  return {
    commit(change) {
      return underApplicationLock(async () => {
        await load();
        if (unsupportedSchema) {
          return commitFailure(
            "unsupported_schema",
            "Recovery data was written by a newer unsupported application version.",
          );
        }
        if (writeBlocked) {
          return commitFailure(
            "persist_failed",
            "Recovery data could not be read safely and will not be overwritten.",
          );
        }

        const nextDocument: CurrentDocument = {
          kind: "inventory-snapshots",
          schemaVersion: CURRENT_SCHEMA_VERSION,
          snapshots: replaceSnapshot(
            document.snapshots,
            allowlistSnapshot(change),
          ),
        };
        try {
          await writeDocument(nextDocument);
          document = nextDocument;
          failures = [];
          return { ok: true, value: undefined };
        } catch {
          return commitFailure(
            "persist_failed",
            "The Inventory Snapshot could not be saved.",
          );
        }
      });
    },
    restore() {
      return underApplicationLock(async () => {
        await load();
        return {
          failures: structuredClone(failures),
          inventorySnapshots: structuredClone(document.snapshots),
        };
      });
    },
  };
}
