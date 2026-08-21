import type { Result } from "@skills-desktop/skills-runtime";

import {
  workspaceRequestSchema,
  type DesktopEvent,
  type PublicInventoryEntry,
  type PublicInventoryState,
  type PublicMutationState,
  type RendererError,
  type TargetDefinition as PublicTargetDefinition,
  type WorkspaceRequestResult,
  type WorkspaceSnapshot,
} from "../../contracts/workspace.js";
import {
  reviewDecisionRequestSchema,
  type ReviewSnapshot,
} from "../../contracts/review.js";

import type {
  PreparedMutation,
  SkillsProcess,
} from "../adapters/local-skills-process.js";
import type {
  InventorySnapshot,
  RecoveryRecords,
} from "../persistence/recovery-records.js";

const MAX_RETAINED_REVIEWS = 128;

export type {
  DesktopEvent,
  PublicInventoryEntry,
  PublicInventoryState,
  WorkspaceSnapshot,
} from "../../contracts/workspace.js";

export type TargetOpenError = Omit<RendererError, "code"> & {
  readonly code: "target_not_found" | "target_unavailable";
};

export interface TargetDefinition {
  readonly generation: number;
  readonly harness: string;
  readonly id: string;
  readonly kind: "local" | "ssh";
  readonly label: string;
  readonly workspace: string;
  readonly workspaceLabel: string;
}

export interface EffectiveTargetBinding {
  readonly generation: number;
  readonly harness: string;
  readonly kind: TargetDefinition["kind"];
  readonly targetId: string;
  readonly workspace: string;
}

export interface TargetSession {
  readonly binding: EffectiveTargetBinding;
  readonly process: SkillsProcess;
  readonly target: TargetDefinition;
}

export interface SkillsTargets {
  readonly primaryTarget: TargetDefinition;
  open(targetId: string): Promise<Result<TargetSession, TargetOpenError>>;
}

export interface DesktopEndpoint {
  readonly endpointId: string;
  readonly reviewId?: string;
  readonly role: "review" | "workspace";
  readonly sessionEpoch: string;
}

type RequestValue = { readonly operationId: string };
type RequestError = RendererError;

export interface DesktopSession {
  request(input: unknown): Promise<Result<RequestValue, RequestError>>;
  snapshot(): Promise<ReviewSnapshot | WorkspaceSnapshot>;
  teardown(): void;
}

