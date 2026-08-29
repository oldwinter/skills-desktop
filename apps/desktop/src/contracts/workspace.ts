import { z } from "zod";

import {
  HARNESS_REGISTRY_DIGEST,
  HARNESS_REGISTRY_VERSION,
  mutationIntentSchema,
  normalizeHarnessIds,
  SKILLS_DIALECT_ID,
} from "@skills-desktop/skills-runtime";

export const WORKSPACE_PROTOCOL_VERSION = 2 as const;

export const rendererErrorCodeSchema = z.enum([
  "cancelled",
  "cli_incompatible",
  "conflicting_inventory_entry",
  "duplicate_inventory_entry",
  "host_key_changed",
  "host_trust_invalid",
  "host_trust_required",
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
  "remote_protocol_mismatch",
  "remote_protocol_violation",
  "remote_runtime_unavailable",
  "reconciliation_required",
  "reconciliation_wait",
  "review_expired",
  "review_invalid",
  "stale_inventory",
  "ssh_config_invalid",
  "target_not_found",
  "target_unavailable",
  "transport_failed",
  "transport_lost",
  "transport_unavailable",
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

export const harnessIdsSchema = z
  .array(z.string().min(1).max(128))
  .min(1)
  .max(77)
  .superRefine((harnessIds, context) => {
    const normalized = normalizeHarnessIds(harnessIds);
    if (
      !normalized.ok ||
      JSON.stringify(normalized.value) !== JSON.stringify(harnessIds)
    ) {
      context.addIssue({
        code: "custom",
        message: "Harness IDs must be unique and in registry order.",
      });
    }
  });

export const durableTargetDefinitionSchema = z
  .object({
    connectionReference: z.string().min(1).max(256).nullable(),
    dialectId: z.literal(SKILLS_DIALECT_ID),
    executionBindingDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    generation: z.number().int().positive(),
    harnessIds: harnessIdsSchema,
    id: targetIdSchema,
    kind: z.enum(["local", "ssh"]),
    label: z.string().min(1).max(256),
    registryDigest: z.literal(HARNESS_REGISTRY_DIGEST),
    registryVersion: z.literal(HARNESS_REGISTRY_VERSION),
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

export const targetDefinitionSchema = durableTargetDefinitionSchema.safeExtend({
  workspaceLabel: z.string().min(1).max(512),
});

export const blockedTargetDefinitionSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    id: targetIdSchema,
    label: z.string().min(1).max(256),
    legacyHarness: z.string().min(1).max(128),
    reason: z.literal("unsupported_harness"),
  })
  .strict();

export const targetDraftSchema = z
  .object({
    connectionReference: z.string().min(1).max(256).nullable(),
    harnessIds: harnessIdsSchema,
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
    harnessIds: harnessIdsSchema.optional(),
    names: z.array(z.string().min(1).max(256)).min(1).max(128),
    operation: z.enum(["add", "remove", "update"]),
    preview: z.string().min(1).max(16_384),
    schemaVersion: z.literal(1),
    scope: z.enum(["global", "project"]),
    source: z
      .object({
        revision: z
          .string()
          .regex(/^[a-f0-9]{40}$/)
          .optional(),
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

const collectionAssessmentEntrySchema = z
  .object({
    inRelease: z.boolean(),
    name: z.string().min(1).max(256),
    selectable: z.boolean(),
    selectionModes: z.array(z.enum(["add", "reapply"])).max(2),
    status: z.enum([
      "incompatible",
      "missing",
      "present-content-unknown",
      "removal-candidate",
      "source-conflict",
      "unchanged",
    ]),
  })
  .strict();

const collectionAssessmentSchema = z
  .object({
    compatibility: z.enum(["compatible", "incompatible"]),
    entries: z.array(collectionAssessmentEntrySchema).max(256),
    inventoryFreshness: z.enum(["fresh", "none", "stale"]),
    scope: z.enum(["global", "project"]),
    targetGeneration: z.number().int().positive(),
    targetId: targetIdSchema,
  })
  .strict();

const collectionCompatibilitySchema = z
  .object({
    cliVersion: z.literal("1.5.23"),
    harnesses: z.array(z.string().min(1).max(128)).max(64),
    platforms: z.array(z.enum(["darwin", "linux", "win32"])).max(3),
    requiredCapabilities: z.array(z.enum(["local", "ssh"])).max(2),
  })
  .strict();

const collectionReceiptSchema = z
  .object({
    author: z.string().min(1).max(256),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    reviewLocation: z.string().url().max(2_048).nullable(),
    reviewPolicy: z.literal("official-collection-v1"),
    reviewedAt: z.string().datetime({ offset: true }).nullable(),
    reviewer: z.string().min(1).max(256).nullable(),
    schemaVersion: z.literal(1),
    status: z.enum(["approved", "pending"]),
  })
  .strict();

const publicCollectionReleaseSchema = z
  .object({
    assessments: z.array(collectionAssessmentSchema).length(2),
    blockers: z.array(z.string().min(1).max(512)).max(8),
    collectionId: z.string().min(1).max(128),
    compatibility: collectionCompatibilitySchema,
    description: z.string().min(1).max(1_024),
    executable: z.boolean(),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    receipt: collectionReceiptSchema,
    releaseNumber: z.number().int().positive(),
    skills: z.array(z.string().min(1).max(256)).max(128),
    source: z
      .object({
        repository: z.string().min(3).max(256),
        repositoryUrl: z.string().url().max(512),
        reviewedRevision: z.string().regex(/^[a-f0-9]{40}$/),
        sourceType: z.literal("github"),
      })
      .strict(),
    status: z.enum(["active", "deprecated", "revoked"]),
    supersedesDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .nullable(),
    title: z.string().min(1).max(256),
  })
  .strict();

export const collectionAcknowledgementSchema = z
  .object({
    acknowledgedAt: z.string().datetime({ offset: true }),
    collectionId: z.string().min(1).max(128),
    kind: z.enum(["release", "delta"]),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    releaseNumber: z.number().int().positive(),
  })
  .strict();

const collectionSelectionSchema = z
  .object({
    mode: z.enum(["add", "reapply"]),
    name: z.string().min(1).max(256),
  })
  .strict();

const collectionReleaseEvidenceSchema = z
  .object({
    compatibility: collectionCompatibilitySchema,
    receipt: collectionReceiptSchema,
    status: z.enum(["active", "deprecated", "revoked"]),
  })
  .strict();

const publicSingleTargetCollectionPlanSchema = z
  .object({
    assessmentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    childCommandPlan: commandPlanSchema,
    childPreparedDigest: z.string().regex(/^[a-f0-9]{64}$/),
    collectionId: z.string().min(1).max(128),
    expiresAt: z.string().datetime({ offset: true }),
    id: z.string().min(1).max(256),
    inventoryDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    order: z
      .array(
        z
          .object({
            names: z.array(z.string().min(1).max(256)).min(1).max(128),
            position: z.number().int().positive(),
            targetId: targetIdSchema,
          })
          .strict(),
      )
      .length(1),
    releaseEvidence: collectionReleaseEvidenceSchema,
    releaseNumber: z.number().int().positive(),
    reviewDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    schemaVersion: z.literal(1),
    scope: z.enum(["global", "project"]),
    selections: z.array(collectionSelectionSchema).min(1).max(128),
    source: z
      .object({
        repository: z.string().min(3).max(256),
        reviewedRevision: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict(),
    targetGeneration: z.number().int().positive(),
    targetId: targetIdSchema,
  })
  .strict();

const publicMultiTargetCollectionPlanSchema = z
  .object({
    children: z
      .array(
        z
          .object({
            assessmentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            bindingDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            commandPlan: commandPlanSchema,
            inventoryDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            position: z.number().int().positive(),
            preparedDigest: z.string().regex(/^[a-f0-9]{64}$/),
            scope: z.enum(["global", "project"]),
            selections: z.array(collectionSelectionSchema).min(1).max(128),
            target: targetDefinitionSchema,
          })
          .strict(),
      )
      .min(1)
      .max(128),
    collectionId: z.string().min(1).max(128),
    expiresAt: z.string().datetime({ offset: true }),
    id: z.string().min(1).max(256),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    order: z
      .array(
        z
          .object({
            names: z.array(z.string().min(1).max(256)).min(1).max(128),
            position: z.number().int().positive(),
            scope: z.enum(["global", "project"]),
            targetId: targetIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(128),
    releaseEvidence: collectionReleaseEvidenceSchema,
    releaseNumber: z.number().int().positive(),
    reviewDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    schemaVersion: z.literal(2),
    source: z
      .object({
        repository: z.string().min(3).max(256),
        reviewedRevision: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    const targetIds = plan.children.map(({ target }) => target.id);
    const childrenMatchOrder =
      plan.children.length === plan.order.length &&
      plan.children.every((child, index) => {
        const order = plan.order[index];
        const names = child.selections.map(({ name }) => name);
        return (
          order !== undefined &&
          order.position === child.position &&
          order.scope === child.scope &&
          order.targetId === child.target.id &&
          JSON.stringify(order.names) === JSON.stringify(names) &&
          child.commandPlan.operation === "add" &&
          child.commandPlan.scope === child.scope &&
          child.commandPlan.targetId === child.target.id &&
          JSON.stringify(child.commandPlan.names) === JSON.stringify(names) &&
          new Set(names).size === names.length
        );
      });
    if (
      new Set(targetIds).size !== targetIds.length ||
      plan.children.some((child, index) => child.position !== index + 1) ||
      plan.order.some((child, index) => child.position !== index + 1) ||
      !childrenMatchOrder
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Collection children, selections, Command Plans, and stable order must agree.",
      });
    }
  });

export const publicCollectionPlanSchema = z.union([
  publicSingleTargetCollectionPlanSchema,
  publicMultiTargetCollectionPlanSchema,
]);

const publicCollectionExecutionSchema = z
  .object({
    children: z
      .array(
        z
          .object({
            error: rendererErrorSchema.nullable(),
            outcome: publicMutationOutcomeSchema.nullable(),
            position: z.number().int().positive(),
            scope: z.enum(["global", "project"]),
            skills: z
              .array(
                z
                  .object({
                    effects: z
                      .enum([
                        "content-unverified",
                        "not-observed",
                        "possible",
                        "verified",
                      ])
                      .nullable(),
                    mode: z.enum(["add", "reapply"]),
                    name: z.string().min(1).max(256),
                    status: z.enum([
                      "completed",
                      "failed",
                      "pending",
                      "running",
                      "stopped",
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(128),
            status: z.enum([
              "completed",
              "failed",
              "pending",
              "reconciliation-required",
              "running",
              "stopped",
            ]),
            target: targetDefinitionSchema,
          })
          .strict(),
      )
      .min(1)
      .max(128),
    collectionId: z.string().min(1).max(128),
    id: z.string().min(1).max(256),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    phase: z.enum(["completed", "running", "stopped"]),
    reviewDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    semantics: z.literal("non-transactional"),
  })
  .strict();

export const publicCollectionsStateSchema = z
  .object({
    acknowledgements: z.array(collectionAcknowledgementSchema).max(1_000),
    execution: publicCollectionExecutionSchema.nullable().optional(),
    plan: publicCollectionPlanSchema.nullable(),
    releases: z.array(publicCollectionReleaseSchema).max(1_000),
  })
  .strict();

export const publicTargetStateSchema = z
  .object({
    collections: publicCollectionsStateSchema.optional(),
    deletionBlocked: z.boolean(),
    inventory: publicInventoryStateSchema,
    mutation: publicMutationStateSchema,
    target: targetDefinitionSchema,
  })
  .strict();

export const workspaceSnapshotSchema = z
  .object({
    blockedTargets: z.array(blockedTargetDefinitionSchema).max(1_000).optional(),
    eventSequence: z.number().int().nonnegative(),
    comparison: publicComparisonSchema.nullable().optional(),
    collections: publicCollectionsStateSchema.optional(),
    inventory: publicInventoryStateSchema,
    mutation: publicMutationStateSchema,
    schemaVersion: z.literal(WORKSPACE_PROTOCOL_VERSION),
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
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const cancelRequestSchema = z
  .object({
    operationId: z.string().min(1).max(256),
    type: z.literal("inventory.cancel"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const prepareMutationRequestSchema = z
  .object({
    intent: mutationIntentSchema,
    targetId: targetIdSchema,
    type: z.literal("mutation.prepare"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const requestReviewSchema = z
  .object({
    preparedMutationId: z.string().min(1).max(256),
    type: z.literal("review.request"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const requestHostTrustReviewSchema = z
  .object({
    targetId: targetIdSchema,
    type: z.literal("host-trust.review"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const requestCancellationReviewSchema = z
  .object({
    operationId: z.string().min(1).max(256),
    type: z.literal("review.cancel-request"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const reconcileMutationRequestSchema = z
  .object({
    targetId: targetIdSchema,
    type: z.literal("mutation.reconcile"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const createTargetRequestSchema = z
  .object({
    definition: targetDraftSchema,
    type: z.literal("target.create"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const updateTargetRequestSchema = z
  .object({
    definition: targetDraftSchema,
    targetId: targetIdSchema,
    type: z.literal("target.update"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const deleteTargetRequestSchema = z
  .object({
    targetId: targetIdSchema,
    type: z.literal("target.delete"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const openComparisonRequestSchema = z
  .object({
    leftTargetId: targetIdSchema,
    rightTargetId: targetIdSchema,
    type: z.literal("comparison.open"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict()
  .refine((request) => request.leftTargetId !== request.rightTargetId);

export const prepareComparisonRequestSchema = z
  .object({
    comparisonId: z.string().min(1).max(256),
    destinationTargetId: targetIdSchema,
    rowKey: z.string().min(1).max(256),
    type: z.literal("comparison.prepare"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const prepareCollectionRequestSchema = z
  .object({
    collectionId: z.string().min(1).max(128),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    releaseNumber: z.number().int().positive(),
    scope: z.enum(["global", "project"]),
    selections: z
      .array(
        z
          .object({
            mode: z.enum(["add", "reapply"]),
            name: z.string().min(1).max(256),
          })
          .strict(),
      )
      .min(1)
      .max(128)
      .refine(
        (selections) =>
          new Set(selections.map(({ name }) => name)).size ===
          selections.length,
      ),
    targetId: targetIdSchema,
    type: z.literal("collection.prepare"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const prepareCollectionAcrossTargetsRequestSchema = z
  .object({
    collectionId: z.string().min(1).max(128),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    releaseNumber: z.number().int().positive(),
    targets: z
      .array(
        z
          .object({
            scope: z.enum(["global", "project"]),
            selections: z
              .array(collectionSelectionSchema)
              .min(1)
              .max(128)
              .refine(
                (selections) =>
                  new Set(selections.map(({ name }) => name)).size ===
                  selections.length,
              ),
            targetId: targetIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(128)
      .refine(
        (targets) =>
          new Set(targets.map(({ targetId }) => targetId)).size ===
          targets.length,
      ),
    type: z.literal("collection.prepare-many"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const requestCollectionReviewSchema = z
  .object({
    collectionPlanId: z.string().min(1).max(256),
    type: z.literal("collection.review.request"),
    version: z.literal(WORKSPACE_PROTOCOL_VERSION),
  })
  .strict();

export const workspaceRequestSchema = z.discriminatedUnion("type", [
  refreshRequestSchema,
  cancelRequestSchema,
  prepareMutationRequestSchema,
  requestReviewSchema,
  requestHostTrustReviewSchema,
  requestCancellationReviewSchema,
  reconcileMutationRequestSchema,
  createTargetRequestSchema,
  updateTargetRequestSchema,
  deleteTargetRequestSchema,
  openComparisonRequestSchema,
  prepareComparisonRequestSchema,
  prepareCollectionRequestSchema,
  prepareCollectionAcrossTargetsRequestSchema,
  requestCollectionReviewSchema,
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
export type PublicCollectionsState = z.infer<
  typeof publicCollectionsStateSchema
>;
export type PublicCollectionPlan = z.infer<typeof publicCollectionPlanSchema>;
export type PublicSingleTargetCollectionPlan = z.infer<
  typeof publicSingleTargetCollectionPlanSchema
>;
export type PublicMultiTargetCollectionPlan = z.infer<
  typeof publicMultiTargetCollectionPlanSchema
>;
export type PublicCollectionExecution = z.infer<
  typeof publicCollectionExecutionSchema
>;
export type PrepareCollectionRequest = z.infer<
  typeof prepareCollectionRequestSchema
>;
export type PrepareCollectionAcrossTargetsRequest = z.infer<
  typeof prepareCollectionAcrossTargetsRequestSchema
>;
export type PublicMutationState = z.infer<typeof publicMutationStateSchema>;
export type RendererError = z.infer<typeof rendererErrorSchema>;
export type DurableTargetDefinition = z.infer<
  typeof durableTargetDefinitionSchema
>;
export type TargetDefinition = z.infer<typeof targetDefinitionSchema>;
export type BlockedTargetDefinition = z.infer<
  typeof blockedTargetDefinitionSchema
>;
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
  prepareCollection(
    request: Omit<PrepareCollectionRequest, "type" | "version">,
  ): Promise<WorkspaceRequestResult>;
  prepareCollectionAcrossTargets(
    request: Omit<PrepareCollectionAcrossTargetsRequest, "type" | "version">,
  ): Promise<WorkspaceRequestResult>;
  getSnapshot(): Promise<WorkspaceSnapshotResult>;
  prepareMutation(
    targetId: string,
    intent: MutationIntent,
  ): Promise<WorkspaceRequestResult>;
  reconcileMutation(targetId: string): Promise<WorkspaceRequestResult>;
  refreshInventory(targetId: string): Promise<WorkspaceRequestResult>;
  requestHostTrustReview(targetId: string): Promise<WorkspaceRequestResult>;
  requestCollectionReview(
    collectionPlanId: string,
  ): Promise<WorkspaceRequestResult>;
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
