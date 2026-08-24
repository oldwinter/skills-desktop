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
import { hostPublicKeySchema } from "../ssh/host-public-key.js";

const STORE_NAME = "inventorySnapshots" as const;
const GUARD_STORE_NAME = "mutationGuards" as const;
const TARGET_STORE_NAME = "targetDefinitions" as const;
const HOST_TRUST_STORE_NAME = "hostTrustRecords" as const;
const COLLECTION_STORE_NAME = "collectionAcknowledgements" as const;
const DOCUMENT_NAME = "inventory-snapshots.json";
const GUARD_DOCUMENT_NAME = "mutation-guards.json";
const GUARD_FAILURE_MARKER_NAME = "mutation-guards.failure.json";
const TARGET_DOCUMENT_NAME = "target-definitions.json";
const TARGET_FAILURE_MARKER_NAME = "target-definitions.failure.json";
const HOST_TRUST_DOCUMENT_NAME = "known_hosts";
const HOST_TRUST_FAILURE_MARKER_NAME = "host-trust.failure.json";
const COLLECTION_DOCUMENT_NAME = "collection-acknowledgements.json";
const CURRENT_SCHEMA_VERSION = 3 as const;
const CURRENT_GUARD_SCHEMA_VERSION = 2 as const;
const CURRENT_TARGET_SCHEMA_VERSION = 3 as const;
const CURRENT_COLLECTION_SCHEMA_VERSION = 1 as const;
const targetIdSchema = z.string().uuid();
const legacyTargetIdSchema = z.string().min(1).max(256);

function rejectDuplicateIdentities<Value>(
  values: readonly Value[],
  identity: (value: Value) => string,
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  for (const value of values) {
    const valueIdentity = identity(value);
    if (seen.has(valueIdentity)) {
      context.addIssue({
        code: "custom",
        message: "Stable Target identity must be unique.",
      });
    }
    seen.add(valueIdentity);
  }
}

const hostTrustRecordSchema = hostPublicKeySchema
  .extend({
    identity: z
      .string()
      .min(1)
      .max(2_048)
      .refine((value) => !/[\s\0]/.test(value)),
  })
  .strict();

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
  .strict()
  .superRefine((document, context) => {
    rejectDuplicateIdentities(
      [...document.legacySnapshots, ...document.snapshots],
      ({ targetId }) => targetId,
      context,
    );
  });

const legacyCurrentDocumentSchema = z
  .object({
    kind: z.literal("inventory-snapshots"),
    schemaVersion: z.literal(2),
    snapshots: z.array(legacyCurrentSnapshotSchema).max(1_000),
  })
  .strict()
  .superRefine((document, context) => {
    rejectDuplicateIdentities(document.snapshots, ({ targetId }) => targetId, context);
  });

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
  .strict()
  .superRefine((document, context) => {
    rejectDuplicateIdentities(document.records, ({ target }) => target, context);
  });

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
  .strict()
  .superRefine((document, context) => {
    rejectDuplicateIdentities(
      [...document.legacyGuards, ...document.guards],
      ({ targetId }) => targetId,
      context,
    );
    rejectDuplicateIdentities(
      [...document.legacyGuards, ...document.guards],
      ({ operationId }) => operationId,
      context,
    );
  });