export interface DesktopCapabilities {
  attach(
    endpoint: DesktopEndpoint,
    sink: (event: DesktopEvent) => void,
  ): DesktopSession;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface DesktopCapabilitiesOptions {
  readonly clock?: () => Date;
  readonly id: () => string;
  readonly onReviewRequested?: (reviewId: string) => void;
  readonly recoveryRecords: RecoveryRecords;
  readonly scheduleEventDelivery?: (deliver: () => void) => void;
  readonly shutdownTimeoutMs?: number;
  readonly skillsTargets: SkillsTargets;
}

interface EndpointState extends DesktopEndpoint {
  closed: boolean;
  deliveryScheduled: boolean;
  pendingEvent: DesktopEvent | undefined;
  sequence: number;
  readonly sink: (event: DesktopEvent) => void;
}

interface ActiveObservation {
  readonly controller: AbortController;
  readonly id: string;
  readonly ownerEndpointId: string;
  readonly promise: Promise<Result<RequestValue, RequestError>>;
}

interface FreshTargetSession extends TargetSession {
  readonly inventory: import("@skills-desktop/skills-runtime").Inventory;
  readonly inventoryId: string;
}

interface TrustedReview {
  decision: "approve" | "reject" | undefined;
  readonly id: string;
  readonly prepared: PreparedMutation;
  readonly purpose: "cancel" | "execute";
}

interface ActiveMutation {
  readonly controller: AbortController;
  readonly id: string;
  readonly prepared?: PreparedMutation;
  readonly promise: Promise<Result<RequestValue, RequestError>>;
}

function publicError<Code extends RequestError["code"]>(
  code: Code,
  message: string,
  phase: string,
  retryable: boolean,
): Omit<RendererError, "code"> & { readonly code: Code } {
  return { code, effects: "none", message, phase, retryable };
}

function requestFailure(error: RequestError): Result<never, RequestError> {
  return { error, ok: false };
}

interface ProjectableInventoryEntry {
  readonly agents: readonly string[];
  readonly declaredSource: PublicInventoryEntry["declaredSource"];
  readonly name: string;
  readonly scope: PublicInventoryEntry["scope"];
}

function projectEntries(
  entries: readonly ProjectableInventoryEntry[],
): PublicInventoryEntry[] {
  return entries.map((entry) => ({
    agents: [...entry.agents],
    contentFingerprint: { status: "unknown" },
    declaredSource: { ...entry.declaredSource },
    name: entry.name,
    revision: { status: "unknown" },
    scope: entry.scope,
  }));
}

function staleAfterFailure(freshness: PublicInventoryState["freshness"]) {
  return freshness === "none" ? "none" : "stale";
}

function projectTarget(target: TargetDefinition): PublicTargetDefinition {
  return {
    generation: target.generation,
    harness: target.harness,
    id: target.id,
    kind: target.kind,
    label: target.label,
    workspaceLabel: target.workspaceLabel,
  };
}

function projectCommandPlan(plan: PreparedMutation["commandPlan"]) {
  return {
    ...plan,
    names: [...plan.names],
    source: plan.source === null ? null : { ...plan.source },
  };
}

export function createDesktopCapabilities(
  options: DesktopCapabilitiesOptions,
): DesktopCapabilities {
  const endpoints = new Map<string, EndpointState>();
  const scheduleEventDelivery = options.scheduleEventDelivery ?? queueMicrotask;
  const clock = options.clock ?? (() => new Date());
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 3_000;
  const target = options.skillsTargets.primaryTarget;
  const publicTarget = projectTarget(target);
  let initialized = false;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  let stateRevision = 0;
  let activeObservation: ActiveObservation | undefined;
  let activeMutation: ActiveMutation | undefined;
  let freshTargetSession: FreshTargetSession | undefined;
  const preparedMutations = new Map<string, PreparedMutation>();
  const reviews = new Map<string, TrustedReview>();
  let inventoryState: PublicInventoryState = {
    activeOperationId: null,
    cliVersion: null,
    entries: [],
    freshness: "none",
    lastError: null,
    observedAt: null,
    persistenceWarning: null,
    phase: "ready",
  };
  let mutationState: PublicMutationState = {
    activeOperationId: null,
    commandPlan: null,
    lastError: null,
    outcome: null,
    phase: "idle",
    reconciliationDeadline: null,
  };

  const pruneReviews = () => {
    if (reviews.size <= MAX_RETAINED_REVIEWS) return;
    for (const [reviewId, review] of reviews) {
      if (review.decision === undefined) continue;
      reviews.delete(reviewId);
      if (reviews.size <= MAX_RETAINED_REVIEWS) return;
    }
  };

  const rejectPendingReviews = (
    predicate: (review: TrustedReview) => boolean = () => true,
  ) => {
    for (const review of reviews.values()) {
      if (review.decision === undefined && predicate(review)) {
        review.decision = "reject";
      }
    }
    pruneReviews();
  };

  const snapshotFor = (
    endpoint: EndpointState,
    eventSequence = endpoint.sequence,
  ): WorkspaceSnapshot => ({
    eventSequence,
    inventory: structuredClone(inventoryState),
    mutation: structuredClone(mutationState),
    schemaVersion: 1,
    sessionEpoch: endpoint.sessionEpoch,
    stateRevision,
    target: publicTarget,
  });

  const enqueue = (endpoint: EndpointState, event: DesktopEvent) => {
    endpoint.pendingEvent =
      endpoint.pendingEvent === undefined
        ? event
        : {
            reason: "buffer_overflow",
            sequence: endpoint.sequence + 1,
            sessionEpoch: endpoint.sessionEpoch,
            stateRevision: event.stateRevision,
            type: "resync.required",
          };
    if (endpoint.deliveryScheduled) return;
    endpoint.deliveryScheduled = true;
    scheduleEventDelivery(() => {
      endpoint.deliveryScheduled = false;
      const pending = endpoint.pendingEvent;
      endpoint.pendingEvent = undefined;
      if (endpoint.closed || pending === undefined) return;
      endpoint.sequence = pending.sequence;
      endpoint.sink(pending);
    });
  };

  const publish = (next: PublicInventoryState) => {
    inventoryState = next;
    stateRevision += 1;
    for (const endpoint of endpoints.values()) {
      if (endpoint.closed || endpoint.role !== "workspace") continue;
      const sequence = endpoint.sequence + 1;
      enqueue(endpoint, {
        sequence,
        sessionEpoch: endpoint.sessionEpoch,
        snapshot: snapshotFor(endpoint, sequence),
        stateRevision,
        type: "snapshot.changed",
      });
    }
  };

  const publishMutation = (next: PublicMutationState) => {
    mutationState = next;
    stateRevision += 1;
    for (const endpoint of endpoints.values()) {
      if (endpoint.closed || endpoint.role !== "workspace") continue;
      const sequence = endpoint.sequence + 1;
      enqueue(endpoint, {
        sequence,
        sessionEpoch: endpoint.sessionEpoch,
        snapshot: snapshotFor(endpoint, sequence),
        stateRevision,
        type: "snapshot.changed",
      });
    }
  };

  const finishWithError = (error: RequestError) => {
    publish({
      ...inventoryState,
      activeOperationId: null,
      freshness: staleAfterFailure(inventoryState.freshness),
      lastError: error,
      persistenceWarning: null,
      phase: error.code === "cancelled" ? "cancelled" : "error",
    });
    return requestFailure(error);
  };

  const runRefresh = async (
    operationId: string,
    controller: AbortController,
  ): Promise<Result<RequestValue, RequestError>> => {
    const opened = await options.skillsTargets.open(target.id);
    if (!opened.ok) return finishWithError(opened.error);

    const observed = await opened.value.process.observeInventory({
      signal: controller.signal,
    });
    if (!observed.ok) return finishWithError(observed.error as RequestError);

    const inventoryId = options.id();
    freshTargetSession = {
      ...opened.value,
      inventory: observed.value,
      inventoryId,
    };
    preparedMutations.clear();
    rejectPendingReviews();
    if (mutationState.phase !== "reconciliation-required") {
      mutationState = {
        activeOperationId: null,
        commandPlan: null,
        lastError: null,
        outcome: null,
        phase: "idle",
        reconciliationDeadline: null,
      };
    }

    const committed = await options.recoveryRecords.commit({
      generation: opened.value.binding.generation,
      inventory: observed.value,
      targetId: opened.value.binding.targetId,
      type: "inventory.replace",
    });

    publish({
      activeOperationId: null,
      cliVersion: observed.value.cliVersion,
      entries: projectEntries(observed.value.entries),
      freshness: "fresh",
      lastError: null,
      observedAt: observed.value.observedAt,
      persistenceWarning: committed.ok ? null : committed.error,
      phase: "ready",
    });

    if (!committed.ok) return requestFailure(committed.error);
    return { ok: true, value: { operationId } };
  };

  const reviewSnapshotFor = (endpoint: EndpointState): ReviewSnapshot => {
    const review =
      endpoint.reviewId === undefined
        ? undefined
        : reviews.get(endpoint.reviewId);
    if (review === undefined) return { schemaVersion: 1, status: "unavailable" };
    if (review.decision !== undefined) {
      return {
        decision: review.decision,
        schemaVersion: 1,
        status: "settled",
      };
    }
    return {
      projection: {
        commandPlan: projectCommandPlan(review.prepared.commandPlan),
        expiresAt: review.prepared.expiresAt,
        purpose: review.purpose,
        reviewId: review.id,
        target: publicTarget,
      },
      schemaVersion: 1,
      status: "pending",
    };
  };

  const enterReconciliation = async (
    operationId: string,
    prepared: PreparedMutation,
    deadline: string,
    error: RendererError,
  ) => {
    await options.recoveryRecords.commit({
      deadline,
      effects: "possible",
      generation: prepared.targetGeneration,
      operationId,
      phase: "reconciliation-required",
      targetId: prepared.targetId,
      type: "guard.put",
    });
    freshTargetSession = undefined;
    inventoryState = {
      ...inventoryState,
      activeOperationId: null,
      freshness: staleAfterFailure(inventoryState.freshness),
    };
    publishMutation({
      activeOperationId: null,
      commandPlan: projectCommandPlan(prepared.commandPlan),
      lastError: error,
      outcome: null,
      phase: "reconciliation-required",
      reconciliationDeadline: deadline,
    });
  };

  const runApprovedMutation = async (
    review: TrustedReview,
    operationId: string,
    session: FreshTargetSession,
    controller: AbortController,
  ): Promise<Result<RequestValue, RequestError>> => {
    const prepared = review.prepared;
    const deadline = new Date(
      clock().getTime() + prepared.commandPlan.timeoutMs,
    ).toISOString();
    const guardCommitted = await options.recoveryRecords.commit({
      deadline,
      effects: "none",
      generation: prepared.targetGeneration,
      operationId,
      phase: "executing",
      targetId: prepared.targetId,
      type: "guard.put",
    });
    if (!guardCommitted.ok) {
      const error = guardCommitted.error as RequestError;
      publishMutation({
        activeOperationId: null,
        commandPlan: projectCommandPlan(prepared.commandPlan),
        lastError: error,
        outcome: null,
        phase: "failed",
        reconciliationDeadline: null,
      });
      return requestFailure(error);
    }

    publishMutation({
      activeOperationId: operationId,
      commandPlan: projectCommandPlan(prepared.commandPlan),
      lastError: null,
      outcome: null,
      phase: "running",
      reconciliationDeadline: null,
    });
    const executed = await session.process.executeConfirmed({
      confirmation: {
        digest: prepared.digest,
        preparedMutationId: prepared.id,
      },
      signal: controller.signal,
    });
    if (!executed.ok) {
      const cleared = await options.recoveryRecords.commit({
        targetId: prepared.targetId,
        type: "guard.clear",
      });
      if (!cleared.ok) {
        await enterReconciliation(
          operationId,
          prepared,
          deadline,
          publicError(
            "reconciliation_required",
            "Recovery is required before another mutation.",
            "recovery",
            false,
          ),
        );
        return requestFailure(cleared.error as RequestError);
      }
      const error = executed.error as RequestError;
      publishMutation({
        activeOperationId: null,
        commandPlan: projectCommandPlan(prepared.commandPlan),
        lastError: error,
        outcome: null,
        phase: "failed",
        reconciliationDeadline: null,
      });
      return requestFailure(error);
    }

    const { value: outcome } = executed;
    if (outcome.process.termination !== "known" || outcome.inventory === null) {
      const error = publicError(
        "reconciliation_required",
        "Mutation effects are uncertain and require reconciliation.",
        "recovery",
        false,
      );
      await enterReconciliation(operationId, prepared, deadline, error);
      return requestFailure({ ...error, effects: "possible" });
    }

    const inventoryCommitted = await options.recoveryRecords.commit({
      generation: prepared.targetGeneration,
      inventory: outcome.inventory,
      targetId: prepared.targetId,
      type: "inventory.replace",
    });
    if (!inventoryCommitted.ok) {
      await enterReconciliation(
        operationId,
        prepared,
        deadline,
        inventoryCommitted.error as RequestError,
      );
      return requestFailure(inventoryCommitted.error as RequestError);
    }
    const guardCleared = await options.recoveryRecords.commit({
      targetId: prepared.targetId,
      type: "guard.clear",
    });
    if (!guardCleared.ok) {
      await enterReconciliation(
        operationId,
        prepared,
        deadline,
        guardCleared.error as RequestError,
      );
      return requestFailure(guardCleared.error as RequestError);
    }

    freshTargetSession = {
      ...session,
      inventory: outcome.inventory,
      inventoryId: `${operationId}:postflight`,
    };
    inventoryState = {
      activeOperationId: null,
      cliVersion: outcome.inventory.cliVersion,
      entries: projectEntries(outcome.inventory.entries),
      freshness: "fresh",
      lastError: null,
      observedAt: outcome.inventory.observedAt,
      persistenceWarning: null,
      phase: "ready",
    };
    const succeeded =
      outcome.process.disposition === "completed" &&
      (outcome.effects.status === "verified" ||
        outcome.effects.status === "content-unverified");
    publishMutation({
      activeOperationId: null,
      commandPlan: projectCommandPlan(prepared.commandPlan),
      lastError: succeeded
        ? null
        : publicError(
            "process_failed",
            "The requested mutation was not fully observed.",
            "postflight",
            false,
          ),
      outcome: {
        effects: structuredClone(outcome.effects),
        process: structuredClone(outcome.process),
      },
      phase: succeeded ? "succeeded" : "failed",
      reconciliationDeadline: null,
    });
    return { ok: true, value: { operationId } };
  };

  const runReconciliation = async (
    operationId: string,
  ): Promise<Result<RequestValue, RequestError>> => {
    const opened = await options.skillsTargets.open(target.id);
    if (!opened.ok) return requestFailure(opened.error);
    const observed = await opened.value.process.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) {
      const error = observed.error as RequestError;
      publishMutation({
        ...mutationState,
        activeOperationId: null,
        lastError: error,
      });
      return requestFailure(error);
    }
    const inventoryCommitted = await options.recoveryRecords.commit({
      generation: opened.value.binding.generation,
      inventory: observed.value,
      targetId: opened.value.binding.targetId,
      type: "inventory.replace",
    });
    if (!inventoryCommitted.ok) {
      publishMutation({
        ...mutationState,
        activeOperationId: null,
        lastError: inventoryCommitted.error,
      });
      return requestFailure(inventoryCommitted.error);
    }
    const guardCleared = await options.recoveryRecords.commit({
      targetId: opened.value.binding.targetId,
      type: "guard.clear",
    });
    if (!guardCleared.ok) {
      publishMutation({
        ...mutationState,
        activeOperationId: null,
        lastError: guardCleared.error,
      });
      return requestFailure(guardCleared.error);
    }

    freshTargetSession = {
      ...opened.value,
      inventory: observed.value,
      inventoryId: `${operationId}:reconciled`,
    };
    inventoryState = {
      activeOperationId: null,
      cliVersion: observed.value.cliVersion,
      entries: projectEntries(observed.value.entries),
      freshness: "fresh",
      lastError: null,
      observedAt: observed.value.observedAt,
      persistenceWarning: null,
      phase: "ready",
    };
    preparedMutations.clear();
    publishMutation({
      activeOperationId: null,
      commandPlan: null,
      lastError: null,
      outcome: null,
      phase: "idle",
      reconciliationDeadline: null,
    });
    return { ok: true, value: { operationId } };
  };

