import { z } from "zod";

import { mutationIntentSchema } from "@skills-desktop/skills-runtime";

export const rendererErrorCodeSchema = z.enum([
  "cancelled",
  "cli_incompatible",
  "conflicting_inventory_entry",
  "duplicate_inventory_entry",
  "internal_error",
  "confirmation_expired",
  "confirmation_invalid",
  "invalid_inventory",
  "invalid_intent",
  "invalid_request",
  "inventory_too_large",
  "mutation_conflict",
  "mutation_ineligible",
  "persist_failed",
  "process_failed",
  "reconciliation_required",
  "reconciliation_wait",
  "review_expired",
  "review_invalid",
  "stale_inventory",
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

export const targetIdSchema = z.string().uuid();

export const targetDefinitionSchema = z
  .object({
    connectionReference: z.string().min(1).max(256).nullable().optional(),
    generation: z.number().int().positive(),
    harness: z.string().min(1).max(128),
    id: targetIdSchema,
    kind: z.enum(["local", "ssh"]),
    label: z.string().min(1).max(256),
    workspace: z.string().min(1).max(4_096).optional(),
    workspaceLabel: z.string().min(1).max(512),
  })
  .strict();

export const targetDraftSchema = z
  .object({
    connectionReference: z.string().min(1).max(256).nullable(),
    harness: z.string().min(1).max(128),
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

const unknownEvidenceSchema = z
  .object({ status: z.literal("unknown") })
  .strict();
const knownEvidenceSchema = z
  .object({
    authority: z.string().min(1).max(256),
    kind: z.string().min(1).max(128),
    status: z.literal("known"),
    value: z.string().min(1).max(2_048),
  })
  .strict();
export const inventoryEvidenceSchema = z.discriminatedUnion("status", [
  unknownEvidenceSchema,
  knownEvidenceSchema,
]);

export const publicInventoryEntrySchema = z
  .object({
    agents: z.array(z.string().min(1).max(128)).max(256),
    contentFingerprint: inventoryEvidenceSchema,
    declaredSource: z
      .object({
        source: z.string().min(1).max(2_048).nullable(),
        sourceType: z.string().min(1).max(128).nullable(),
      })
      .strict(),
    name: z.string().min(1).max(256),
    revision: inventoryEvidenceSchema,
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

export const commandPlanSchema = z
  .object({
    harness: z.string().min(1).max(128),
    names: z.array(z.string().min(1).max(256)).min(1).max(128),
    operation: z.enum(["add", "remove", "update"]),
    preview: z.string().min(1).max(16_384),
    schemaVersion: z.literal(1),
    scope: z.enum(["global", "project"]),
    source: z
      .object({
        source: z.string().min(1).max(256),
        sourceType: z.literal("github"),
      })
      .strict()
      .nullable(),
    targetId: targetIdSchema,
    timeoutMs: z.number().int().positive().max(600_000),
  })
  .strict();

export const publicMutationOutcomeSchema = z
  .object({
    effects: z
      .object({
        status: z.enum([
          "content-unverified",
          "not-observed",
          "possible",
          "verified",
        ]),
      })
      .strict(),
    process: z
      .object({
        disposition: z.enum(["cancelled", "completed", "failed", "timed-out"]),
        exitCode: z.number().int().nullable(),
        termination: z.enum(["known", "unknown"]),
      })
      .strict(),
  })
  .strict();

export const publicMutationStateSchema = z
  .object({
    activeOperationId: z.string().min(1).max(256).nullable(),
    commandPlan: commandPlanSchema.nullable(),
    lastError: rendererErrorSchema.nullable(),
    outcome: publicMutationOutcomeSchema.nullable(),
    phase: z.enum([
      "failed",
      "idle",
      "planned",
      "reconciliation-required",
      "reviewing",
      "running",
      "succeeded",
    ]),
    reconciliationDeadline: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const publicTargetStateSchema = z
  .object({
    deletionBlocked: z.boolean(),
    inventory: publicInventoryStateSchema,
    mutation: publicMutationStateSchema,
    target: targetDefinitionSchema,
  })
  .strict();

const comparisonSideSchema = z
  .object({
    entries: z.array(publicInventoryEntrySchema).max(16),
    freshness: z.enum(["fresh", "none", "stale"]),
    harnessAvailability: z.enum(["absent", "available", "unavailable"]),
  })
  .strict();

export const publicComparisonSchema = z
  .object({
    id: z.string().min(1).max(256),
    leftFreshness: z.enum(["fresh", "none", "stale"]),
    leftTargetId: targetIdSchema,
    rightFreshness: z.enum(["fresh", "none", "stale"]),
    rightTargetId: targetIdSchema,
    rows: z
      .array(
        z
          .object({
            dimensions: z
              .object({
                contentFingerprint: z.enum([
                  "drift",
                  "matched",
                  "not-applicable",
                  "unknown",
                ]),
                declaredSource: z.enum([
                  "matched",
                  "mismatch",
                  "not-applicable",
                  "unknown",
                ]),
                presence: z.enum(["both", "left-only", "right-only"]),
                revision: z.enum([
                  "drift",
                  "matched",
                  "not-applicable",
                  "unknown",
                ]),
              })
              .strict(),
            key: z.string().min(1).max(256),
            left: comparisonSideSchema,
            right: comparisonSideSchema,
            summary: z.enum([
              "matched",
              "missing",
              "source-mismatch",
              "unknown-evidence",
              "version-drift",
            ]),
          })
          .strict(),
      )
      .max(5_000),
  })
  .strict();

export const workspaceSnapshotSchema = z
  .object({
    eventSequence: z.number().int().nonnegative(),
    comparison: publicComparisonSchema.nullable().optional(),
    inventory: publicInventoryStateSchema,
    mutation: publicMutationStateSchema,
    schemaVersion: z.literal(1),
    sessionEpoch: z.string().min(1).max(256),
    stateRevision: z.number().int().nonnegative(),
    target: targetDefinitionSchema,
    targets: z.array(publicTargetStateSchema).max(1_000).optional(),
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
    targetId: targetIdSchema,
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

export const prepareMutationRequestSchema = z
  .object({
    intent: mutationIntentSchema,
    targetId: targetIdSchema,
    type: z.literal("mutation.prepare"),
    version: z.literal(1),
  })
  .strict();

export const requestReviewSchema = z
  .object({
    preparedMutationId: z.string().min(1).max(256),
    type: z.literal("review.request"),
    version: z.literal(1),
  })
  .strict();

export const requestCancellationReviewSchema = z
  .object({
    operationId: z.string().min(1).max(256),
    type: z.literal("review.cancel-request"),
    version: z.literal(1),
  })
  .strict();

export const reconcileMutationRequestSchema = z
  .object({
    targetId: targetIdSchema,
    type: z.literal("mutation.reconcile"),
    version: z.literal(1),
  })
  .strict();

export const createTargetRequestSchema = z
  .object({
    definition: targetDraftSchema,
    type: z.literal("target.create"),
    version: z.literal(1),
  })
  .strict();

export const updateTargetRequestSchema = z
  .object({
    definition: targetDraftSchema,
    targetId: targetIdSchema,
    type: z.literal("target.update"),
    version: z.literal(1),
  })
  .strict();

export const deleteTargetRequestSchema = z
  .object({
    targetId: targetIdSchema,
    type: z.literal("target.delete"),
    version: z.literal(1),
  })
  .strict();

export const openComparisonRequestSchema = z
  .object({
    leftTargetId: targetIdSchema,
    rightTargetId: targetIdSchema,
    type: z.literal("comparison.open"),
    version: z.literal(1),
  })
  .strict()
  .refine((request) => request.leftTargetId !== request.rightTargetId);

export const prepareComparisonRequestSchema = z
  .object({
    comparisonId: z.string().min(1).max(256),
    destinationTargetId: targetIdSchema,
    rowKey: z.string().min(1).max(256),
    type: z.literal("comparison.prepare"),
    version: z.literal(1),
  })
  .strict();

export const workspaceRequestSchema = z.discriminatedUnion("type", [
  refreshRequestSchema,
  cancelRequestSchema,
  prepareMutationRequestSchema,
  requestReviewSchema,
  requestCancellationReviewSchema,
  reconcileMutationRequestSchema,
  createTargetRequestSchema,
  updateTargetRequestSchema,
  deleteTargetRequestSchema,
  openComparisonRequestSchema,
  prepareComparisonRequestSchema,
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
export type MutationIntent = z.infer<typeof mutationIntentSchema>;
export type PublicInventoryEntry = z.infer<typeof publicInventoryEntrySchema>;
export type PublicInventoryState = z.infer<typeof publicInventoryStateSchema>;
export type PublicComparison = z.infer<typeof publicComparisonSchema>;
export type PublicMutationState = z.infer<typeof publicMutationStateSchema>;
export type RendererError = z.infer<typeof rendererErrorSchema>;
export type TargetDefinition = z.infer<typeof targetDefinitionSchema>;
export type TargetDraft = z.infer<typeof targetDraftSchema>;
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
  compareTargets(
    leftTargetId: string,
    rightTargetId: string,
  ): Promise<WorkspaceRequestResult>;
  createTarget(definition: TargetDraft): Promise<WorkspaceRequestResult>;
  deleteTarget(targetId: string): Promise<WorkspaceRequestResult>;
  prepareComparison(
    comparisonId: string,
    rowKey: string,
    destinationTargetId: string,
  ): Promise<WorkspaceRequestResult>;
  getSnapshot(): Promise<WorkspaceSnapshotResult>;
  prepareMutation(
    targetId: string,
    intent: MutationIntent,
  ): Promise<WorkspaceRequestResult>;
  reconcileMutation(targetId: string): Promise<WorkspaceRequestResult>;
  refreshInventory(targetId: string): Promise<WorkspaceRequestResult>;
  requestCancellationReview(
    operationId: string,
  ): Promise<WorkspaceRequestResult>;
  requestReview(preparedMutationId: string): Promise<WorkspaceRequestResult>;
  subscribe(listener: (event: DesktopEvent) => void): () => void;
  updateTarget(
    targetId: string,
    definition: TargetDraft,
  ): Promise<WorkspaceRequestResult>;
}