const legacyGuardDocumentSchema = z
  .object({
    guards: z.array(legacyMutationGuardSchema).max(1_000),
    kind: z.literal("mutation-guards"),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((document, context) => {
    rejectDuplicateIdentities(document.guards, ({ targetId }) => targetId, context);
    rejectDuplicateIdentities(
      document.guards,
      ({ operationId }) => operationId,
      context,
    );
  });

const targetDefinitionSchema = z
  .object({
    connectionReference: z.string().min(1).max(256).nullable(),
    executionBindingDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
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
      (target.kind === "ssh" && target.connectionReference === null) ||
      (target.kind === "local" && target.executionBindingDigest !== null)
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
  .strict()
  .superRefine((document, context) => {
    rejectDuplicateIdentities(document.targets, ({ id }) => id, context);
  });

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
  .strict()
  .superRefine((document, context) => {
    rejectDuplicateIdentities(document.targets, ({ id }) => id, context);
  });

const legacyV2TargetDocumentSchema = z
  .object({
    kind: z.literal("target-definitions"),
    schemaVersion: z.literal(2),
    targets: z
      .array(
        z
          .object({
            connectionReference: z.string().min(1).max(256).nullable(),
            generation: z.number().int().positive(),
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
  .strict()
  .superRefine((document, context) => {
    rejectDuplicateIdentities(document.targets, ({ id }) => id, context);
  });

const guardFailureMarkerSchema = z
  .object({
    failure: z.enum(["corrupt_store", "migration_failed"]),
    kind: z.literal("mutation-guards-failure"),
    schemaVersion: z.literal(1),
  })
  .strict();

const targetFailureMarkerSchema = z
  .object({
    failure: z.enum(["corrupt_store", "migration_failed"]),
    kind: z.literal("target-definitions-failure"),
    schemaVersion: z.literal(1),
  })
  .strict();

const hostTrustFailureMarkerSchema = z
  .object({
    failure: z.literal("corrupt_store"),
    kind: z.literal("host-trust-failure"),
    schemaVersion: z.literal(1),
  })
  .strict();

const collectionAcknowledgementSchema = z
  .object({
    acknowledgedAt: z.string().datetime({ offset: true }),
    collectionId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    kind: z.enum(["release", "delta"]),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    releaseNumber: z.number().int().positive(),
  })
  .strict();

const collectionDocumentSchema = z
  .object({
    acknowledgements: z.array(collectionAcknowledgementSchema).max(1_000),
    kind: z.literal("collection-acknowledgements"),
    schemaVersion: z.literal(CURRENT_COLLECTION_SCHEMA_VERSION),
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
    | typeof GUARD_STORE_NAME
    | typeof HOST_TRUST_STORE_NAME
    | typeof COLLECTION_STORE_NAME
    | typeof STORE_NAME
    | typeof TARGET_STORE_NAME;
}

export type HostTrustRecord = z.infer<typeof hostTrustRecordSchema>;
export type CollectionAcknowledgement = z.infer<
  typeof collectionAcknowledgementSchema
>;

export type DurableTargetDefinition = Omit<
  z.infer<typeof targetDefinitionSchema>,
  "executionBindingDigest"
> & {
  readonly executionBindingDigest?: string | null;
};

export interface MutationGuard {
  readonly deadline: string;
  readonly effects: "none" | "possible";
  readonly generation: number;
  readonly operationId: string;
  readonly phase: "executing" | "reconciliation-required";
  readonly targetId: string;
}

export interface RestoredRecoveryRecords {
  readonly collectionAcknowledgements?: readonly CollectionAcknowledgement[];
  readonly failures: readonly RecoveryFailure[];
  readonly hostTrustRecords: readonly HostTrustRecord[];
  readonly inventorySnapshots: readonly InventorySnapshot[];
  readonly mutationGuards: readonly MutationGuard[];
  readonly targetDefinitions: readonly DurableTargetDefinition[];
}

export type DurableChange =
  | {
      readonly acknowledgements: readonly CollectionAcknowledgement[];
      readonly type: "collections.acknowledgements.replace";
    }
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
      readonly remainingGuards: readonly MutationGuard[];
      readonly type: "guards.clear-corruption";
    }
  | {
      readonly targets: readonly DurableTargetDefinition[];
      readonly type: "targets.replace";
    }
  | {
      readonly fromTargetId: string;
      readonly toTargetId: string;
      readonly type: "target.remap";
    }
  | {
      readonly record: HostTrustRecord;
      readonly type: "host-trust.replace";
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
    flags: "r" | "r+" | "wx",
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
type GuardFailureMarker = z.infer<typeof guardFailureMarkerSchema>;
type TargetDocument = z.infer<typeof targetDocumentSchema>;
type TargetFailureMarker = z.infer<typeof targetFailureMarkerSchema>;
type CollectionDocument = z.infer<typeof collectionDocumentSchema>;

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

function isLegacyTargetId(targetId: string) {
  return (
    legacyTargetIdSchema.safeParse(targetId).success &&
    !targetIdSchema.safeParse(targetId).success
  );
}

function isValidTargetRemap(
  fromTargetId: string,
  toTargetId: string,
) {
  return (
    isLegacyTargetId(fromTargetId) &&
    targetIdSchema.safeParse(toTargetId).success
  );
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

function remapMutationGuardTargetId(
  values: readonly MutationGuard[],
  fromTargetId: string,
  toTargetId: string,
): MutationGuard[] {
  const source = values.find(({ targetId }) => targetId === fromTargetId);
  const destination = values.find(({ targetId }) => targetId === toTargetId);
  if (source === undefined) return [...values];
  if (destination === undefined) {
    return [
      ...values
        .filter(({ targetId }) => targetId === fromTargetId)
        .map((guard) => ({ ...guard, targetId: toTargetId })),
      ...values.filter(({ targetId }) => targetId !== fromTargetId),
    ];
  }

  return [
    ...values.filter(
      ({ targetId }) =>
        targetId !== fromTargetId && targetId !== toTargetId,
    ),
    {
      ...destination,
      deadline:
        Date.parse(source.deadline) > Date.parse(destination.deadline)
          ? source.deadline
          : destination.deadline,
      effects:
        source.effects === "possible" || destination.effects === "possible"
          ? "possible"
          : "none",
      generation: Math.max(source.generation, destination.generation),
      phase:
        source.phase === "reconciliation-required" ||
        destination.phase === "reconciliation-required"
          ? "reconciliation-required"
          : "executing",
      targetId: toTargetId,
    },
  ];
}

export function createMemoryRecoveryRecords(
  initialSnapshots: readonly InventorySnapshot[] = [],
  initialGuards: readonly MutationGuard[] = [],
  initialTargets: readonly DurableTargetDefinition[] = [],
  initialHostTrust: readonly HostTrustRecord[] = [],
  initialCollectionAcknowledgements: readonly CollectionAcknowledgement[] = [],
): RecoveryRecords {
  let snapshots = [...initialSnapshots];
  let mutationGuards = [...initialGuards];
  let targetDefinitions = structuredClone(initialTargets);
  let hostTrustRecords = structuredClone(initialHostTrust);
  let collectionAcknowledgements = structuredClone(
    initialCollectionAcknowledgements,
  );
  return {
    async commit(change) {
      if (change.type === "collections.acknowledgements.replace") {
        const parsed = z
          .array(collectionAcknowledgementSchema)
          .max(1_000)
          .safeParse(change.acknowledgements);
        if (!parsed.success) {
          return commitFailure(
            "persist_failed",
            "Collection Acknowledgement data did not pass durable validation.",
          );
        }
        collectionAcknowledgements = structuredClone(parsed.data);
      } else if (change.type === "target.remap") {
        if (
          !isValidTargetRemap(change.fromTargetId, change.toTargetId)
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
        mutationGuards = remapMutationGuardTargetId(
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
      } else if (change.type === "guards.clear-corruption") {
        return commitFailure(
          "persist_failed",
          "No Mutation Guard corruption marker is present.",
        );
      } else if (change.type === "targets.replace") {
        const parsed = targetDocumentSchema.safeParse({
          kind: "target-definitions",
          schemaVersion: CURRENT_TARGET_SCHEMA_VERSION,
          targets: change.targets,
        });
        if (!parsed.success) {
          return commitFailure(
            "persist_failed",
            "Target data did not pass durable validation.",
          );
        }
        targetDefinitions = structuredClone(parsed.data.targets);
      } else {
        const parsed = hostTrustRecordSchema.safeParse(change.record);
        if (!parsed.success) {
          return commitFailure(
            "persist_failed",
            "Host Trust data did not pass durable validation.",
          );
        }
        hostTrustRecords = [
          ...hostTrustRecords.filter(
            ({ identity }) => identity !== parsed.data.identity,
          ),
          parsed.data,
        ].sort((left, right) => left.identity.localeCompare(right.identity));
      }
      return { ok: true, value: undefined };
    },
    async restore() {
      return {
        collectionAcknowledgements: structuredClone(collectionAcknowledgements),
        failures: [],
        hostTrustRecords: structuredClone(hostTrustRecords),
        inventorySnapshots: structuredClone(snapshots),
        mutationGuards: structuredClone(mutationGuards),
        targetDefinitions: structuredClone(targetDefinitions),
      };
    },
  };
}

function parseHostTrustRecords(raw: string): HostTrustRecord[] | undefined {
  const records: HostTrustRecord[] = [];
  const identities = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    if (line === "") continue;
    const [identity, algorithm, key, ...extra] = line.split(" ");
    const parsed = hostTrustRecordSchema.safeParse({
      algorithm,
      identity,
      key,
    });
    if (
      !parsed.success ||
      extra.length > 0 ||
      identities.has(parsed.data.identity)
    ) {
      return undefined;
    }
    identities.add(parsed.data.identity);
    records.push(parsed.data);
  }
  return records.sort((left, right) =>
    left.identity.localeCompare(right.identity),
  );
}

function serializeHostTrustRecords(records: readonly HostTrustRecord[]) {
  return records
    .map(({ algorithm, identity, key }) => `${identity} ${algorithm} ${key}\n`)
    .join("");
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
  const guardFailureMarkerPath = join(
    options.directory,
    GUARD_FAILURE_MARKER_NAME,
  );
  const targetDocumentPath = join(options.directory, TARGET_DOCUMENT_NAME);
  const targetFailureMarkerPath = join(
    options.directory,
    TARGET_FAILURE_MARKER_NAME,
  );
  const hostTrustPath = join(options.directory, HOST_TRUST_DOCUMENT_NAME);
  const hostTrustFailureMarkerPath = join(
    options.directory,
    HOST_TRUST_FAILURE_MARKER_NAME,
  );
  const collectionDocumentPath = join(
    options.directory,
    COLLECTION_DOCUMENT_NAME,
  );
  const fileSystem = options.fileSystem ?? createNodeRecoveryFileSystem();
  const platform = options.platform ?? process.platform;
  let document: CurrentDocument = {
    kind: "inventory-snapshots",
    legacySnapshots: [],
    schemaVersion: CURRENT_SCHEMA_VERSION,
    snapshots: [],
  };
  let pendingLegacySnapshots: InventorySnapshot[] | undefined;
  let pendingInventoryVersion: 1 | 2 | undefined;
  let pendingLegacySnapshotRaw: string | undefined;
  let failures: RecoveryFailure[] = [];
  let guardDocument: GuardDocument = {
    guards: [],
    kind: "mutation-guards",
    legacyGuards: [],
    schemaVersion: CURRENT_GUARD_SCHEMA_VERSION,
  };
  let pendingLegacyGuards: MutationGuard[] | undefined;
  let pendingLegacyGuardRaw: string | undefined;
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
  let targetStoreMissing = false;
  let hostTrustRecords: HostTrustRecord[] = [];
  let hostTrustFailures: RecoveryFailure[] = [];
  let hostTrustLoaded = false;
  let hostTrustWriteBlocked = false;
  let collectionDocument: CollectionDocument = {
    acknowledgements: [],
    kind: "collection-acknowledgements",
    schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  };
  let collectionFailures: RecoveryFailure[] = [];
  let collectionsLoaded = false;
  let collectionUnsupportedSchema = false;
  let collectionWriteBlocked = false;
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

  const syncPath = async (path: string, flags: "r" | "r+" = "r") => {
    const handle = await fileSystem.open(path, flags);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  const syncParentDirectory = async () => {
    if (platform === "win32") return;
    await syncPath(options.directory);
  };

  const createVerifiedBackup = async (
    sourcePath: string,
    backupPath: string,
    sourceContents?: string,
  ) => {
    const expectedContents =
      sourceContents ?? (await fileSystem.readFile(sourcePath, "utf8"));
    try {
      await fileSystem.copyFile(
        sourcePath,
        backupPath,
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const backupContents = await fileSystem.readFile(backupPath, "utf8");
    if (backupContents !== expectedContents) {
      throw new Error("Pre-existing recovery backup does not match its source.");
    }
    await syncPath(backupPath, platform === "win32" ? "r+" : "r");
    await syncParentDirectory();
  };

  const writeUtf8 = async (
    contents: string,
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
        await handle.writeFile(contents, {
          encoding: "utf8",
        });
        await handle.sync();
      } finally {
        await handle.close();
      }

      await fileSystem.rename(temporaryPath, destinationPath);
      ownsTemporary = false;
      await syncParentDirectory();
    } catch (error) {
      if (ownsTemporary)
        await fileSystem.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  };

  const writeDocument = async (
    nextDocument:
      | CurrentDocument
      | GuardDocument
      | GuardFailureMarker
      | TargetDocument
      | TargetFailureMarker
      | CollectionDocument
      | z.infer<typeof hostTrustFailureMarkerSchema>,
    name = DOCUMENT_NAME,
    destinationPath = documentPath,
  ) => writeUtf8(JSON.stringify(nextDocument), name, destinationPath);

  const quarantine = async () => {
    const quarantinePath = join(
      options.directory,
      `inventory-snapshots.quarantine-${options.id()}.json`,
    );
    await fileSystem.rename(documentPath, quarantinePath);
  };

  const quarantineCollections = async () => {
    const quarantinePath = join(
      options.directory,
      `collection-acknowledgements.quarantine-${options.id()}.json`,
    );
    await fileSystem.rename(collectionDocumentPath, quarantinePath);
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
      pendingLegacySnapshotRaw = raw;
      return;
    }
    try {
      await createVerifiedBackup(
        documentPath,
        `${documentPath}.v${legacyCurrent.success ? 2 : 1}.backup`,
        raw,
      );
      await writeDocument(migrated.data);
      document = migrated.data;
    } catch {
      pendingLegacySnapshots = legacySnapshots;
      pendingInventoryVersion = legacyCurrent.success ? 2 : 1;
      pendingLegacySnapshotRaw = raw;
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
    return quarantinePath;
  };

  const quarantineAndMarkGuards = async (
    failure: GuardFailureMarker["failure"],
  ) => {
    const quarantinePath = await quarantineGuards().catch(() => undefined);
    try {
      await writeDocument(
        {
          failure,
          kind: "mutation-guards-failure",
          schemaVersion: 1,
        },
        GUARD_FAILURE_MARKER_NAME,
        guardFailureMarkerPath,
      );
    } catch (error) {
      if (quarantinePath !== undefined) {
        await fileSystem
          .rename(quarantinePath, guardDocumentPath)
          .catch(() => undefined);
      }
      throw error;
    }
  };

  const loadGuards = async () => {
    if (guardsLoaded) return;
    guardsLoaded = true;
    guardFailures = [];

    try {
      const rawMarker = await fileSystem.readFile(
        guardFailureMarkerPath,
        "utf8",
      );
      const marker = guardFailureMarkerSchema.safeParse(JSON.parse(rawMarker));
      guardWriteBlocked = true;
      guardFailures = [
        {
          code: marker.success ? marker.data.failure : "corrupt_store",
          store: GUARD_STORE_NAME,
        },
      ];
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        guardWriteBlocked = true;
        guardFailures = [{ code: "corrupt_store", store: GUARD_STORE_NAME }];
        return;
      }
    }

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
      await quarantineAndMarkGuards("corrupt_store").catch(() => undefined);
      guardWriteBlocked = true;
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
      await quarantineAndMarkGuards("corrupt_store").catch(() => undefined);
      guardWriteBlocked = true;
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
      pendingLegacyGuardRaw = raw;
      return;
    }
    try {
      await createVerifiedBackup(
        guardDocumentPath,
        `${guardDocumentPath}.v1.backup`,
        raw,
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
    targetStoreMissing = false;

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
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        targetStoreMissing = true;
        return;
      }
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

    const legacyV2 = legacyV2TargetDocumentSchema.safeParse(decoded);
    const legacyV1 = legacyTargetDocumentSchema.safeParse(decoded);
    if (!legacyV2.success && !legacyV1.success) {
      await quarantineAndMarkTargets("corrupt_store").catch(() => undefined);
      targetWriteBlocked = true;
      targetFailures = [{ code: "corrupt_store", store: TARGET_STORE_NAME }];
      return;
    }

    const migrated = targetDocumentSchema.safeParse({
      kind: "target-definitions",
      schemaVersion: CURRENT_TARGET_SCHEMA_VERSION,
      targets: (legacyV2.success
        ? legacyV2.data.targets
        : legacyV1.success
          ? legacyV1.data.targets.map((definition) => ({
              ...definition,
              generation: 1,
            }))
          : []
      ).map((definition) => ({
        ...definition,
        executionBindingDigest: null,
      })),
    });
    if (!migrated.success) {
      await quarantineAndMarkTargets("migration_failed").catch(() => undefined);
      targetWriteBlocked = true;
      targetFailures = [{ code: "migration_failed", store: TARGET_STORE_NAME }];
      return;
    }
    try {
      await createVerifiedBackup(
        targetDocumentPath,
        `${targetDocumentPath}.${legacyV2.success ? "v2" : "v1"}.backup`,
        raw,
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

  const failWhenCurrentGuardsOutliveTargetStore = () => {
    if (!targetStoreMissing || guardDocument.guards.length === 0) return;
    targetWriteBlocked = true;
    if (
      !targetFailures.some(({ store }) => store === TARGET_STORE_NAME)
    ) {
      targetFailures = [
        ...targetFailures,
        { code: "corrupt_store", store: TARGET_STORE_NAME },
      ];
    }
  };

  const quarantineAndMarkHostTrust = async () => {
    const quarantinePath = `${hostTrustPath}.quarantine-${options.id()}`;
    await fileSystem.rename(hostTrustPath, quarantinePath);
    try {
      await writeDocument(
        {
          failure: "corrupt_store",
          kind: "host-trust-failure",
          schemaVersion: 1,
        },
        HOST_TRUST_FAILURE_MARKER_NAME,
        hostTrustFailureMarkerPath,
      );
    } catch (error) {
      await fileSystem
        .rename(quarantinePath, hostTrustPath)
        .catch(() => undefined);
      throw error;
    }
  };

  const loadHostTrust = async () => {
    if (hostTrustLoaded) return;
    hostTrustLoaded = true;
    hostTrustFailures = [];
    try {
      const rawMarker = await fileSystem.readFile(
        hostTrustFailureMarkerPath,
        "utf8",
      );
      const marker = hostTrustFailureMarkerSchema.safeParse(
        JSON.parse(rawMarker),
      );
      hostTrustWriteBlocked = true;
      hostTrustFailures = [
        {
          code: marker.success ? marker.data.failure : "corrupt_store",
          store: HOST_TRUST_STORE_NAME,
        },
      ];
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        hostTrustWriteBlocked = true;
        hostTrustFailures = [
          { code: "corrupt_store", store: HOST_TRUST_STORE_NAME },
        ];
        return;
      }
    }

    let raw: string;
    try {
      raw = await fileSystem.readFile(hostTrustPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      hostTrustWriteBlocked = true;
      hostTrustFailures = [
        { code: "corrupt_store", store: HOST_TRUST_STORE_NAME },
      ];
      return;
    }
    const parsed = parseHostTrustRecords(raw);
    if (parsed === undefined) {
      await quarantineAndMarkHostTrust().catch(() => undefined);
      hostTrustWriteBlocked = true;
      hostTrustFailures = [
        { code: "corrupt_store", store: HOST_TRUST_STORE_NAME },
      ];
      return;
    }
    hostTrustRecords = parsed;
  };

  const loadCollections = async () => {
    if (collectionsLoaded) return;
    collectionsLoaded = true;
    collectionFailures = [];
    let raw: string;
    try {
      raw = await fileSystem.readFile(collectionDocumentPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      collectionWriteBlocked = true;
      collectionFailures = [
        { code: "corrupt_store", store: COLLECTION_STORE_NAME },
      ];
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      const quarantined = await quarantineCollections().then(
        () => true,
        () => false,
      );
      collectionWriteBlocked = !quarantined;
      collectionFailures = [
        { code: "corrupt_store", store: COLLECTION_STORE_NAME },
      ];
      return;
    }
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "schemaVersion" in decoded &&
      typeof decoded.schemaVersion === "number" &&
      decoded.schemaVersion > CURRENT_COLLECTION_SCHEMA_VERSION
    ) {
      collectionUnsupportedSchema = true;
      collectionFailures = [
        { code: "unsupported_schema", store: COLLECTION_STORE_NAME },
      ];
      return;
    }
    const parsed = collectionDocumentSchema.safeParse(decoded);
    if (!parsed.success) {
      const quarantined = await quarantineCollections().then(
        () => true,
        () => false,
      );
      collectionWriteBlocked = !quarantined;
      collectionFailures = [
        { code: "corrupt_store", store: COLLECTION_STORE_NAME },
      ];
      return;
    }
    collectionDocument = parsed.data;
  };

  return {
    commit(change) {
      return underApplicationLock(async () => {
        if (change.type === "collections.acknowledgements.replace") {
          await loadCollections();
          if (collectionUnsupportedSchema) {
            return commitFailure(
              "unsupported_schema",
              "Collection Acknowledgement data was written by a newer unsupported application version.",
            );
          }
          if (collectionWriteBlocked) {
            return commitFailure(
              "persist_failed",
              "Collection Acknowledgement data could not be read safely and will not be overwritten.",
            );
          }
          const parsed = z
            .array(collectionAcknowledgementSchema)
            .max(1_000)
            .safeParse(change.acknowledgements);
          if (!parsed.success) {
            return commitFailure(
              "persist_failed",
              "Collection Acknowledgement data did not pass durable validation.",
            );
          }
          const nextDocument: CollectionDocument = {
            acknowledgements: parsed.data,
            kind: "collection-acknowledgements",
            schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
          };
          try {
            await writeDocument(
              nextDocument,
              COLLECTION_DOCUMENT_NAME,
              collectionDocumentPath,
            );
            collectionDocument = nextDocument;
            collectionFailures = [];
            return { ok: true, value: undefined };
          } catch {
            return commitFailure(
              "persist_failed",
              "Collection Acknowledgements could not be saved.",
            );
          }
        }
        if (change.type === "host-trust.replace") {
          await loadHostTrust();
          if (hostTrustWriteBlocked) {
            return commitFailure(
              "persist_failed",
              "Host Trust data could not be read safely and will not be overwritten.",
            );
          }
          const parsed = hostTrustRecordSchema.safeParse(change.record);
          if (!parsed.success) {
            return commitFailure(
              "persist_failed",
              "Host Trust data did not pass durable validation.",
            );
          }
          const nextRecords = [
            ...hostTrustRecords.filter(
              ({ identity }) => identity !== parsed.data.identity,
            ),
            parsed.data,
          ].sort((left, right) => left.identity.localeCompare(right.identity));
          if (nextRecords.length > 1_000) {
            return commitFailure(
              "persist_failed",
              "Host Trust data exceeds its record limit.",
            );
          }
          try {
            await writeUtf8(
              serializeHostTrustRecords(nextRecords),
              HOST_TRUST_DOCUMENT_NAME,
              hostTrustPath,
            );
            hostTrustRecords = nextRecords;
            hostTrustFailures = [];
            return { ok: true, value: undefined };
          } catch {
            return commitFailure(
              "persist_failed",
              "Host Trust data could not be saved.",
            );
          }
        }
        if (change.type === "target.remap") {
          if (!isValidTargetRemap(change.fromTargetId, change.toTargetId)) {
            return commitFailure(
              "persist_failed",
              "Target identity migration did not pass durable validation.",
            );
          }
          await load();
          await loadGuards();
          await loadTargets();
          failWhenCurrentGuardsOutliveTargetStore();
          if (unsupportedSchema || guardUnsupportedSchema) {
            return commitFailure(
              "unsupported_schema",
              "Recovery data was written by a newer unsupported application version.",
            );
          }
          if (writeBlocked || guardWriteBlocked || targetWriteBlocked) {
            return commitFailure(
              "persist_failed",
              "Recovery data could not be read safely and will not be overwritten.",
            );
          }

          const sourceSnapshots = pendingLegacySnapshots ?? [
            ...document.legacySnapshots,
            ...document.snapshots,
          ];
          const sourceGuards = pendingLegacyGuards ?? [
            ...guardDocument.legacyGuards,
            ...guardDocument.guards,
          ];
          const remappedSnapshots = remapTargetId(
            sourceSnapshots,
            change.fromTargetId,
            change.toTargetId,
          );
          const remappedGuards = remapMutationGuardTargetId(
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
              await createVerifiedBackup(
                documentPath,
                `${documentPath}.v${pendingInventoryVersion ?? 2}.backup`,
                pendingLegacySnapshotRaw,
              );
            }
            if (pendingLegacyGuards !== undefined) {
              await createVerifiedBackup(
                guardDocumentPath,
                `${guardDocumentPath}.v1.backup`,
                pendingLegacyGuardRaw,
              );
            }
            await writeDocument(nextDocument.data);
            document = nextDocument.data;
            pendingLegacySnapshots = undefined;
            pendingInventoryVersion = undefined;
            pendingLegacySnapshotRaw = undefined;
            await writeDocument(
              nextGuardDocument.data,
              GUARD_DOCUMENT_NAME,
              guardDocumentPath,
            );
            guardDocument = nextGuardDocument.data;
            pendingLegacyGuards = undefined;
            pendingLegacyGuardRaw = undefined;
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
          await loadGuards();
          failWhenCurrentGuardsOutliveTargetStore();
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
          const nextTargetDocument = targetDocumentSchema.safeParse({
            kind: "target-definitions",
            schemaVersion: CURRENT_TARGET_SCHEMA_VERSION,
            targets: change.targets,
          });
          if (!nextTargetDocument.success) {
            return commitFailure(
              "persist_failed",
              "Target data did not pass durable validation.",
            );
          }
          try {
            await writeDocument(
              nextTargetDocument.data,
              TARGET_DOCUMENT_NAME,
              targetDocumentPath,
            );
            targetDocument = nextTargetDocument.data;
            targetStoreMissing = false;
            targetFailures = [];
            return { ok: true, value: undefined };
          } catch {
            return commitFailure(
              "persist_failed",
              "Target Definitions could not be saved.",
            );
          }
        }

        if (change.type === "guards.clear-corruption") {
          await loadGuards();
          if (guardUnsupportedSchema) {
            return commitFailure(
              "unsupported_schema",
              "Mutation Guard data was written by a newer unsupported application version.",
            );
          }
          try {
            await fileSystem.readFile(guardFailureMarkerPath, "utf8");
          } catch {
            return commitFailure(
              "persist_failed",
              "No Mutation Guard corruption marker is present.",
            );
          }
          const remainingGuards = z
            .array(mutationGuardSchema)
            .max(1_000)
            .safeParse(change.remainingGuards);
          if (!remainingGuards.success) {
            return commitFailure(
              "persist_failed",
              "Remaining Mutation Guard data did not pass durable validation.",
            );
          }
          const nextGuardDocument = guardDocumentSchema.safeParse({
            guards: remainingGuards.data,
            kind: "mutation-guards",
            legacyGuards: [],
            schemaVersion: CURRENT_GUARD_SCHEMA_VERSION,
          });
          if (!nextGuardDocument.success) {
            return commitFailure(
              "persist_failed",
              "Remaining Mutation Guard data did not pass durable validation.",
            );
          }
          try {
            if (remainingGuards.data.length > 0) {
              await writeDocument(
                nextGuardDocument.data,
                GUARD_DOCUMENT_NAME,
                guardDocumentPath,
              );
            }
            await fileSystem.unlink(guardFailureMarkerPath);
            guardDocument = nextGuardDocument.data;
            pendingLegacyGuards = undefined;
            guardWriteBlocked = false;
            guardFailures = [];
            return { ok: true, value: undefined };
          } catch {
            return commitFailure(
              "persist_failed",
              "The Mutation Guard corruption marker could not be cleared.",
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
        failWhenCurrentGuardsOutliveTargetStore();
        await loadHostTrust();
        await loadCollections();
        return {
          collectionAcknowledgements: structuredClone(
            collectionDocument.acknowledgements,
          ),
          failures: structuredClone([
            ...failures,
            ...guardFailures,
            ...targetFailures,
            ...hostTrustFailures,
            ...collectionFailures,
          ]),
          hostTrustRecords: structuredClone(hostTrustRecords),
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