  return {
    attach(endpoint, sink) {
      const endpointState: EndpointState = {
        ...endpoint,
        closed: false,
        deliveryScheduled: false,
        pendingEvent: undefined,
        sequence: 0,
        sink,
      };
      endpoints.set(endpoint.endpointId, endpointState);

      return {
        async request(input) {
          if (shuttingDown) {
            return requestFailure(
              publicError(
                "target_unavailable",
                "The application is shutting down.",
                "shutdown",
                false,
              ),
            );
          }
          if (endpointState.closed) {
            return requestFailure(
              publicError(
                "unauthorized",
                "This window cannot make that request.",
                "authorize",
                false,
              ),
            );
          }

          if (endpointState.role === "review") {
            const parsedDecision = reviewDecisionRequestSchema.safeParse(input);
            const review =
              endpointState.reviewId === undefined
                ? undefined
                : reviews.get(endpointState.reviewId);
            if (
              !parsedDecision.success ||
              review === undefined ||
              review.decision !== undefined
            ) {
              return requestFailure(
                publicError(
                  "unauthorized",
                  "This review window cannot make that request.",
                  "authorize",
                  false,
                ),
              );
            }

            review.decision = parsedDecision.data.decision;
            if (parsedDecision.data.decision === "reject") {
              if (review.purpose === "execute") {
                publishMutation({
                  ...mutationState,
                  activeOperationId: null,
                  lastError: null,
                  phase: "planned",
                });
              }
              return { ok: true, value: { operationId: review.id } };
            }

            if (review.purpose === "cancel") {
              if (
                activeMutation === undefined ||
                activeMutation.prepared?.id !== review.prepared.id
              ) {
                return requestFailure(
                  publicError(
                    "review_invalid",
                    "The active mutation is unavailable for cancellation.",
                    "review",
                    false,
                  ),
                );
              }
              activeMutation.controller.abort();
              return {
                ok: true,
                value: { operationId: activeMutation.id },
              };
            }

            const prepared = preparedMutations.get(review.prepared.id);
            preparedMutations.delete(review.prepared.id);
            const session = freshTargetSession;
            if (
              prepared === undefined ||
              session === undefined ||
              inventoryState.freshness !== "fresh" ||
              prepared.inventoryId !== session.inventoryId ||
              prepared.targetGeneration !== session.binding.generation ||
              prepared.targetId !== session.binding.targetId
            ) {
              const error = publicError(
                "stale_inventory",
                "Target or Inventory state changed before approval.",
                "review",
                true,
              );
              publishMutation({
                ...mutationState,
                activeOperationId: null,
                lastError: error,
                phase: "failed",
              });
              return requestFailure(error);
            }
            if (clock().getTime() >= Date.parse(prepared.expiresAt)) {
              const error = publicError(
                "review_expired",
                "The Trusted Review has expired.",
                "review",
                false,
              );
              publishMutation({
                ...mutationState,
                activeOperationId: null,
                lastError: error,
                phase: "failed",
              });
              return requestFailure(error);
            }
            if (activeMutation !== undefined || activeObservation !== undefined) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for this Target.",
                  "coordinate",
                  true,
                ),
              );
            }

            const operationId = options.id();
            const controller = new AbortController();
            const promise = runApprovedMutation(
              review,
              operationId,
              session,
              controller,
            ).finally(() => {
              if (activeMutation?.id === operationId) activeMutation = undefined;
            });
            activeMutation = {
              controller,
              id: operationId,
              prepared,
              promise,
            };
            return promise;
          }

          const parsed = workspaceRequestSchema.safeParse(input);
          if (!parsed.success) {
            return requestFailure(
              publicError(
                "invalid_request",
                "The request is not supported.",
                "validate",
                false,
              ),
            );
          }

          if (parsed.data.type === "inventory.cancel") {
            if (activeObservation?.id === parsed.data.operationId) {
              activeObservation.controller.abort();
            }
            return {
              ok: true,
              value: { operationId: parsed.data.operationId },
            };
          }

          if (parsed.data.type === "review.request") {
            const prepared = preparedMutations.get(
              parsed.data.preparedMutationId,
            );
            if (
              prepared === undefined ||
              mutationState.commandPlan === null ||
              clock().getTime() >= Date.parse(prepared.expiresAt)
            ) {
              return requestFailure(
                publicError(
                  "review_invalid",
                  "The Prepared Mutation is unavailable for review.",
                  "review",
                  false,
                ),
              );
            }
            const reviewId = options.id();
            rejectPendingReviews(
              (review) =>
                review.purpose === "execute" &&
                review.prepared.id === prepared.id,
            );
            reviews.set(reviewId, {
              decision: undefined,
              id: reviewId,
              prepared,
              purpose: "execute",
            });
            pruneReviews();
            publishMutation({
              ...mutationState,
              lastError: null,
              phase: "reviewing",
            });
            options.onReviewRequested?.(reviewId);
            return { ok: true, value: { operationId: reviewId } };
          }

          if (parsed.data.type === "review.cancel-request") {
            if (
              activeMutation === undefined ||
              activeMutation.id !== parsed.data.operationId ||
              activeMutation.prepared === undefined ||
              mutationState.phase !== "running"
            ) {
              return requestFailure(
                publicError(
                  "review_invalid",
                  "No matching active mutation is available for cancellation.",
                  "review",
                  false,
                ),
              );
            }
            const reviewId = options.id();
            const activePrepared = activeMutation.prepared;
            rejectPendingReviews(
              (review) =>
                review.purpose === "cancel" &&
                review.prepared.id === activePrepared.id,
            );
            reviews.set(reviewId, {
              decision: undefined,
              id: reviewId,
              prepared: activePrepared,
              purpose: "cancel",
            });
            pruneReviews();
            options.onReviewRequested?.(reviewId);
            return { ok: true, value: { operationId: reviewId } };
          }

          if (parsed.data.targetId !== target.id) {
            return requestFailure(
              publicError(
                "target_not_found",
                "Target was not found.",
                "open",
                false,
              ),
            );
          }

          if (parsed.data.type === "mutation.prepare") {
            if (mutationState.phase === "reconciliation-required") {
              return requestFailure(
                publicError(
                  "reconciliation_required",
                  "Reconciliation is required before another mutation.",
                  "prepare",
                  false,
                ),
              );
            }
            if (
              freshTargetSession === undefined ||
              inventoryState.freshness !== "fresh"
            ) {
              return requestFailure(
                publicError(
                  "stale_inventory",
                  "A Fresh Inventory is required to prepare a mutation.",
                  "prepare",
                  true,
                ),
              );
            }
            if (activeMutation !== undefined || activeObservation !== undefined) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for this Target.",
                  "coordinate",
                  true,
                ),
              );
            }
            const prepared = await freshTargetSession.process.prepareMutation({
              freshness: "fresh",
              intent: parsed.data.intent,
              inventory: freshTargetSession.inventory,
              inventoryId: freshTargetSession.inventoryId,
            });
            if (!prepared.ok) return requestFailure(prepared.error as RequestError);
            rejectPendingReviews();
            preparedMutations.clear();
            preparedMutations.set(prepared.value.id, prepared.value);
            publishMutation({
              activeOperationId: null,
              commandPlan: projectCommandPlan(prepared.value.commandPlan),
              lastError: null,
              outcome: null,
              phase: "planned",
              reconciliationDeadline: null,
            });
            return {
              ok: true,
              value: { operationId: prepared.value.id },
            };
          }

          if (parsed.data.type === "mutation.reconcile") {
            if (mutationState.phase !== "reconciliation-required") {
              return requestFailure(
                publicError(
                  "reconciliation_required",
                  "No recoverable mutation was selected for reconciliation.",
                  "reconcile",
                  false,
                ),
              );
            }
            if (
              mutationState.reconciliationDeadline !== null &&
              clock().getTime() <
                Date.parse(mutationState.reconciliationDeadline)
            ) {
              return requestFailure(
                publicError(
                  "reconciliation_wait",
                  "Reconciliation must wait for the original operation deadline.",
                  "reconcile",
                  true,
                ),
              );
            }
            if (activeMutation !== undefined || activeObservation !== undefined) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for this Target.",
                  "coordinate",
                  true,
                ),
              );
            }
            const operationId = options.id();
            publishMutation({
              ...mutationState,
              activeOperationId: operationId,
              lastError: null,
            });
            const promise = runReconciliation(operationId).finally(() => {
              if (activeMutation?.id === operationId) activeMutation = undefined;
            });
            activeMutation = {
              controller: new AbortController(),
              id: operationId,
              promise,
            };
            return promise;
          }

          if (activeMutation !== undefined) {
            return requestFailure(
              publicError(
                "mutation_conflict",
                "A mutation is active for this Target.",
                "coordinate",
                true,
              ),
            );
          }

          if (activeObservation !== undefined) return activeObservation.promise;

          const operationId = options.id();
          const controller = new AbortController();
          publish({
            ...inventoryState,
            activeOperationId: operationId,
            lastError: null,
            persistenceWarning: null,
            phase: "loading",
          });
          const promise = runRefresh(operationId, controller).finally(() => {
            if (activeObservation?.id === operationId)
              activeObservation = undefined;
          });
          activeObservation = {
            controller,
            id: operationId,
            ownerEndpointId: endpoint.endpointId,
            promise,
          };
          return promise;
        },
        async snapshot() {
          return endpointState.role === "review"
            ? reviewSnapshotFor(endpointState)
            : snapshotFor(endpointState);
        },
        teardown() {
          if (endpointState.closed) return;
          endpointState.closed = true;
          endpointState.pendingEvent = undefined;
          endpoints.delete(endpointState.endpointId);
          if (activeObservation?.ownerEndpointId === endpointState.endpointId) {
            activeObservation.controller.abort();
          }
          if (
            endpointState.role === "review" &&
            endpointState.reviewId !== undefined
          ) {
            const review = reviews.get(endpointState.reviewId);
            if (review !== undefined && review.decision === undefined) {
              review.decision = "reject";
              if (review.purpose === "execute") {
                publishMutation({
                  ...mutationState,
                  activeOperationId: null,
                  phase: "planned",
                });
              }
            }
          }
        },
      };
    },
    async initialize() {
      if (initialized) return;
      initialized = true;
      const restored = await options.recoveryRecords.restore();
      const prior = restored.inventorySnapshots.find(
        (snapshot) =>
          snapshot.targetId === target.id &&
          snapshot.generation === target.generation,
      );
      if (prior !== undefined) {
        inventoryState = {
          activeOperationId: null,
          cliVersion: prior.cliVersion,
          entries: projectEntries(prior.entries),
          freshness: "stale",
          lastError: null,
          observedAt: prior.observedAt,
          persistenceWarning: null,
          phase: "ready",
        };
      } else if (restored.failures.length > 0) {
        inventoryState = {
          ...inventoryState,
          lastError: publicError(
            "process_failed",
            "Saved Inventory evidence could not be restored.",
            "restore",
            true,
          ),
          phase: "error",
        };
      }
      const restoredGuard = restored.mutationGuards.find(
        (guard) => guard.targetId === target.id,
      );
      const guardStoreFailed = restored.failures.some(
        (failure) => failure.store === "mutationGuards",
      );
      if (restoredGuard !== undefined || guardStoreFailed) {
        inventoryState = {
          ...inventoryState,
          freshness: staleAfterFailure(inventoryState.freshness),
        };
        mutationState = {
          activeOperationId: null,
          commandPlan: null,
          lastError: {
            ...publicError(
              "reconciliation_required",
              "A prior mutation requires explicit reconciliation.",
              "restore",
              false,
            ),
            effects: "possible",
          },
          outcome: null,
          phase: "reconciliation-required",
          reconciliationDeadline:
            restoredGuard?.deadline ?? clock().toISOString(),
        };
      }
    },
    shutdown() {
      if (shutdownPromise !== undefined) return shutdownPromise;
      shuttingDown = true;
      const observation = activeObservation;
      const mutation = activeMutation;
      observation?.controller.abort();
      rejectPendingReviews();
      shutdownPromise = (async () => {
        const operations = [observation?.promise, mutation?.promise].filter(
          (operation): operation is Promise<Result<RequestValue, RequestError>> =>
            operation !== undefined,
        );
        if (operations.length > 0) {
          let timeout: NodeJS.Timeout | undefined;
          await Promise.race([
            Promise.allSettled(operations).then(() => undefined),
            new Promise<void>((resolve) => {
              timeout = setTimeout(resolve, shutdownTimeoutMs);
            }),
          ]);
          if (timeout !== undefined) clearTimeout(timeout);
        }
        for (const endpoint of endpoints.values())
          endpoint.pendingEvent = undefined;
      })();
      return shutdownPromise;
    },
  };
}
