import { z } from "zod";

export const rendererErrorCodeSchema = z.enum([
  "cancelled",
  "cli_incompatible",
  "conflicting_inventory_entry",
  "duplicate_inventory_entry",
  "internal_error",
  "invalid_inventory",
  "invalid_request",
  "inventory_too_large",
  "persist_failed",
  "process_failed",
  "target_not_found",
  "target_unavailable",
  "unauthorized",
  "unsupported_schema",
]);

export const rendererErrorSchema = z
  .object({
    code: rendererErrorCodeSchema,
    effects: z.enum(["none", "possible", "confirmed"]),
    message: z.string().min(1).max(512),
    phase: z.string().min(1).max(64),
    retryable: z.boolean(),
  })
  .strict();

export const targetDefinitionSchema = z
  .object({
    generation: z.number().int().positive(),
    harness: z.string().min(1).max(128),
    id: z.string().min(1).max(256),
    kind: z.enum(["local", "ssh"]),
    label: z.string().min(1).max(256),
    workspaceLabel: z.string().min(1).max(512),
  })
  .strict();

const unknownEvidenceSchema = z
  .object({ status: z.literal("unknown") })
  .strict();

export const publicInventoryEntrySchema = z
  .object({
    agents: z.array(z.string().min(1).max(128)).max(256),
    contentFingerprint: unknownEvidenceSchema,
    declaredSource: z
      .object({
        source: z.string().min(1).max(2_048).nullable(),
        sourceType: z.string().min(1).max(128).nullable(),
      })
      .strict(),
    name: z.string().min(1).max(256),
    revision: unknownEvidenceSchema,
    scope: z.enum(["global", "project"]),
  })
  .strict();

export const publicInventoryStateSchema = z
  .object({
    activeOperationId: z.string().min(1).max(256).nullable(),
    cliVersion: z.literal("1.5.23").nullable(),
    entries: z.array(publicInventoryEntrySchema).max(10_000),
    freshness: z.enum(["fresh", "none", "stale"]),
    lastError: rendererErrorSchema.nullable(),
    observedAt: z.string().datetime({ offset: true }).nullable(),
    persistenceWarning: rendererErrorSchema.nullable(),
    phase: z.enum(["cancelled", "error", "loading", "ready"]),
  })
  .strict();

export const workspaceSnapshotSchema = z
  .object({
    eventSequence: z.number().int().nonnegative(),
    inventory: publicInventoryStateSchema,
    schemaVersion: z.literal(1),
    sessionEpoch: z.string().min(1).max(256),
    stateRevision: z.number().int().nonnegative(),
    target: targetDefinitionSchema,
  })
  .strict();

const snapshotChangedEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    sessionEpoch: z.string().min(1).max(256),
    snapshot: workspaceSnapshotSchema,
    stateRevision: z.number().int().positive(),
    type: z.literal("snapshot.changed"),
  })
  .strict();

const resyncRequiredEventSchema = z
  .object({
    reason: z.literal("buffer_overflow"),
    sequence: z.number().int().positive(),
    sessionEpoch: z.string().min(1).max(256),
    stateRevision: z.number().int().positive(),
    type: z.literal("resync.required"),
  })
  .strict();

export const desktopEventSchema = z.discriminatedUnion("type", [
  snapshotChangedEventSchema,
  resyncRequiredEventSchema,
]);

export const workspaceSnapshotResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: workspaceSnapshotSchema }).strict(),
  z.object({ error: rendererErrorSchema, ok: z.literal(false) }).strict(),
]);

export const refreshRequestSchema = z
  .object({
    targetId: z.string().min(1).max(256),
    type: z.literal("inventory.refresh"),
    version: z.literal(1),
  })
  .strict();

export const cancelRequestSchema = z
  .object({
    operationId: z.string().min(1).max(256),
    type: z.literal("inventory.cancel"),
    version: z.literal(1),
  })
  .strict();

export const workspaceRequestSchema = z.discriminatedUnion("type", [
  refreshRequestSchema,
  cancelRequestSchema,
]);

export const workspaceRequestResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      value: z.object({ operationId: z.string().min(1).max(256) }).strict(),
    })
    .strict(),
  z.object({ error: rendererErrorSchema, ok: z.literal(false) }).strict(),
]);

export type DesktopEvent = z.infer<typeof desktopEventSchema>;
export type PublicInventoryEntry = z.infer<typeof publicInventoryEntrySchema>;
export type PublicInventoryState = z.infer<typeof publicInventoryStateSchema>;
export type RendererError = z.infer<typeof rendererErrorSchema>;
export type TargetDefinition = z.infer<typeof targetDefinitionSchema>;
export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>;
export type WorkspaceRequestResult = z.infer<
  typeof workspaceRequestResultSchema
>;
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export type WorkspaceSnapshotResult = z.infer<
  typeof workspaceSnapshotResultSchema
>;

export interface WorkspaceBridge {
  cancelInventory(operationId: string): Promise<WorkspaceRequestResult>;
  getSnapshot(): Promise<WorkspaceSnapshotResult>;
  refreshInventory(targetId: string): Promise<WorkspaceRequestResult>;
  subscribe(listener: (event: DesktopEvent) => void): () => void;
}
