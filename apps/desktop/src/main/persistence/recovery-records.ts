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
const GUARD_STORE_NAME = "mutationGuards" as const;
const TARGET_STORE_NAME = "targetDefinitions" as const;
const DOCUMENT_NAME = "inventory-snapshots.json";
const GUARD_DOCUMENT_NAME = "mutation-guards.json";
const TARGET_DOCUMENT_NAME = "target-definitions.json";
const TARGET_FAILURE_MARKER_NAME = "target-definitions.failure.json";
const CURRENT_SCHEMA_VERSION = 3 as const;
const CURRENT_GUARD_SCHEMA_VERSION = 2 as const;
const CURRENT_TARGET_SCHEMA_VERSION = 2 as const;
const targetIdSchema = z.string().uuid();

const persistedEvidenceSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unknown") }).strict(),
  z
    .object({
      authority: z.string().min(1).max(256),
      kind: z.string().min(1).max(128),
      status: z.literal("known"),
      value: z.string().min(1).max(2_048),
    })
    .strict(),
]);

const persistedEntrySchema = z
  .object({
    agents: z.array(z.string().min(1).max(128)).max(256),
    contentFingerprint: persistedEvidenceSchema.default({ status: "unknown" }),
    declaredSource: z
      .object({
        source: z.string().min(1).max(2_048).nullable(),
        sourceType: z.string().min(1).max(128).nullable(),
      })
      .strict(),
    name: z.string().min(1).max(256),
    revision: persistedEvidenceSchema.default({ status: "unknown" }),
    scope: z.enum(["project", "global"]),
  })
  .strict();

const snapshotSchema = z
  .object({
    cliVersion: z.literal("1.5.23"),
    entries: z.array(persistedEntrySchema).max(10_000),
    generation: z.number().int().positive(),
    observedAt: z.string().datetime({ offset: true }),
    targetId: targetIdSchema,
  })
  .strict();

const legacyCurrentSnapshotSchema = snapshotSchema.extend({
  targetId: z.string().min(1).max(256),
});
const unboundLegacySnapshotSchema = legacyCurrentSnapshotSchema.refine(
  ({ targetId }) => !targetIdSchema.safeParse(targetId).success,
);

const currentDocumentSchema = z
  .object({
    kind: z.literal("inventory-snapshots"),
    legacySnapshots: z
      .array(unboundLegacySnapshotSchema)
      .max(1_000)
      .default([]),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    snapshots: z.array(snapshotSchema).max(1_000),
  })
  .strict();

const legacyCurrentDocumentSchema = z
  .object({
    kind: z.literal("inventory-snapshots"),
    schemaVersion: z.literal(2),
    snapshots: z.array(legacyCurrentSnapshotSchema).max(1_000),
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

const mutationGuardSchema = z
  .object({
    deadline: z.string().datetime({ offset: true }),
    effects: z.enum(["none", "possible"]),
    generation: z.number().int().positive(),
    operationId: z.string().min(1).max(256),
    phase: z.enum(["executing", "reconciliation-required"]),
    targetId: targetIdSchema,
  })
  .strict();

const legacyMutationGuardSchema = z
  .object({
    deadline: z.string().datetime({ offset: true }),
    effects: z.enum(["none", "possible"]),
    generation: z.number().int().positive(),
    operationId: z.string().min(1).max(256),
    phase: z.enum(["executing", "reconciliation-required"]),
    targetId: z.string().min(1).max(256),
  })
  .strict();
const unboundLegacyGuardSchema = legacyMutationGuardSchema.refine(
  ({ targetId }) => !targetIdSchema.safeParse(targetId).success,
);

const guardDocumentSchema = z
  .object({
    guards: z.array(mutationGuardSchema).max(1_000),
    kind: z.literal("mutation-guards"),
    legacyGuards: z.array(unboundLegacyGuardSchema).max(1_000).default([]),
    schemaVersion: z.literal(CURRENT_GUARD_SCHEMA_VERSION),
  })
  .strict();

const legacyGuardDocumentSchema = z
  .object({
    guards: z.array(legacyMutationGuardSchema).max(1_000),
    kind: z.literal("mutation-guards"),
    schemaVersion: z.literal(1),
  })
  .strict();

const targetDefinitionSchema = z
  .object({
    connectionReference: z.string().min(1).max(256).nullable(),
    generation: z.number().int().positive(),
    harness: z.string().min(1).max(128),
    id: targetIdSchema,
    kind: z.enum(["local", "ssh"]),
    label: z.string().min(1).max(256),
    workspace: z.string().min(1).max(4_096),
  })
  .strict()
  .superRefine((target, context) => {
    if (
      (target.kind === "local" && target.connectionReference !== null) ||
      (target.kind === "ssh" && target.connectionReference === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Target kind and connection reference do not match.",
      });
    }
  });

const targetDocumentSchema = z
  .object({
    kind: z.literal("target-definitions"),
    schemaVersion: z.literal(CURRENT_TARGET_SCHEMA_VERSION),
    targets: z.array(targetDefinitionSchema).min(1).max(1_000),
  })
  .strict();

const legacyTargetDocumentSchema = z
  .object({
    kind: z.literal("target-definitions"),
    schemaVersion: z.literal(1),
    targets: z
      .array(
        z
          .object({
            connectionReference: z.string().min(1).max(256).nullable(),
            harness: z.string().min(1).max(128),
            id: targetIdSchema,
            kind: z.enum(["local", "ssh"]),
            label: z.string().min(1).max(256),
            workspace: z.string().min(1).max(4_096),
          })
          .strict(),
      )
      .min(1)
      .max(1_000),
  })
  .strict();

const targetFailureMarkerSchema = z
  .object({
    failure: z.enum(["corrupt_store", "migration_failed"]),
    kind: z.literal("target-definitions-failure"),
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
  readonly store:
    typeof GUARD_STORE_NAME | typeof STORE_NAME | typeof TARGET_STORE_NAME;
}

export type DurableTargetDefinition = z.infer<typeof targetDefinitionSchema>;

export interface MutationGuard {
  readonly deadline: string;
  readonly effects: "none" | "possible";
  readonly generation: number;
  readonly operationId: string;
  readonly phase: "executing" | "reconciliation-required";
  readonly targetId: string;
}

export interface RestoredRecoveryRecords {
  readonly failures: readonly RecoveryFailure[];
  readonly inventorySnapshots: readonly InventorySnapshot[];
  readonly mutationGuards: readonly MutationGuard[];
  readonly targetDefinitions: readonly DurableTargetDefinition[];
}

export type DurableChange =
  | {
      readonly generation: number;
      readonly inventory: Inventory;
      readonly targetId: string;
      readonly type: "inventory.replace";
    }
  | ({ readonly type: "guard.put" } & MutationGuard)
  | {
      readonly targetId: string;
      readonly type: "guard.clear";
    }
  | {
      readonly targets: readonly DurableTargetDefinition[];
      readonly type: "targets.replace";
    }
  | {
      readonly fromTargetId: string;
      readonly toTargetId: string;
      readonly type: "target.remap";
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
type GuardDocument = z.infer<typeof guardDocumentSchema>;
type TargetDocument = z.infer<typeof targetDocumentSchema>;
type TargetFailureMarker = z.infer<typeof targetFailureMarkerSchema>;

function allowlistSnapshot(
  change: Extract<DurableChange, { readonly type: "inventory.replace" }>,
): InventorySnapshot {
  return {
    cliVersion: change.inventory.cliVersion,
    entries: change.inventory.entries.map((entry) => ({
      agents: [...entry.agents],
      contentFingerprint: { ...entry.contentFingerprint },
      declaredSource: { ...entry.declaredSource },
      name: entry.name,
      revision: { ...entry.revision },
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

function uniqueByTargetId<Value extends { readonly targetId: string }>(
  values: readonly Value[],
): Value[] {
  const byTarget = new Map<string, Value>();
  for (const value of values) byTarget.set(value.targetId, value);
  return [...byTarget.values()];
}

function remapTargetId<Value extends { readonly targetId: string }>(
  values: readonly Value[],
  fromTargetId: string,
  toTargetId: string,
): Value[] {
  return uniqueByTargetId([
    ...values
      .filter(({ targetId }) => targetId === fromTargetId)
      .map((value) => ({ ...value, targetId: toTargetId })),
    ...values.filter(({ targetId }) => targetId !== fromTargetId),
  ]);
}

export function createMemoryRecoveryRecords(
  initialSnapshots: readonly InventorySnapshot[] = [],
  initialGuards: readonly MutationGuard[] = [],
  initialTargets: readonly DurableTargetDefinition[] = [],
): RecoveryRecords {
  let snapshots = [...initialSnapshots];
  let mutationGuards = [...initialGuards];
  let targetDefinitions = structuredClone(initialTargets);
  return {
    async commit(change) {
      if (change.type === "target.remap") {
        if (
          change.fromTargetId.length === 0 ||
          !targetIdSchema.safeParse(change.toTargetId).success
        ) {
          return commitFailure(
            "persist_failed",
            "Target identity migration did not pass durable validation.",
          );
        }
        snapshots = remapTargetId(
          snapshots,
          change.fromTargetId,
          change.toTargetId,
        );
        mutationGuards = remapTargetId(
          mutationGuards,
          change.fromTargetId,
          change.toTargetId,
        );
      } else if (change.type === "inventory.replace") {
        const replacement = snapshotSchema.safeParse(allowlistSnapshot(change));
        if (!replacement.success) {
          return commitFailure(
            "persist_failed",
            "Inventory Snapshot data did not pass durable validation.",
          );
        }
        snapshots = replaceSnapshot(snapshots, replacement.data);
      } else if (change.type === "guard.put") {
        const guard = mutationGuardSchema.safeParse({
          deadline: change.deadline,
          effects: change.effects,
          generation: change.generation,
          operationId: change.operationId,
          phase: change.phase,
          targetId: change.targetId,
        });
        if (!guard.success) {
          return commitFailure(
            "persist_failed",
            "Mutation Guard data did not pass durable validation.",
          );
        }
        mutationGuards = [
          ...mutationGuards.filter(
            ({ targetId }) => targetId !== change.targetId,
          ),
          {
            deadline: change.deadline,
            effects: change.effects,
            generation: change.generation,
            operationId: change.operationId,
            phase: change.phase,
            targetId: change.targetId,
          },
        ];
      } else if (change.type === "guard.clear") {
        if (!targetIdSchema.safeParse(change.targetId).success) {
          return commitFailure(
            "persist_failed",
            "Mutation Guard data did not pass durable validation.",
          );
        }
        mutationGuards = mutationGuards.filter(
          ({ targetId }) => targetId !== change.targetId,
        );
      } else {
        const parsed = z
          .array(targetDefinitionSchema)
          .min(1)
          .max(1_000)
          .safeParse(change.targets);
        if (!parsed.success) {
          return commitFailure(
            "persist_failed",
            "Target data did not pass durable validation.",
          );
        }
        targetDefinitions = structuredClone(parsed.data);
      }
      return { ok: true, value: undefined };
    },
    async restore() {
      return {
        failures: [],
        inventorySnapshots: structuredClone(snapshots),
        mutationGuards: structuredClone(mutationGuards),
        targetDefinitions: structuredClone(targetDefinitions),
      };
    },
  };
}

function migrateLegacyDocument(
  input: z.infer<typeof legacyDocumentSchema>,
): InventorySnapshot[] {
  return input.records.map((record) => ({
      cliVersion: record.cliVersion,
      entries: record.skills.map((entry) => ({
        agents: entry.agents,
        contentFingerprint: { status: "unknown" as const },
        declaredSource: { source: entry.source, sourceType: entry.sourceType },
        name: entry.name,
        revision: { status: "unknown" as const },
        scope: entry.scope,
      })),
      generation: record.generation,
      observedAt: record.capturedAt,
      targetId: record.target,
    }));
}

export function createJsonRecoveryRecords(
  options: JsonRecoveryRecordsOptions,
): RecoveryRecords {
  const documentPath = join(options.directory, DOCUMENT_NAME);
  const guardDocumentPath = join(options.directory, GUARD_DOCUMENT_NAME);
  const targetDocumentPath = join(options.directory, TARGET_DOCUMENT_NAME);
  const targetFailureMarkerPath = join(
    options.directory,
    TARGET_FAILURE_MARKER_NAME,
  );
  const fileSystem = options.fileSystem ?? createNodeRecoveryFileSystem();
  let document: CurrentDocument = {
    kind: "inventory-snapshots",
    legacySnapshots: [],
    schemaVersion: CURRENT_SCHEMA_VERSION,
    snapshots: [],
  };
  let pendingLegacySnapshots: InventorySnapshot[] | undefined;
  let pendingInventoryVersion: 1 | 2 | undefined;
  let failures: RecoveryFailure[] = [];
  let guardDocument: GuardDocument = {
    guards: [],
    kind: "mutation-guards",
    legacyGuards: [],
    schemaVersion: CURRENT_GUARD_SCHEMA_VERSION,
  };
  let pendingLegacyGuards: MutationGuard[] | undefined;
  let guardFailures: RecoveryFailure[] = [];
  let guardsLoaded = false;
  let guardUnsupportedSchema = false;
  let guardWriteBlocked = false;
  let targetDocument: TargetDocument = {
    kind: "target-definitions",
    schemaVersion: CURRENT_TARGET_SCHEMA_VERSION,
    targets: [],
  };
  let targetFailures: RecoveryFailure[] = [];
  let targetsLoaded = false;
  let targetUnsupportedSchema = false;
  let targetWriteBlocked = false;
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

  const writeDocument = async (
    nextDocument:
      CurrentDocument | GuardDocument | TargetDocument | TargetFailureMarker,
    name = DOCUMENT_NAME,
    destinationPath = documentPath,
  ) => {
    await fileSystem.mkdir(options.directory, { recursive: true, mode: 0o700 });
    const temporaryPath = join(
      options.directory,
      `.${name}.${options.id()}.tmp`,
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

      await fileSystem.rename(temporaryPath, destinationPath);
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

    const legacyCurrent = legacyCurrentDocumentSchema.safeParse(decoded);
    const legacy = legacyDocumentSchema.safeParse(decoded);
    if (!legacyCurrent.success && !legacy.success) {
      const quarantined = await quarantine().then(
        () => true,
        () => false,
      );
      writeBlocked = !quarantined;
      failures = [{ code: "corrupt_store", store: STORE_NAME }];
      return;
    }

    const legacySnapshots = legacyCurrent.success
      ? legacyCurrent.data.snapshots
      : migrateLegacyDocument(legacy.data!);
    const migrated = currentDocumentSchema.safeParse({
      kind: "inventory-snapshots",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      snapshots: legacySnapshots,
    });
    if (!migrated.success) {
      pendingLegacySnapshots = legacySnapshots;
      pendingInventoryVersion = legacyCurrent.success ? 2 : 1;
      return;
    }
    try {
      await fileSystem.copyFile(
        documentPath,
        `${documentPath}.v${legacyCurrent.success ? 2 : 1}.backup`,
        constants.COPYFILE_EXCL,
      );
      await writeDocument(migrated.data);
      document = migrated.data;
    } catch {
      await quarantine().catch(() => undefined);
      writeBlocked = true;
      failures = [{ code: "migration_failed", store: STORE_NAME }];
    }
  };

  const quarantineGuards = async () => {
    const quarantinePath = join(
      options.directory,
      `mutation-guards.quarantine-${options.id()}.json`,
    );
    await fileSystem.rename(guardDocumentPath, quarantinePath);
  };

  const loadGuards = async () => {
    if (guardsLoaded) return;
    guardsLoaded = true;
    guardFailures = [];

    let raw: string;
    try {
      raw = await fileSystem.readFile(guardDocumentPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      guardWriteBlocked = true;
      guardFailures = [{ code: "corrupt_store", store: GUARD_STORE_NAME }];
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      const quarantined = await quarantineGuards().then(
        () => true,
        () => false,
      );
      guardWriteBlocked = !quarantined;
      guardFailures = [{ code: "corrupt_store", store: GUARD_STORE_NAME }];
      return;
    }

    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "schemaVersion" in decoded &&
      typeof decoded.schemaVersion === "number" &&
      decoded.schemaVersion > CURRENT_GUARD_SCHEMA_VERSION
    ) {
      guardUnsupportedSchema = true;
      guardFailures = [{ code: "unsupported_schema", store: GUARD_STORE_NAME }];
      return;
    }

    const parsed = guardDocumentSchema.safeParse(decoded);
    if (parsed.success) {
      guardDocument = parsed.data;
      return;
    }

    const legacy = legacyGuardDocumentSchema.safeParse(decoded);
    if (!legacy.success) {
      const quarantined = await quarantineGuards().then(
        () => true,
        () => false,
      );
      guardWriteBlocked = !quarantined;
      guardFailures = [{ code: "corrupt_store", store: GUARD_STORE_NAME }];
      return;
    }
    const migrated = guardDocumentSchema.safeParse({
      guards: legacy.data.guards,
      kind: "mutation-guards",
      schemaVersion: CURRENT_GUARD_SCHEMA_VERSION,
    });
    if (!migrated.success) {
      pendingLegacyGuards = legacy.data.guards;
      return;
    }
    try {
      await fileSystem.copyFile(
        guardDocumentPath,
        `${guardDocumentPath}.v1.backup`,
        constants.COPYFILE_EXCL,
      );
      await writeDocument(
        migrated.data,
        GUARD_DOCUMENT_NAME,
        guardDocumentPath,
      );
      guardDocument = migrated.data;
    } catch {
      guardWriteBlocked = true;
      guardFailures = [{ code: "migration_failed", store: GUARD_STORE_NAME }];
    }
  };

  const quarantineTargets = async () => {
    const quarantinePath = join(
      options.directory,
      `target-definitions.quarantine-${options.id()}.json`,
    );
    await fileSystem.rename(targetDocumentPath, quarantinePath);
    return quarantinePath;
  };

  const quarantineAndMarkTargets = async (
    failure: TargetFailureMarker["failure"],
  ) => {
    const quarantinePath = await quarantineTargets().catch(() => undefined);
    try {
      await writeDocument(
        {
          failure,
          kind: "target-definitions-failure",
          schemaVersion: 1,
        },
        TARGET_FAILURE_MARKER_NAME,
        targetFailureMarkerPath,
      );
    } catch (error) {
      if (quarantinePath !== undefined) {
        await fileSystem
          .rename(quarantinePath, targetDocumentPath)
          .catch(() => undefined);
      }
      throw error;
    }
  };

  const loadTargets = async () => {
    if (targetsLoaded) return;
    targetsLoaded = true;
    targetFailures = [];

    try {
      const rawMarker = await fileSystem.readFile(
        targetFailureMarkerPath,
        "utf8",
      );
      const marker = targetFailureMarkerSchema.safeParse(JSON.parse(rawMarker));
      targetWriteBlocked = true;
      targetFailures = [
        {
          code: marker.success ? marker.data.failure : "corrupt_store",
          store: TARGET_STORE_NAME,
        },
      ];
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        targetWriteBlocked = true;
        targetFailures = [{ code: "corrupt_store", store: TARGET_STORE_NAME }];
        return;
      }
    }

    let raw: string;
    try {
      raw = await fileSystem.readFile(targetDocumentPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      targetWriteBlocked = true;
      targetFailures = [{ code: "corrupt_store", store: TARGET_STORE_NAME }];
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      await quarantineAndMarkTargets("corrupt_store").catch(() => undefined);
      targetWriteBlocked = true;
      targetFailures = [{ code: "corrupt_store", store: TARGET_STORE_NAME }];
      return;
    }

    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "schemaVersion" in decoded &&
      typeof decoded.schemaVersion === "number" &&
      decoded.schemaVersion > CURRENT_TARGET_SCHEMA_VERSION
    ) {
      targetUnsupportedSchema = true;
      targetFailures = [
        { code: "unsupported_schema", store: TARGET_STORE_NAME },
      ];
      return;
    }

    const parsed = targetDocumentSchema.safeParse(decoded);
    if (parsed.success) {
      targetDocument = parsed.data;
      return;
    }

    const legacy = legacyTargetDocumentSchema.safeParse(decoded);
    if (!legacy.success) {
      await quarantineAndMarkTargets("corrupt_store").catch(() => undefined);
      targetWriteBlocked = true;
      targetFailures = [{ code: "corrupt_store", store: TARGET_STORE_NAME }];
      return;
    }

    const migrated = targetDocumentSchema.safeParse({
      kind: "target-definitions",
      schemaVersion: CURRENT_TARGET_SCHEMA_VERSION,
      targets: legacy.data.targets.map((definition) => ({
        ...definition,
        generation: 1,
      })),
    });
    if (!migrated.success) {
      await quarantineAndMarkTargets("migration_failed").catch(
        () => undefined,
      );
      targetWriteBlocked = true;
      targetFailures = [{ code: "migration_failed", store: TARGET_STORE_NAME }];
      return;
    }
    try {
      await fileSystem.copyFile(
        targetDocumentPath,
        `${targetDocumentPath}.v1.backup`,
        constants.COPYFILE_EXCL,
      );
      await writeDocument(
        migrated.data,
        TARGET_DOCUMENT_NAME,
        targetDocumentPath,
      );
      targetDocument = migrated.data;
    } catch {
      await quarantineAndMarkTargets("migration_failed").catch(() => undefined);
      targetWriteBlocked = true;
      targetFailures = [{ code: "migration_failed", store: TARGET_STORE_NAME }];
    }
  };

  return {
    commit(change) {
      return underApplicationLock(async () => {
        if (change.type === "target.remap") {
          if (
            change.fromTargetId.length === 0 ||
            !targetIdSchema.safeParse(change.toTargetId).success
          ) {
            return commitFailure(
              "persist_failed",
              "Target identity migration did not pass durable validation.",
            );
          }
          await load();
          await loadGuards();
          if (unsupportedSchema || guardUnsupportedSchema) {
            return commitFailure(
              "unsupported_schema",
              "Recovery data was written by a newer unsupported application version.",
            );
          }
          if (writeBlocked || guardWriteBlocked) {
            return commitFailure(
              "persist_failed",
              "Recovery data could not be read safely and will not be overwritten.",
            );
          }

          const sourceSnapshots =
            pendingLegacySnapshots ??
            [...document.legacySnapshots, ...document.snapshots];
          const sourceGuards =
            pendingLegacyGuards ??
            [...guardDocument.legacyGuards, ...guardDocument.guards];
          const remappedSnapshots = remapTargetId(
            sourceSnapshots,
            change.fromTargetId,
            change.toTargetId,
          );
          const remappedGuards = remapTargetId(
            sourceGuards,
            change.fromTargetId,
            change.toTargetId,
          );
          const nextDocument = currentDocumentSchema.safeParse({
            kind: "inventory-snapshots",
            legacySnapshots: remappedSnapshots.filter(
              ({ targetId }) => !targetIdSchema.safeParse(targetId).success,
            ),
            schemaVersion: CURRENT_SCHEMA_VERSION,
            snapshots: remappedSnapshots.filter(
              ({ targetId }) => targetIdSchema.safeParse(targetId).success,
            ),
          });
          const nextGuardDocument = guardDocumentSchema.safeParse({
            guards: remappedGuards.filter(
              ({ targetId }) => targetIdSchema.safeParse(targetId).success,
            ),
            kind: "mutation-guards",
            legacyGuards: remappedGuards.filter(
              ({ targetId }) => !targetIdSchema.safeParse(targetId).success,
            ),
            schemaVersion: CURRENT_GUARD_SCHEMA_VERSION,
          });
          if (!nextDocument.success || !nextGuardDocument.success) {
            return commitFailure(
              "persist_failed",
              "Legacy Target evidence could not be mapped to a current UUID.",
            );
          }

          try {
            if (pendingLegacySnapshots !== undefined) {
              await fileSystem
                .copyFile(
                  documentPath,
                  `${documentPath}.v${pendingInventoryVersion ?? 2}.backup`,
                  constants.COPYFILE_EXCL,
                )
                .catch((error: NodeJS.ErrnoException) => {
                  if (error.code !== "EEXIST") throw error;
                });
            }
            await writeDocument(nextDocument.data);
            document = nextDocument.data;
            pendingLegacySnapshots = undefined;
            pendingInventoryVersion = undefined;

            if (pendingLegacyGuards !== undefined) {
              await fileSystem
                .copyFile(
                  guardDocumentPath,
                  `${guardDocumentPath}.v1.backup`,
                  constants.COPYFILE_EXCL,
                )
                .catch((error: NodeJS.ErrnoException) => {
                  if (error.code !== "EEXIST") throw error;
                });
            }
            await writeDocument(
              nextGuardDocument.data,
              GUARD_DOCUMENT_NAME,
              guardDocumentPath,
            );
            guardDocument = nextGuardDocument.data;
            pendingLegacyGuards = undefined;
            failures = [];
            guardFailures = [];
            return { ok: true, value: undefined };
          } catch {
            return commitFailure(
              "persist_failed",
              "Legacy Target evidence could not be saved under its current UUID.",
            );
          }
        }

        if (change.type === "targets.replace") {
          await loadTargets();
          if (targetUnsupportedSchema) {
            return commitFailure(
              "unsupported_schema",
              "Target data was written by a newer unsupported application version.",
            );
          }
          if (targetWriteBlocked) {
            return commitFailure(
              "persist_failed",
              "Target data could not be read safely and will not be overwritten.",
            );
          }
          const parsedTargets = z
            .array(targetDefinitionSchema)
            .min(1)
            .max(1_000)
            .safeParse(change.targets);
          if (!parsedTargets.success) {
            return commitFailure(
              "persist_failed",
              "Target data did not pass durable validation.",
            );
          }
          const nextTargetDocument: TargetDocument = {
            kind: "target-definitions",
            schemaVersion: CURRENT_TARGET_SCHEMA_VERSION,
            targets: parsedTargets.data,
          };
          try {
            await writeDocument(
              nextTargetDocument,
              TARGET_DOCUMENT_NAME,
              targetDocumentPath,
            );
            targetDocument = nextTargetDocument;
            targetFailures = [];
            return { ok: true, value: undefined };
          } catch {
            return commitFailure(
              "persist_failed",
              "Target Definitions could not be saved.",
            );
          }
        }

        if (change.type !== "inventory.replace") {
          await loadGuards();
          if (guardUnsupportedSchema) {
            return commitFailure(
              "unsupported_schema",
              "Mutation Guard data was written by a newer unsupported application version.",
            );
          }
          if (guardWriteBlocked) {
            return commitFailure(
              "persist_failed",
              "Mutation Guard data could not be read safely and will not be overwritten.",
            );
          }
          if (pendingLegacyGuards !== undefined) {
            return commitFailure(
              "persist_failed",
              "Legacy Mutation Guard data must be migrated before it can change.",
            );
          }
          const guards =
            change.type === "guard.put"
              ? [
                  ...guardDocument.guards.filter(
                    ({ targetId }) => targetId !== change.targetId,
                  ),
                  {
                    deadline: change.deadline,
                    effects: change.effects,
                    generation: change.generation,
                    operationId: change.operationId,
                    phase: change.phase,
                    targetId: change.targetId,
                  },
                ]
              : guardDocument.guards.filter(
                  ({ targetId }) => targetId !== change.targetId,
                );
          const nextGuardDocument = guardDocumentSchema.safeParse({
            guards,
            kind: "mutation-guards",
            legacyGuards: guardDocument.legacyGuards,
            schemaVersion: CURRENT_GUARD_SCHEMA_VERSION,
          });
          if (!nextGuardDocument.success) {
            return commitFailure(
              "persist_failed",
              "Mutation Guard data did not pass durable validation.",
            );
          }
          try {
            await writeDocument(
              nextGuardDocument.data,
              GUARD_DOCUMENT_NAME,
              guardDocumentPath,
            );
            guardDocument = nextGuardDocument.data;
            guardFailures = [];
            return { ok: true, value: undefined };
          } catch {
            return commitFailure(
              "persist_failed",
              "The Mutation Guard could not be saved.",
            );
          }
        }

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
        if (pendingLegacySnapshots !== undefined) {
          return commitFailure(
            "persist_failed",
            "Legacy Inventory Snapshot data must be migrated before it can change.",
          );
        }

        const nextDocument = currentDocumentSchema.safeParse({
          kind: "inventory-snapshots",
          legacySnapshots: document.legacySnapshots,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          snapshots: replaceSnapshot(
            document.snapshots,
            allowlistSnapshot(change),
          ),
        });
        if (!nextDocument.success) {
          return commitFailure(
            "persist_failed",
            "Inventory Snapshot data did not pass durable validation.",
          );
        }
        try {
          await writeDocument(nextDocument.data);
          document = nextDocument.data;
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
        await loadGuards();
        await loadTargets();
        return {
          failures: structuredClone([
            ...failures,
            ...guardFailures,
            ...targetFailures,
          ]),
          inventorySnapshots: structuredClone(
            pendingLegacySnapshots ?? [
              ...document.snapshots,
              ...document.legacySnapshots,
            ],
          ),
          mutationGuards: structuredClone(
            pendingLegacyGuards ?? [
              ...guardDocument.guards,
              ...guardDocument.legacyGuards,
            ],
          ),
          targetDefinitions: structuredClone(targetDocument.targets),
        };
      });
    },
  };
}
