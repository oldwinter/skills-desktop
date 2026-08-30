import { posix } from "node:path";

import type { Result } from "@skills-desktop/skills-runtime";

import type { RestartGuardReason } from "../../contracts/about.js";

import { GITHUB_SOURCE_OWNER_REPOSITORY_COPY } from "../../contracts/user-facing-error.js";
import {
  isGithubOwnerRepository,
  WORKSPACE_PROTOCOL_VERSION,
  workspaceRequestSchema,
  type DesktopEvent,
  type PublicInventoryEntry,
  type PublicInventoryState,
  type PublicCollectionPlan,
  type PublicCollectionExecution,
  type PublicMultiTargetCollectionPlan,
  type PublicSingleTargetCollectionPlan,
  type PublicMutationState,
  type RendererError,
  type BlockedTargetDefinition,
  type DurableTargetDefinition,
  type TargetDefinition as PublicTargetDefinition,
  type WorkspaceSnapshot,
} from "../../contracts/workspace.js";
import {
  REVIEW_PROTOCOL_VERSION,
  reviewDecisionRequestSchema,
  type ReviewSnapshot,
} from "../../contracts/review.js";

import type { PreparedMutation } from "../adapters/skills-process.js";
import type {
  CollectionAcknowledgement,
  InventorySnapshot,
  MutationGuard,
  RecoveryRecords,
} from "../persistence/recovery-records.js";
import type {
  SkillsTargets,
  TargetDefinition,
  TargetSession,
} from "../targets/skills-targets.js";
import {
  isLocalWorkspaceRoot,
  localWorkspaceLabel,
} from "../targets/workspace-path.js";
import type { HostTrustChallenge } from "../ssh/openssh-target.js";
import { compareTargetInventories } from "./comparison.js";
import {
  EMPTY_OFFICIAL_COLLECTION_CATALOG,
  digestCanonicalJson,
  projectOfficialCollections,
  type OfficialCollectionCatalog,
  validateOfficialCollectionCatalog,
} from "./official-collections.js";

const MAX_RETAINED_REVIEWS = 128;

export type {
  DesktopEvent,
  PublicInventoryEntry,
  PublicInventoryState,
  WorkspaceSnapshot,
} from "../../contracts/workspace.js";

export type {
  EffectiveTargetBinding,
  SkillsTargets,
  TargetDefinition,
  TargetOpenError,
  TargetSession,
} from "../targets/skills-targets.js";

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
  restartSafety(): { readonly guardReasons: readonly RestartGuardReason[] };
  shutdown(): Promise<void>;
}

export interface DesktopCapabilitiesOptions {
  readonly clock?: () => Date;
  readonly id: () => string;
  readonly officialCollectionCatalog?: unknown;
  readonly platform?: NodeJS.Platform;
  readonly onReviewRequested?: (reviewId: string) => void;
  readonly recoveryRecords: RecoveryRecords;
  readonly scheduleEventDelivery?: (deliver: () => void) => void;
  readonly shutdownTimeoutMs?: number;
  readonly skillsTargets: SkillsTargets;
  readonly v1LocalOnlyTargets?: boolean;
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
  readonly targetId: string;
}

interface FreshTargetSession extends TargetSession {
  readonly inventory: import("@skills-desktop/skills-runtime").Inventory;
  readonly inventoryId: string;
}

interface TrustedReview {
  readonly collectionPlan?: CollectionPlan;
  decision: "approve" | "reject" | undefined;
  readonly id: string;
  readonly ownerEndpointId: string;
  readonly prepared: PreparedMutation;
  readonly purpose: "cancel" | "execute";
}

interface CollectionPlan {
  readonly preparedIds: readonly string[];
  readonly projection: PublicCollectionPlan;
}

interface HostTrustReview {
  readonly challenge: HostTrustChallenge;
  decision: "approve" | "reject" | undefined;
  readonly id: string;
  readonly ownerEndpointId: string;
  readonly targetId: string;
}

interface ActiveMutation {
  readonly controller: AbortController;
  readonly id: string;
  readonly prepared?: PreparedMutation;
  readonly promise: Promise<Result<RequestValue, RequestError>>;
}

interface ActivePreparation {
  readonly dependentTargetIds: readonly string[];
  invalidated: boolean;
  readonly ownerEndpointId: string;
  promise: Promise<Result<RequestValue, RequestError>> | undefined;
  readonly session: FreshTargetSession;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInvalidGithubAddSourceRequest(input: unknown): boolean {
  if (!isRecord(input) || input.type !== "mutation.prepare") return false;
  if (!isRecord(input.intent) || input.intent.type !== "add") return false;
  if (!isRecord(input.intent.source)) return false;
  const source = input.intent.source.source;
  return typeof source === "string" && !isGithubOwnerRepository(source);
}

function isSingleTargetCollectionPlan(
  plan: PublicCollectionPlan,
): plan is PublicSingleTargetCollectionPlan {
  return plan.schemaVersion === 1;
}

interface ProjectableInventoryEntry {
  readonly agents: readonly string[];
  readonly contentFingerprint: PublicInventoryEntry["contentFingerprint"];
  readonly declaredSource: PublicInventoryEntry["declaredSource"];
  readonly name: string;
  readonly revision: PublicInventoryEntry["revision"];
  readonly scope: PublicInventoryEntry["scope"];
}

function projectEntries(
  entries: readonly ProjectableInventoryEntry[],
): PublicInventoryEntry[] {
  return entries.map((entry) => ({
    agents: [...entry.agents],
    contentFingerprint: { ...entry.contentFingerprint },
    declaredSource: { ...entry.declaredSource },
    name: entry.name,
    revision: { ...entry.revision },
    scope: entry.scope,
  }));
}

function remapRecoveredTargetId<Value extends { readonly targetId: string }>(
  values: readonly Value[],
  fromTargetId: string,
  toTargetId: string,
): Value[] {
  const byTarget = new Map<string, Value>();
  for (const value of values) {
    if (value.targetId === fromTargetId) {
      byTarget.set(toTargetId, { ...value, targetId: toTargetId });
    }
  }
  for (const value of values) {
    if (value.targetId !== fromTargetId) byTarget.set(value.targetId, value);
  }
  return [...byTarget.values()];
}

function staleAfterFailure(freshness: PublicInventoryState["freshness"]) {
  return freshness === "none" ? "none" : "stale";
}

function targetGenerationStaleError() {
  return publicError(
    "stale_inventory",
    "Target Definition changed; refresh before preparing a mutation.",
    "target",
    true,
  );
}

function projectTarget(target: TargetDefinition): PublicTargetDefinition {
  return {
    connectionReference: target.connectionReference ?? null,
    dialectId: target.dialectId,
    executionBindingDigest: target.executionBindingDigest,
    generation: target.generation,
    harnessIds: [...target.harnessIds],
    id: target.id,
    kind: target.kind,
    label: target.label,
    registryDigest: target.registryDigest,
    registryVersion: target.registryVersion,
    workspace: target.workspace,
    workspaceLabel: target.workspaceLabel,
  };
}

function durableTarget(target: TargetDefinition): DurableTargetDefinition {
  return {
    connectionReference: target.connectionReference ?? null,
    dialectId: target.dialectId,
    executionBindingDigest: target.executionBindingDigest ?? null,
    generation: target.generation,
    harnessIds: [...target.harnessIds],
    id: target.id,
    kind: target.kind,
    label: target.label,
    registryDigest: target.registryDigest,
    registryVersion: target.registryVersion,
    workspace: target.workspace,
  };
}

function targetFromDurable(target: DurableTargetDefinition): TargetDefinition {
  return {
    ...target,
    executionBindingDigest: target.executionBindingDigest ?? null,
    workspaceLabel:
      target.kind === "ssh"
        ? posix.basename(target.workspace) || target.workspace
        : localWorkspaceLabel(target.workspace),
  };
}

function repairPersistedRootWorkspaces(
  definitions: readonly TargetDefinition[],
  startupTarget: TargetDefinition,
): {
  readonly changed: boolean;
  readonly definitions: readonly TargetDefinition[];
} {
  if (
    startupTarget.kind !== "local" ||
    isLocalWorkspaceRoot(startupTarget.workspace)
  ) {
    return { changed: false, definitions };
  }
  let changed = false;
  const repaired = definitions.map((definition) => {
    if (
      definition.kind !== "local" ||
      !isLocalWorkspaceRoot(definition.workspace)
    ) {
      return definition;
    }
    changed = true;
    return {
      ...definition,
      executionBindingDigest: null,
      generation: definition.generation + 1,
      workspace: startupTarget.workspace,
      workspaceLabel: localWorkspaceLabel(startupTarget.workspace),
    };
  });
  return { changed, definitions: repaired };
}

function emptyInventoryState(): PublicInventoryState {
  return {
    activeOperationId: null,
    cliVersion: null,
    entries: [],
    freshness: "none",
    lastError: null,
    observedAt: null,
    persistenceWarning: null,
    phase: "ready",
  };
}

function emptyMutationState(): PublicMutationState {
  return {
    activeOperationId: null,
    commandPlan: null,
    lastError: null,
    outcome: null,
    phase: "idle",
    reconciliationDeadline: null,
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
  const platform = options.platform ?? process.platform;
  let officialCollectionCatalog: OfficialCollectionCatalog =
    EMPTY_OFFICIAL_COLLECTION_CATALOG;
  const startupTarget = options.skillsTargets.primaryTarget;
  let target = startupTarget;
  const targetDefinitions = () => options.skillsTargets.definitions;
  const guardedTargetIds = new Set<string>();
  const reservedTargetIds = new Set<string>();
  let initialized = false;
  let recoveryUncertain = false;
  let guardStoreCorrupted = false;
  let targetAuthorityUnavailable = false;
  let blockedTargetDefinitions: readonly BlockedTargetDefinition[] = [];
  let targetDefinitionsChanging = false;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  let stateRevision = 0;
  let activeObservation: ActiveObservation | undefined;
  let activeMutation: ActiveMutation | undefined;
  let activePreparation: ActivePreparation | undefined;
  let freshTargetSession: FreshTargetSession | undefined;
  const preparedMutations = new Map<string, PreparedMutation>();
  const preparedDependencies = new Map<string, readonly string[]>();
  const reviews = new Map<string, TrustedReview>();
  const collectionPlans = new Map<string, CollectionPlan>();
  const hostTrustReviews = new Map<string, HostTrustReview>();
  let inventoryState: PublicInventoryState = emptyInventoryState();
  let mutationState: PublicMutationState = emptyMutationState();
  let collectionAcknowledgements: CollectionAcknowledgement[] = [];
  let collectionExecution: PublicCollectionExecution | undefined;
  let currentCollectionPlan: CollectionPlan | undefined;
  const inventoryStates = new Map<string, PublicInventoryState>();
  const mutationStates = new Map<string, PublicMutationState>();
  const freshTargetSessions = new Map<string, FreshTargetSession>();
  const recoverableSnapshots = new Map<string, InventorySnapshot>();
  const recoverableGuards = new Map<string, MutationGuard>();
  let comparisonSelection:
    | {
        readonly id: string;
        readonly leftTargetId: string;
        readonly rightTargetId: string;
      }
    | undefined;

  const stateFromRecoveredRecords = (
    definition: TargetDefinition,
    snapshot: InventorySnapshot | undefined,
    guard: MutationGuard | undefined,
    currentInventory = emptyInventoryState(),
    currentMutation = emptyMutationState(),
  ) => {
    let inventory = currentInventory;
    if (snapshot !== undefined) {
      inventory = {
        activeOperationId: null,
        cliVersion: snapshot.cliVersion,
        entries: projectEntries(snapshot.entries),
        freshness: "stale",
        lastError:
          snapshot.generation === definition.generation
            ? null
            : targetGenerationStaleError(),
        observedAt: snapshot.observedAt,
        persistenceWarning: null,
        phase: "ready",
      };
    }
    let mutation = currentMutation;
    if (guard !== undefined) {
      inventory = {
        ...inventory,
        freshness: staleAfterFailure(inventory.freshness),
      };
      mutation = {
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
        reconciliationDeadline: guard.deadline,
      };
    }
    return { inventory, mutation };
  };

  const storeActiveTargetState = () => {
    inventoryStates.set(target.id, structuredClone(inventoryState));
    mutationStates.set(target.id, structuredClone(mutationState));
    if (freshTargetSession === undefined) freshTargetSessions.delete(target.id);
    else freshTargetSessions.set(target.id, freshTargetSession);
  };

  const activateTarget = (definition: TargetDefinition) => {
    storeActiveTargetState();
    target = definition;
    inventoryState = structuredClone(
      inventoryStates.get(definition.id) ?? emptyInventoryState(),
    );
    mutationState = structuredClone(
      mutationStates.get(definition.id) ?? emptyMutationState(),
    );
    freshTargetSession = freshTargetSessions.get(definition.id);
  };

  const inventoryForTarget = (targetId: string) =>
    targetId === target.id
      ? inventoryState
      : (inventoryStates.get(targetId) ?? emptyInventoryState());

  const currentComparison = () => {
    const selection = comparisonSelection;
    if (selection === undefined) return null;
    const leftTarget = targetDefinitions().find(
      ({ id }) => id === selection.leftTargetId,
    );
    const rightTarget = targetDefinitions().find(
      ({ id }) => id === selection.rightTargetId,
    );
    if (leftTarget === undefined || rightTarget === undefined) return null;
    return compareTargetInventories({
      id: selection.id,
      leftInventory: inventoryForTarget(leftTarget.id),
      leftTarget: projectTarget(leftTarget),
      rightInventory: inventoryForTarget(rightTarget.id),
      rightTarget: projectTarget(rightTarget),
    });
  };

  const pruneReviews = () => {
    if (reviews.size <= MAX_RETAINED_REVIEWS) return;
    for (const [reviewId, review] of reviews) {
      if (review.decision === undefined) continue;
      reviews.delete(reviewId);
      if (reviews.size <= MAX_RETAINED_REVIEWS) return;
    }
  };

  const pruneHostTrustReviews = () => {
    for (const [reviewId, review] of hostTrustReviews) {
      if (hostTrustReviews.size < MAX_RETAINED_REVIEWS) return;
      if (review.decision === undefined) continue;
      hostTrustReviews.delete(reviewId);
    }
    while (hostTrustReviews.size >= MAX_RETAINED_REVIEWS) {
      const oldest = hostTrustReviews.entries().next().value as
        [string, HostTrustReview] | undefined;
      if (oldest === undefined) return;
      oldest[1].decision ??= "reject";
      hostTrustReviews.delete(oldest[0]);
    }
  };

  const rejectPendingHostTrustReviews = () => {
    for (const review of hostTrustReviews.values()) {
      review.decision ??= "reject";
    }
    pruneHostTrustReviews();
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

  const invalidatePreparedForTarget = (targetId: string) => {
    const invalidatedDestinationIds = new Set<string>();
    const invalidatedPreparedIds = new Set<string>();
    for (const [preparedId, prepared] of preparedMutations) {
      const dependencies = preparedDependencies.get(preparedId) ?? [
        prepared.targetId,
      ];
      if (!dependencies.includes(targetId)) continue;
      preparedMutations.delete(preparedId);
      preparedDependencies.delete(preparedId);
      invalidatedDestinationIds.add(prepared.targetId);
      invalidatedPreparedIds.add(preparedId);
    }
    for (const destinationTargetId of invalidatedDestinationIds) {
      if (destinationTargetId === target.id) {
        mutationState = emptyMutationState();
      } else {
        mutationStates.set(destinationTargetId, emptyMutationState());
      }
    }
    for (const [planId, plan] of collectionPlans) {
      if (
        !plan.preparedIds.some((preparedId) =>
          invalidatedPreparedIds.has(preparedId),
        )
      )
        continue;
      collectionPlans.delete(planId);
      if (currentCollectionPlan?.projection.id === planId) {
        currentCollectionPlan = undefined;
      }
    }
    rejectPendingReviews(
      (review) =>
        invalidatedPreparedIds.has(review.prepared.id) ||
        (
          preparedDependencies.get(review.prepared.id) ?? [
            review.prepared.targetId,
          ]
        ).includes(targetId),
    );
  };

  const discardCollectionPlan = (plan: CollectionPlan) => {
    collectionPlans.delete(plan.projection.id);
    for (const preparedId of plan.preparedIds) {
      preparedMutations.delete(preparedId);
      preparedDependencies.delete(preparedId);
    }
    if (currentCollectionPlan === plan) currentCollectionPlan = undefined;
    rejectPendingReviews(
      (review) =>
        review.collectionPlan === plan ||
        plan.preparedIds.includes(review.prepared.id),
    );
  };

  const targetChangeConflict = () =>
    requestFailure(
      publicError(
        "mutation_conflict",
        "Target Definitions are changing.",
        "coordinate",
        true,
      ),
    );

  const reserveTargetDefinitions = async (
    change: () => Promise<Result<RequestValue, RequestError>>,
  ) => {
    if (targetDefinitionsChanging) return targetChangeConflict();
    targetDefinitionsChanging = true;
    try {
      return await change();
    } finally {
      targetDefinitionsChanging = false;
    }
  };

  const collectionsForTarget = (
    definition: TargetDefinition,
    inventory: PublicInventoryState,
  ) =>
    projectOfficialCollections({
      acknowledgements: collectionAcknowledgements,
      catalog: officialCollectionCatalog,
      inventory,
      platform,
      plan:
        currentCollectionPlan !== undefined &&
        (currentCollectionPlan.projection.schemaVersion === 1
          ? currentCollectionPlan.projection.targetId === definition.id
          : currentCollectionPlan.projection.children.some(
              ({ target }) => target.id === definition.id,
            ))
          ? currentCollectionPlan.projection
          : null,
      target: projectTarget(definition),
    });

  const snapshotFor = (
    endpoint: EndpointState,
    eventSequence = endpoint.sequence,
  ): WorkspaceSnapshot => ({
    blockedTargets: structuredClone([...blockedTargetDefinitions]),
    comparison: structuredClone(currentComparison()),
    collections: {
      ...collectionsForTarget(target, inventoryState),
      execution: structuredClone(collectionExecution ?? null),
    },
    eventSequence,
    inventory: structuredClone(inventoryState),
    mutation: structuredClone(mutationState),
    schemaVersion: WORKSPACE_PROTOCOL_VERSION,
    sessionEpoch: endpoint.sessionEpoch,
    stateRevision,
    target: projectTarget(target),
    targets: targetDefinitions().map((definition) => {
      const isActive = definition.id === target.id;
      const targetInventory = isActive
        ? structuredClone(inventoryState)
        : structuredClone(
            inventoryStates.get(definition.id) ?? emptyInventoryState(),
          );
      return {
        collections: {
          ...collectionsForTarget(definition, targetInventory),
          execution: structuredClone(collectionExecution ?? null),
        },
        deletionBlocked:
          guardedTargetIds.has(definition.id) ||
          reservedTargetIds.has(definition.id) ||
          targetDefinitions().length === 1,
        inventory: targetInventory,
        mutation: isActive
          ? structuredClone(mutationState)
          : structuredClone(
              mutationStates.get(definition.id) ?? emptyMutationState(),
            ),
        target: projectTarget(definition),
      };
    }),
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
    storeActiveTargetState();
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
    storeActiveTargetState();
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

  const publishCollectionExecution = (next: PublicCollectionExecution) => {
    collectionExecution = next;
    publish({ ...inventoryState });
  };

  const publishMutationForTarget = (
    targetId: string,
    next: PublicMutationState,
  ) => {
    if (targetId === target.id) {
      publishMutation(next);
      return;
    }
    mutationStates.set(targetId, structuredClone(next));
    publish({ ...inventoryState });
  };

  const rejectReviewState = (review: TrustedReview) => {
    const reviewedTargetIds =
      review.collectionPlan?.projection.schemaVersion === 2
        ? review.collectionPlan.projection.children.map(
            ({ target: childTarget }) => childTarget.id,
          )
        : [review.prepared.targetId];
    for (const reviewedTargetId of reviewedTargetIds) {
      const reviewedMutation =
        reviewedTargetId === target.id
          ? mutationState
          : (mutationStates.get(reviewedTargetId) ?? emptyMutationState());
      publishMutationForTarget(reviewedTargetId, {
        ...reviewedMutation,
        activeOperationId: null,
        phase: "planned",
      });
    }
  };

  const rejectTrustedReview = (review: TrustedReview) => {
    if (review.decision !== undefined) return;
    review.decision = "reject";
    if (review.purpose !== "execute") return;
    if (review.collectionPlan !== undefined) {
      discardCollectionPlan(review.collectionPlan);
    }
    rejectReviewState(review);
  };

  const runPreparation = (
    endpoint: EndpointState,
    session: FreshTargetSession,
    intent: import("@skills-desktop/skills-runtime").MutationIntent,
    dependentTargetIds: readonly string[] = [session.binding.targetId],
  ) => {
    const preparation: ActivePreparation = {
      dependentTargetIds: [...new Set(dependentTargetIds)],
      invalidated: false,
      ownerEndpointId: endpoint.endpointId,
      promise: undefined,
      session,
    };
    activePreparation = preparation;
    const promise = (async (): Promise<Result<RequestValue, RequestError>> => {
      try {
        const prepared = await preparation.session.process.prepareMutation({
          freshness: "fresh",
          intent,
          inventory: preparation.session.inventory,
          inventoryId: preparation.session.inventoryId,
        });
        if (preparation.invalidated) {
          return requestFailure(
            publicError(
              "cancelled",
              "Mutation preparation was invalidated before completion.",
              "prepare",
              true,
            ),
          );
        }
        if (!prepared.ok) return requestFailure(prepared.error as RequestError);
        const preparedTargetId = preparation.session.binding.targetId;
        invalidatePreparedForTarget(preparedTargetId);
        preparedMutations.set(prepared.value.id, prepared.value);
        preparedDependencies.set(
          prepared.value.id,
          preparation.dependentTargetIds,
        );
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
      } finally {
        if (activePreparation === preparation) {
          activePreparation = undefined;
        }
      }
    })();
    preparation.promise = promise;
    return promise;
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
    let opened = await options.skillsTargets.open(target.id);
    if (!opened.ok) return finishWithError(opened.error);

    if ("status" in opened.value && opened.value.status === "binding-changed") {
      const proposal = opened.value.proposal;
      const committed = await options.recoveryRecords.commit({
        targets: proposal.definitions.map(durableTarget),
        type: "targets.replace",
      });
      if (!committed.ok) return finishWithError(committed.error);
      options.skillsTargets.replaceDefinitions(proposal.definitions);
      target = proposal.target;
      freshTargetSession = undefined;
      freshTargetSessions.delete(target.id);
      invalidatePreparedForTarget(target.id);
      inventoryState = {
        ...inventoryState,
        freshness: staleAfterFailure(inventoryState.freshness),
        lastError: targetGenerationStaleError(),
      };
      mutationState = emptyMutationState();
      storeActiveTargetState();
      opened = await options.skillsTargets.open(target.id);
      if (!opened.ok) return finishWithError(opened.error);
    }
    if ("status" in opened.value) {
      const trustChanged =
        opened.value.status === "trust-required" &&
        opened.value.challenge.kind === "rotation";
      return finishWithError(
        publicError(
          opened.value.status === "trust-required"
            ? trustChanged
              ? "host_key_changed"
              : "host_trust_required"
            : "target_unavailable",
          opened.value.status === "trust-required"
            ? trustChanged
              ? "The SSH host key changed and requires explicit rotation review."
              : "This SSH Target requires explicit host-key review."
            : "The Target binding changed during opening.",
          "trust",
          false,
        ),
      );
    }

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
    const hostTrustReview =
      endpoint.reviewId === undefined
        ? undefined
        : hostTrustReviews.get(endpoint.reviewId);
    if (hostTrustReview !== undefined) {
      if (hostTrustReview.decision !== undefined) {
        return {
          decision: hostTrustReview.decision,
          schemaVersion: REVIEW_PROTOCOL_VERSION,
          status: "settled",
        };
      }
      const reviewedTarget = targetDefinitions().find(
        ({ id }) => id === hostTrustReview.targetId,
      );
      if (reviewedTarget === undefined) {
        return {
          schemaVersion: REVIEW_PROTOCOL_VERSION,
          status: "unavailable",
        };
      }
      return {
        projection: {
          algorithm: hostTrustReview.challenge.algorithm,
          expiresAt: hostTrustReview.challenge.expiresAt,
          fingerprint: hostTrustReview.challenge.fingerprint,
          identity: hostTrustReview.challenge.identity,
          reviewId: hostTrustReview.id,
          target: projectTarget(reviewedTarget),
          trustAction: hostTrustReview.challenge.kind,
        },
        schemaVersion: REVIEW_PROTOCOL_VERSION,
        status: "pending",
      };
    }
    const review =
      endpoint.reviewId === undefined
        ? undefined
        : reviews.get(endpoint.reviewId);
    if (review === undefined)
      return {
        schemaVersion: REVIEW_PROTOCOL_VERSION,
        status: "unavailable",
      };
    if (review.decision !== undefined) {
      return {
        decision: review.decision,
        schemaVersion: REVIEW_PROTOCOL_VERSION,
        status: "settled",
      };
    }
    if (review.collectionPlan !== undefined) {
      return {
        projection: {
          collectionPlan: structuredClone(review.collectionPlan.projection),
          expiresAt: review.prepared.expiresAt,
          reviewId: review.id,
          target: projectTarget(
            targetDefinitions().find(
              ({ id }) => id === review.prepared.targetId,
            ) ?? target,
          ),
        },
        schemaVersion: REVIEW_PROTOCOL_VERSION,
        status: "pending",
      };
    }
    return {
      projection: {
        commandPlan: projectCommandPlan(review.prepared.commandPlan),
        expiresAt: review.prepared.expiresAt,
        purpose: review.purpose,
        reviewId: review.id,
        target: projectTarget(
          targetDefinitions().find(
            ({ id }) => id === review.prepared.targetId,
          ) ?? target,
        ),
      },
      schemaVersion: REVIEW_PROTOCOL_VERSION,
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
    guardedTargetIds.add(prepared.targetId);
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
    prepared: PreparedMutation,
    operationId: string,
    session: FreshTargetSession,
    controller: AbortController,
  ): Promise<Result<RequestValue, RequestError>> => {
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
    guardedTargetIds.add(prepared.targetId);

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
      guardedTargetIds.delete(prepared.targetId);
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
    guardedTargetIds.delete(prepared.targetId);

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

  const runApprovedCollection = async (
    review: TrustedReview,
    operationId: string,
    controller: AbortController,
  ): Promise<Result<RequestValue, RequestError>> => {
    const plan = review.collectionPlan;
    if (
      plan === undefined ||
      plan.projection.schemaVersion !== 2 ||
      currentCollectionPlan !== plan ||
      collectionPlans.get(plan.projection.id) !== plan
    ) {
      return requestFailure(
        publicError(
          "review_invalid",
          "The Collection Plan is unavailable for execution.",
          "review",
          false,
        ),
      );
    }
    const projection = plan.projection;
    const release = officialCollectionCatalog.releases.find(
      (candidate) =>
        candidate.manifest.collectionId === projection.collectionId &&
        candidate.manifest.releaseNumber === projection.releaseNumber &&
        candidate.manifestDigest === projection.manifestDigest &&
        candidate.manifest.status === "active" &&
        candidate.receipt.status === "approved",
    );
    const {
      id: _planId,
      reviewDigest: _reviewDigest,
      ...reviewEvidence
    } = projection;
    const children = projection.children.map((child, index) => {
      const preparedId = plan.preparedIds[index];
      const prepared =
        preparedId === undefined
          ? undefined
          : preparedMutations.get(preparedId);
      const definition = targetDefinitions().find(
        ({ id }) => id === child.target.id,
      );
      const session =
        child.target.id === target.id
          ? freshTargetSession
          : freshTargetSessions.get(child.target.id);
      const inventory = inventoryForTarget(child.target.id);
      const mutation =
        child.target.id === target.id
          ? mutationState
          : (mutationStates.get(child.target.id) ?? emptyMutationState());
      const assessment =
        definition === undefined
          ? undefined
          : projectOfficialCollections({
              catalog: officialCollectionCatalog,
              inventory,
              platform,
              target: projectTarget(definition),
            })
              .releases.find(
                (candidate) =>
                  candidate.collectionId === projection.collectionId &&
                  candidate.releaseNumber === projection.releaseNumber &&
                  candidate.manifestDigest === projection.manifestDigest,
              )
              ?.assessments.find(({ scope }) => scope === child.scope);
      return {
        assessment,
        child,
        definition,
        inventory,
        mutation,
        prepared,
        session,
      };
    });
    const invalid =
      release === undefined ||
      clock().getTime() >= Date.parse(projection.expiresAt) ||
      plan.preparedIds.length !== projection.children.length ||
      digestCanonicalJson(reviewEvidence) !== projection.reviewDigest ||
      digestCanonicalJson(projection.releaseEvidence) !==
        digestCanonicalJson({
          compatibility: release?.manifest.compatibility,
          receipt: release?.receipt,
          status: release?.manifest.status,
        }) ||
      children.some(
        ({
          assessment,
          child,
          definition,
          inventory,
          mutation,
          prepared,
          session,
        }) =>
          definition === undefined ||
          session === undefined ||
          prepared === undefined ||
          inventory.freshness !== "fresh" ||
          mutation.phase === "reconciliation-required" ||
          guardedTargetIds.has(child.target.id) ||
          reservedTargetIds.has(child.target.id) ||
          definition.generation !== child.target.generation ||
          session.binding.targetId !== child.target.id ||
          session.binding.generation !== child.target.generation ||
          prepared.targetId !== child.target.id ||
          prepared.targetGeneration !== child.target.generation ||
          prepared.inventoryId !== session.inventoryId ||
          prepared.digest !== child.preparedDigest ||
          digestCanonicalJson(session.binding) !== child.bindingDigest ||
          digestCanonicalJson({
            inventory: session.inventory,
            inventoryId: session.inventoryId,
            targetGeneration: session.binding.generation,
          }) !== child.inventoryDigest ||
          assessment === undefined ||
          digestCanonicalJson(assessment) !== child.assessmentDigest,
      );
    if (invalid) {
      discardCollectionPlan(plan);
      const error = publicError(
        "review_invalid",
        "A selected Target or Collection Plan changed before reservation.",
        "review",
        false,
      );
      return requestFailure(error);
    }

    for (const { child } of children) reservedTargetIds.add(child.target.id);
    try {
      const acknowledgement: CollectionAcknowledgement = {
        acknowledgedAt: clock().toISOString(),
        collectionId: projection.collectionId,
        kind: "release",
        manifestDigest: projection.manifestDigest,
        releaseNumber: projection.releaseNumber,
      };
      const nextAcknowledgements = [
        ...collectionAcknowledgements.filter(
          ({ collectionId }) => collectionId !== acknowledgement.collectionId,
        ),
        acknowledgement,
      ].sort((left, right) =>
        left.collectionId.localeCompare(right.collectionId),
      );
      const acknowledged = await options.recoveryRecords.commit({
        acknowledgements: nextAcknowledgements,
        type: "collections.acknowledgements.replace",
      });
      if (!acknowledged.ok) {
        discardCollectionPlan(plan);
        return requestFailure(acknowledged.error);
      }
      collectionAcknowledgements = nextAcknowledgements;

      const confirmedChildren = children.map(
        ({ child, prepared, session }) => ({
          child,
          prepared: prepared!,
          session: session!,
        }),
      );
      for (const preparedId of plan.preparedIds) {
        preparedMutations.delete(preparedId);
        preparedDependencies.delete(preparedId);
      }
      collectionPlans.delete(projection.id);
      if (currentCollectionPlan === plan) currentCollectionPlan = undefined;

      let execution: PublicCollectionExecution = {
        children: confirmedChildren.map(({ child }) => ({
          error: null,
          outcome: null,
          position: child.position,
          scope: child.scope,
          skills: child.selections.map(({ mode, name }) => ({
            effects: null,
            mode,
            name,
            status: "pending",
          })),
          status: "pending",
          target: structuredClone(child.target),
        })),
        collectionId: projection.collectionId,
        id: operationId,
        manifestDigest: projection.manifestDigest,
        phase: "running",
        reviewDigest: projection.reviewDigest,
        semantics: "non-transactional",
      };
      publishCollectionExecution(execution);

      for (let index = 0; index < confirmedChildren.length; index += 1) {
        const confirmedChild = confirmedChildren[index]!;
        const definition = targetDefinitions().find(
          ({ id }) => id === confirmedChild.child.target.id,
        )!;
        if (definition.id !== target.id) activateTarget(definition);
        execution = {
          ...execution,
          children: execution.children.map((child, childIndex) =>
            childIndex === index
              ? {
                  ...child,
                  skills: child.skills.map((skill) => ({
                    ...skill,
                    status: "running",
                  })),
                  status: "running",
                }
              : child,
          ),
        };
        publishCollectionExecution(execution);
        if (activeMutation !== undefined) {
          activeMutation = {
            ...activeMutation,
            prepared: confirmedChild.prepared,
          };
        }
        const result = await runApprovedMutation(
          confirmedChild.prepared,
          operationId,
          confirmedChild.session,
          controller,
        );
        const succeeded = result.ok && mutationState.phase === "succeeded";
        const observedChildError = succeeded
          ? null
          : (mutationState.lastError ??
            (result.ok
              ? publicError(
                  "process_failed",
                  "The Collection child did not complete safely.",
                  "collection",
                  false,
                )
              : result.error));
        const childError =
          observedChildError !== null &&
          mutationState.phase === "reconciliation-required"
            ? { ...observedChildError, effects: "possible" as const }
            : observedChildError;
        const childOutcome = mutationState.outcome;
        const childEffects =
          childOutcome?.effects.status ??
          (mutationState.phase === "reconciliation-required"
            ? "possible"
            : null);
        const postflightAssessment =
          childOutcome !== null && inventoryState.freshness === "fresh"
            ? projectOfficialCollections({
                catalog: officialCollectionCatalog,
                inventory: inventoryState,
                platform,
                target: projectTarget(definition),
              })
                .releases.find(
                  (candidate) =>
                    candidate.collectionId === projection.collectionId &&
                    candidate.releaseNumber === projection.releaseNumber &&
                    candidate.manifestDigest === projection.manifestDigest,
                )
                ?.assessments.find(
                  (assessment) =>
                    assessment.scope === confirmedChild.child.scope,
                )
            : undefined;
        execution = {
          ...execution,
          children: execution.children.map((child, childIndex) => {
            if (childIndex === index) {
              return {
                ...child,
                error: childError,
                outcome: childOutcome,
                skills: child.skills.map((skill) => {
                  const skillAssessment = postflightAssessment?.entries.find(
                    ({ name }) => name === skill.name,
                  );
                  const skillEffects =
                    skillAssessment?.status === "unchanged"
                      ? "verified"
                      : skillAssessment?.status === "present-content-unknown"
                        ? "content-unverified"
                        : skillAssessment === undefined
                          ? childEffects
                          : "not-observed";
                  const skillSucceeded =
                    childOutcome?.process.disposition === "completed" &&
                    (skillEffects === "verified" ||
                      skillEffects === "content-unverified");
                  return {
                    ...skill,
                    effects: skillEffects,
                    status: skillSucceeded ? "completed" : "failed",
                  };
                }),
                status: succeeded
                  ? "completed"
                  : mutationState.phase === "reconciliation-required"
                    ? "reconciliation-required"
                    : "failed",
              };
            }
            if (!succeeded && childIndex > index) {
              return {
                ...child,
                skills: child.skills.map((skill) => ({
                  ...skill,
                  status: "stopped",
                })),
                status: "stopped",
              };
            }
            return child;
          }),
          phase: succeeded ? execution.phase : "stopped",
        };
        publishCollectionExecution(execution);
        if (!succeeded) {
          for (
            let childIndex = 0;
            childIndex < confirmedChildren.length;
            childIndex += 1
          ) {
            const { child } = confirmedChildren[childIndex]!;
            const childInventory = inventoryForTarget(child.target.id);
            const staleInventory: PublicInventoryState = {
              ...childInventory,
              freshness: staleAfterFailure(childInventory.freshness),
            };
            inventoryStates.set(child.target.id, staleInventory);
            freshTargetSessions.delete(child.target.id);
            if (childIndex > index) {
              const stoppedMutation =
                child.target.id === target.id
                  ? mutationState
                  : (mutationStates.get(child.target.id) ??
                    emptyMutationState());
              mutationStates.set(child.target.id, {
                ...stoppedMutation,
                activeOperationId: null,
                lastError: publicError(
                  "process_failed",
                  "Collection execution stopped before this Target was mutated.",
                  "collection",
                  false,
                ),
                outcome: null,
                phase: "failed",
                reconciliationDeadline: null,
              });
            }
            if (child.target.id === target.id) {
              inventoryState = structuredClone(staleInventory);
              freshTargetSession = undefined;
            }
          }
          publishCollectionExecution(execution);
          return requestFailure(childError!);
        }
      }
      execution = { ...execution, phase: "completed" };
      publishCollectionExecution(execution);
      return { ok: true, value: { operationId } };
    } finally {
      for (const { child } of children)
        reservedTargetIds.delete(child.target.id);
    }
  };

  const runReconciliation = async (
    operationId: string,
  ): Promise<Result<RequestValue, RequestError>> => {
    const opened = await options.skillsTargets.open(target.id);
    if (!opened.ok) return requestFailure(opened.error);
    if ("status" in opened.value) {
      return requestFailure(
        publicError(
          "target_unavailable",
          "The Target is not ready for reconciliation.",
          "open",
          true,
        ),
      );
    }
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
    const reconciledTargetId = opened.value.binding.targetId;
    const guardCleared = await options.recoveryRecords.commit({
      targetId: reconciledTargetId,
      type: "guard.clear",
    });
    if (!guardCleared.ok) {
      if (!guardStoreCorrupted) {
        publishMutation({
          ...mutationState,
          activeOperationId: null,
          lastError: guardCleared.error,
        });
        return requestFailure(guardCleared.error);
      }
      const remainingGuards = [...guardedTargetIds]
        .filter((targetId) => targetId !== reconciledTargetId)
        .flatMap((targetId) => {
          const definition = targetDefinitions().find(
            ({ id }) => id === targetId,
          );
          const remainingState =
            targetId === target.id
              ? mutationState
              : mutationStates.get(targetId);
          if (definition === undefined || remainingState === undefined) {
            return [];
          }
          return [
            {
              deadline:
                remainingState.reconciliationDeadline ??
                clock().toISOString(),
              effects: "possible" as const,
              generation: definition.generation,
              operationId: options.id(),
              phase: "reconciliation-required" as const,
              targetId,
            },
          ];
        });
      const corruptionCleared = await options.recoveryRecords.commit({
        remainingGuards,
        type: "guards.clear-corruption",
      });
      if (!corruptionCleared.ok) {
        publishMutation({
          ...mutationState,
          activeOperationId: null,
          lastError: corruptionCleared.error,
        });
        return requestFailure(corruptionCleared.error);
      }
      guardStoreCorrupted = false;
      recoveryUncertain = targetAuthorityUnavailable;
    }
    guardedTargetIds.delete(opened.value.binding.targetId);

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
    invalidatePreparedForTarget(opened.value.binding.targetId);
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
            const hostTrustReview =
              endpointState.reviewId === undefined
                ? undefined
                : hostTrustReviews.get(endpointState.reviewId);
            if (hostTrustReview !== undefined) {
              if (
                !parsedDecision.success ||
                hostTrustReview.decision !== undefined
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
              if (parsedDecision.data.decision === "reject") {
                hostTrustReview.decision = "reject";
                return {
                  ok: true,
                  value: { operationId: hostTrustReview.id },
                };
              }
              if (
                targetDefinitionsChanging ||
                activePreparation !== undefined ||
                activeMutation !== undefined ||
                activeObservation !== undefined
              ) {
                return requestFailure(
                  publicError(
                    "mutation_conflict",
                    "Another operation is active for a Target.",
                    "coordinate",
                    true,
                  ),
                );
              }
              const reviewedTarget = targetDefinitions().find(
                ({ id }) => id === hostTrustReview.targetId,
              );
              if (
                reviewedTarget === undefined ||
                reviewedTarget.generation !==
                  hostTrustReview.challenge.targetGeneration ||
                clock().getTime() >=
                  Date.parse(hostTrustReview.challenge.expiresAt)
              ) {
                return requestFailure(
                  publicError(
                    "host_trust_invalid",
                    "The host-trust review is unavailable or expired.",
                    "trust",
                    false,
                  ),
                );
              }
              targetDefinitionsChanging = true;
              try {
                const proposed = options.skillsTargets.proposeHostTrust(
                  reviewedTarget.id,
                  hostTrustReview.challenge.id,
                );
                if (!proposed.ok) return requestFailure(proposed.error);
                hostTrustReview.decision = "approve";
                const committed = await options.recoveryRecords.commit({
                  targets: proposed.value.definitions.map(durableTarget),
                  type: "targets.replace",
                });
                if (!committed.ok) return requestFailure(committed.error);
                const confirmed = await options.skillsTargets.commitHostTrust(
                  reviewedTarget.id,
                  hostTrustReview.challenge.id,
                  reviewedTarget.generation,
                );
                options.skillsTargets.replaceDefinitions(
                  proposed.value.definitions,
                );
                const replacement = proposed.value.target;
                freshTargetSessions.delete(replacement.id);
                invalidatePreparedForTarget(replacement.id);
                const priorInventory =
                  replacement.id === target.id
                    ? inventoryState
                    : (inventoryStates.get(replacement.id) ??
                      emptyInventoryState());
                const nextInventory: PublicInventoryState = {
                  ...priorInventory,
                  activeOperationId: null,
                  freshness: staleAfterFailure(priorInventory.freshness),
                  lastError: targetGenerationStaleError(),
                  phase: "ready",
                };
                inventoryStates.set(replacement.id, nextInventory);
                mutationStates.set(replacement.id, emptyMutationState());
                if (replacement.id === target.id) {
                  target = replacement;
                  freshTargetSession = undefined;
                  inventoryState = nextInventory;
                  mutationState = emptyMutationState();
                }
                if (!confirmed.ok) {
                  hostTrustReview.decision = "reject";
                  publish({ ...inventoryState });
                  return requestFailure(confirmed.error);
                }
                publish({ ...inventoryState });
                return {
                  ok: true,
                  value: { operationId: hostTrustReview.id },
                };
              } finally {
                targetDefinitionsChanging = false;
              }
            }
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

            if (targetDefinitionsChanging && review.purpose === "execute") {
              return targetChangeConflict();
            }
            if (
              (activePreparation !== undefined ||
                activeMutation !== undefined ||
                activeObservation !== undefined) &&
              review.purpose === "execute"
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for a Target.",
                  "coordinate",
                  true,
                ),
              );
            }

            review.decision = parsedDecision.data.decision;
            if (parsedDecision.data.decision === "reject") {
              if (review.purpose === "execute") {
                if (review.collectionPlan !== undefined) {
                  discardCollectionPlan(review.collectionPlan);
                }
                rejectReviewState(review);
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

            if (review.collectionPlan?.projection.schemaVersion === 2) {
              const operationId = options.id();
              const controller = new AbortController();
              const promise = runApprovedCollection(
                review,
                operationId,
                controller,
              ).finally(() => {
                if (activeMutation?.id === operationId) {
                  activeMutation = undefined;
                }
              });
              activeMutation = {
                controller,
                id: operationId,
                prepared: review.prepared,
                promise,
              };
              return promise;
            }

            const reviewedTarget = targetDefinitions().find(
              ({ id }) => id === review.prepared.targetId,
            );
            if (
              reviewedTarget !== undefined &&
              reviewedTarget.id !== target.id
            ) {
              activateTarget(reviewedTarget);
            }

            const prepared = preparedMutations.get(review.prepared.id);
            preparedMutations.delete(review.prepared.id);
            preparedDependencies.delete(review.prepared.id);
            const session = freshTargetSession;
            if (
              prepared === undefined ||
              session === undefined ||
              inventoryState.freshness !== "fresh" ||
              prepared.inventoryId !== session.inventoryId ||
              prepared.targetGeneration !== session.binding.generation ||
              prepared.targetId !== session.binding.targetId
            ) {
              if (review.collectionPlan !== undefined) {
                discardCollectionPlan(review.collectionPlan);
              }
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
              if (review.collectionPlan !== undefined) {
                discardCollectionPlan(review.collectionPlan);
              }
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
            if (
              activeMutation !== undefined ||
              activeObservation !== undefined ||
              activePreparation !== undefined
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for this Target.",
                  "coordinate",
                  true,
                ),
              );
            }

            const reviewedCollectionPlan = review.collectionPlan;
            if (
              reviewedCollectionPlan !== undefined &&
              isSingleTargetCollectionPlan(reviewedCollectionPlan.projection)
            ) {
              const collectionPlan = reviewedCollectionPlan;
              const projection =
                collectionPlan.projection as PublicSingleTargetCollectionPlan;
              const release = officialCollectionCatalog.releases.find(
                (candidate) =>
                  candidate.manifest.collectionId === projection.collectionId &&
                  candidate.manifest.releaseNumber ===
                    projection.releaseNumber &&
                  candidate.manifestDigest === projection.manifestDigest &&
                  candidate.manifest.status === "active" &&
                  candidate.receipt.status === "approved",
              );
              if (
                release === undefined ||
                currentCollectionPlan !== collectionPlan ||
                collectionPlans.get(projection.id) !== collectionPlan ||
                collectionPlan.preparedIds[0] !== prepared.id ||
                projection.childPreparedDigest !== prepared.digest ||
                digestCanonicalJson(projection.releaseEvidence) !==
                  digestCanonicalJson({
                    compatibility: release?.manifest.compatibility,
                    receipt: release?.receipt,
                    status: release?.manifest.status,
                  }) ||
                projection.targetGeneration !== session.binding.generation ||
                projection.inventoryDigest !==
                  digestCanonicalJson({
                    inventory: session.inventory,
                    inventoryId: session.inventoryId,
                    targetGeneration: session.binding.generation,
                  })
              ) {
                discardCollectionPlan(collectionPlan);
                const error = publicError(
                  "review_invalid",
                  "The Collection Plan evidence changed before approval.",
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
              const acknowledgement: CollectionAcknowledgement = {
                acknowledgedAt: clock().toISOString(),
                collectionId: projection.collectionId,
                kind: "release",
                manifestDigest: projection.manifestDigest,
                releaseNumber: projection.releaseNumber,
              };
              const nextAcknowledgements = [
                ...collectionAcknowledgements.filter(
                  ({ collectionId }) =>
                    collectionId !== acknowledgement.collectionId,
                ),
                acknowledgement,
              ].sort((left, right) =>
                left.collectionId.localeCompare(right.collectionId),
              );
              const acknowledged = await options.recoveryRecords.commit({
                acknowledgements: nextAcknowledgements,
                type: "collections.acknowledgements.replace",
              });
              if (!acknowledged.ok) {
                publishMutation({
                  ...mutationState,
                  activeOperationId: null,
                  lastError: acknowledged.error,
                  phase: "failed",
                });
                return requestFailure(acknowledged.error);
              }
              collectionAcknowledgements = nextAcknowledgements;
              discardCollectionPlan(collectionPlan);
            }

            const operationId = options.id();
            const controller = new AbortController();
            const promise = runApprovedMutation(
              prepared,
              operationId,
              session,
              controller,
            ).finally(() => {
              if (activeMutation?.id === operationId)
                activeMutation = undefined;
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
                isInvalidGithubAddSourceRequest(input)
                  ? GITHUB_SOURCE_OWNER_REPOSITORY_COPY
                  : "The request is not supported.",
                "validate",
                false,
              ),
            );
          }

          if (targetAuthorityUnavailable) {
            return requestFailure(
              publicError(
                "target_unavailable",
                "Saved Target or recovery authority is unavailable.",
                "restore",
                false,
              ),
            );
          }
          if (targetDefinitionsChanging) return targetChangeConflict();

          if (
            parsed.data.type === "target.create" ||
            parsed.data.type === "target.update"
          ) {
            const targetChangeRequest = parsed.data;
            if (
              options.v1LocalOnlyTargets === true &&
              targetChangeRequest.definition.kind === "ssh"
            ) {
              return requestFailure(
                publicError(
                  "invalid_request",
                  'SSH Targets are next-scope and outside the V1 Local commitment.',
                  "target",
                  false,
                ),
              );
            }
            const updatedTargetId =
              targetChangeRequest.type === "target.update"
                ? targetChangeRequest.targetId
                : undefined;
            const existing =
              updatedTargetId !== undefined
                ? targetDefinitions().find(({ id }) => id === updatedTargetId)
                : undefined;
            if (
              existing !== undefined &&
              activePreparation?.dependentTargetIds.includes(existing.id)
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "A mutation preparation is active for this Target.",
                  "coordinate",
                  true,
                ),
              );
            }
            if (
              targetChangeRequest.type === "target.update" &&
              existing === undefined
            ) {
              return requestFailure(
                publicError(
                  "target_not_found",
                  "Target was not found.",
                  "target",
                  false,
                ),
              );
            }
            if (
              existing !== undefined &&
              activeObservation?.targetId === existing.id
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "This Target has an active Inventory observation.",
                  "coordinate",
                  true,
                ),
              );
            }
            if (existing !== undefined && reservedTargetIds.has(existing.id)) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "This Target is reserved by a Collection execution.",
                  "coordinate",
                  true,
                ),
              );
            }
            if (
              existing !== undefined &&
              (guardedTargetIds.has(existing.id) ||
                activeMutation?.prepared?.targetId === existing.id)
            ) {
              return requestFailure(
                publicError(
                  "reconciliation_required",
                  "This Target cannot change while recovery is required.",
                  "target",
                  false,
                ),
              );
            }

            return reserveTargetDefinitions(async () => {
              const proposed =
                targetChangeRequest.type === "target.create"
                  ? await options.skillsTargets.proposeCreate(
                      targetChangeRequest.definition,
                    )
                  : await options.skillsTargets.proposeUpdate(
                      targetChangeRequest.targetId,
                      targetChangeRequest.definition,
                    );
              if (!proposed.ok) return requestFailure(proposed.error);
              const {
                definitions: nextDefinitions,
                executionChanged,
                target: replacement,
              } = proposed.value;
              const committed = await options.recoveryRecords.commit({
                targets: nextDefinitions.map(durableTarget),
                type: "targets.replace",
              });
              if (!committed.ok) return requestFailure(committed.error);

              const legacyTargetId =
                options.skillsTargets.legacyIdFor(replacement);
              const legacySnapshot =
                legacyTargetId === undefined
                  ? undefined
                  : recoverableSnapshots.get(legacyTargetId);
              const legacyGuard =
                legacyTargetId === undefined
                  ? undefined
                  : recoverableGuards.get(legacyTargetId);
              if (
                legacyTargetId !== undefined &&
                (legacySnapshot !== undefined || legacyGuard !== undefined)
              ) {
                const remapped = await options.recoveryRecords.commit({
                  fromTargetId: legacyTargetId,
                  toTargetId: replacement.id,
                  type: "target.remap",
                });
                if (!remapped.ok) {
                  targetAuthorityUnavailable = true;
                  return requestFailure(remapped.error);
                }
                if (
                  legacySnapshot !== undefined &&
                  !recoverableSnapshots.has(replacement.id)
                ) {
                  recoverableSnapshots.set(replacement.id, {
                    ...legacySnapshot,
                    targetId: replacement.id,
                  });
                }
                if (
                  legacyGuard !== undefined &&
                  !recoverableGuards.has(replacement.id)
                ) {
                  recoverableGuards.set(replacement.id, {
                    ...legacyGuard,
                    targetId: replacement.id,
                  });
                }
                recoverableSnapshots.delete(legacyTargetId);
                recoverableGuards.delete(legacyTargetId);
                guardedTargetIds.delete(legacyTargetId);
              }

              const currentInventory =
                existing === undefined
                  ? undefined
                  : target.id === replacement.id
                    ? inventoryState
                    : inventoryStates.get(replacement.id);
              const recoveredSnapshot =
                currentInventory?.observedAt !== null &&
                currentInventory?.observedAt !== undefined
                  ? undefined
                  : legacySnapshot;
              const recoveredGuard = legacyGuard;

              options.skillsTargets.replaceDefinitions(nextDefinitions);
              if (existing === undefined) {
                inventoryStates.set(replacement.id, emptyInventoryState());
                mutationStates.set(replacement.id, emptyMutationState());
              } else if (executionChanged && target.id !== replacement.id) {
                const priorInventory = inventoryStates.get(replacement.id);
                inventoryStates.set(replacement.id, {
                  ...(priorInventory ?? emptyInventoryState()),
                  freshness: staleAfterFailure(
                    priorInventory?.freshness ?? "none",
                  ),
                  lastError: targetGenerationStaleError(),
                });
                mutationStates.set(replacement.id, emptyMutationState());
                freshTargetSessions.delete(replacement.id);
                invalidatePreparedForTarget(replacement.id);
              }
              if (target.id === replacement.id) {
                target = replacement;
                if (executionChanged) {
                  freshTargetSession = undefined;
                  inventoryState = {
                    ...inventoryState,
                    freshness: staleAfterFailure(inventoryState.freshness),
                    lastError: targetGenerationStaleError(),
                  };
                  invalidatePreparedForTarget(replacement.id);
                  mutationState = emptyMutationState();
                }
              }
              if (
                recoveredSnapshot !== undefined ||
                recoveredGuard !== undefined
              ) {
                const recovered = stateFromRecoveredRecords(
                  replacement,
                  recoveredSnapshot,
                  recoveredGuard,
                  target.id === replacement.id
                    ? inventoryState
                    : inventoryStates.get(replacement.id),
                  target.id === replacement.id
                    ? mutationState
                    : mutationStates.get(replacement.id),
                );
                inventoryStates.set(replacement.id, recovered.inventory);
                mutationStates.set(replacement.id, recovered.mutation);
                freshTargetSessions.delete(replacement.id);
                invalidatePreparedForTarget(replacement.id);
                if (recoveredGuard !== undefined) {
                  guardedTargetIds.add(replacement.id);
                }
                if (target.id === replacement.id) {
                  inventoryState = structuredClone(recovered.inventory);
                  mutationState = structuredClone(recovered.mutation);
                  freshTargetSession = undefined;
                }
              }
              publish({ ...inventoryState });
              return { ok: true, value: { operationId: replacement.id } };
            });
          }

          if (parsed.data.type === "target.delete") {
            const deletedTargetId = parsed.data.targetId;
            const existing = targetDefinitions().find(
              ({ id }) => id === deletedTargetId,
            );
            if (
              existing !== undefined &&
              activePreparation?.dependentTargetIds.includes(existing.id)
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "A mutation preparation is active for this Target.",
                  "coordinate",
                  true,
                ),
              );
            }
            if (existing === undefined) {
              return requestFailure(
                publicError(
                  "target_not_found",
                  "Target was not found.",
                  "target",
                  false,
                ),
              );
            }
            if (activeObservation?.targetId === existing.id) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "This Target has an active Inventory observation.",
                  "coordinate",
                  true,
                ),
              );
            }
            if (reservedTargetIds.has(existing.id)) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "This Target is reserved by a Collection execution.",
                  "coordinate",
                  true,
                ),
              );
            }
            if (
              targetDefinitions().length === 1 ||
              guardedTargetIds.has(existing.id) ||
              activeMutation?.prepared?.targetId === existing.id
            ) {
              return requestFailure(
                publicError(
                  "reconciliation_required",
                  "This Target cannot be deleted in its current state.",
                  "target",
                  false,
                ),
              );
            }
            return reserveTargetDefinitions(async () => {
              const proposed = options.skillsTargets.proposeDelete(existing.id);
              if (!proposed.ok) return requestFailure(proposed.error);
              const nextDefinitions = proposed.value.definitions;
              const committed = await options.recoveryRecords.commit({
                targets: nextDefinitions.map(durableTarget),
                type: "targets.replace",
              });
              if (!committed.ok) return requestFailure(committed.error);
              options.skillsTargets.replaceDefinitions(nextDefinitions);
              if (
                comparisonSelection?.leftTargetId === existing.id ||
                comparisonSelection?.rightTargetId === existing.id
              ) {
                comparisonSelection = undefined;
              }
              inventoryStates.delete(existing.id);
              mutationStates.delete(existing.id);
              freshTargetSessions.delete(existing.id);
              invalidatePreparedForTarget(existing.id);
              if (target.id === existing.id) {
                target = targetDefinitions()[0]!;
                freshTargetSession = freshTargetSessions.get(target.id);
                inventoryState = structuredClone(
                  inventoryStates.get(target.id) ?? emptyInventoryState(),
                );
                mutationState = structuredClone(
                  mutationStates.get(target.id) ?? emptyMutationState(),
                );
              }
              publish({ ...inventoryState });
              return { ok: true, value: { operationId: existing.id } };
            });
          }

          if (parsed.data.type === "collection.prepare") {
            if (guardStoreCorrupted) {
              return requestFailure(
                publicError(
                  "reconciliation_required",
                  "Reconciliation is required before another mutation.",
                  "prepare",
                  false,
                ),
              );
            }
            const request = parsed.data;
            const requestedTarget = targetDefinitions().find(
              ({ id }) => id === request.targetId,
            );
            if (
              options.v1LocalOnlyTargets === true &&
              requestedTarget?.kind === "ssh"
            ) {
              return requestFailure(
                publicError(
                  "invalid_request",
                  "SSH Targets are next-scope and outside the V1 Local commitment.",
                  "target",
                  false,
                ),
              );
            }
            const release = officialCollectionCatalog.releases.find(
              (candidate) =>
                candidate.manifest.collectionId === request.collectionId &&
                candidate.manifest.releaseNumber === request.releaseNumber &&
                candidate.manifestDigest === request.manifestDigest,
            );
            if (
              requestedTarget === undefined ||
              release === undefined ||
              release.manifest.status !== "active" ||
              release.receipt.status !== "approved"
            ) {
              return requestFailure(
                publicError(
                  "mutation_ineligible",
                  "The selected Official Collection release is unavailable.",
                  "collection",
                  false,
                ),
              );
            }
            if (
              activeMutation !== undefined ||
              activeObservation !== undefined ||
              activePreparation !== undefined
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for this Target.",
                  "coordinate",
                  true,
                ),
              );
            }
            if (requestedTarget.id !== target.id) {
              activateTarget(requestedTarget);
            }
            if (
              mutationState.phase === "reconciliation-required" ||
              freshTargetSession === undefined ||
              inventoryState.freshness !== "fresh"
            ) {
              return requestFailure(
                publicError(
                  mutationState.phase === "reconciliation-required"
                    ? "reconciliation_required"
                    : "stale_inventory",
                  "Fresh Inventory is required to plan this Collection.",
                  "collection",
                  true,
                ),
              );
            }
            const projected = projectOfficialCollections({
              catalog: officialCollectionCatalog,
              inventory: inventoryState,
              platform,
              target: projectTarget(target),
            });
            const publicRelease = projected.releases.find(
              (candidate) =>
                candidate.collectionId === request.collectionId &&
                candidate.releaseNumber === request.releaseNumber &&
                candidate.manifestDigest === request.manifestDigest,
            );
            const assessment = publicRelease?.assessments.find(
              ({ scope }) => scope === request.scope,
            );
            const eligible =
              publicRelease?.executable === true &&
              assessment?.compatibility === "compatible" &&
              assessment.inventoryFreshness === "fresh" &&
              request.selections.every((selection) => {
                const entry = assessment.entries.find(
                  ({ name }) => name === selection.name,
                );
                return (
                  entry?.selectable === true &&
                  entry.selectionModes.includes(selection.mode)
                );
              });
            if (!eligible || assessment === undefined) {
              return requestFailure(
                publicError(
                  "mutation_ineligible",
                  "One or more Collection selections are not executable.",
                  "collection",
                  false,
                ),
              );
            }
            const session = freshTargetSession;
            const preparedResult = await runPreparation(
              endpointState,
              session,
              {
                names: request.selections.map(({ name }) => name),
                scope: request.scope,
                source: {
                  revision: release.manifest.source.reviewedRevision,
                  source: release.manifest.source.repository,
                  sourceType: "github",
                },
                type: "add",
              },
            );
            if (!preparedResult.ok) return preparedResult;
            const prepared = preparedMutations.get(
              preparedResult.value.operationId,
            );
            if (prepared === undefined) {
              return requestFailure(
                publicError(
                  "review_invalid",
                  "The Collection child plan could not be retained.",
                  "collection",
                  false,
                ),
              );
            }
            const assessmentDigest = digestCanonicalJson(assessment);
            const inventoryDigest = digestCanonicalJson({
              inventory: session.inventory,
              inventoryId: session.inventoryId,
              targetGeneration: session.binding.generation,
            });
            const planId = options.id();
            const evidence = {
              assessmentDigest,
              childCommandPlan: projectCommandPlan(prepared.commandPlan),
              childPreparedDigest: prepared.digest,
              collectionId: request.collectionId,
              expiresAt: prepared.expiresAt,
              inventoryDigest,
              manifestDigest: request.manifestDigest,
              order: [
                {
                  names: request.selections.map(({ name }) => name),
                  position: 1,
                  targetId: request.targetId,
                },
              ],
              releaseEvidence: {
                compatibility: structuredClone(release.manifest.compatibility),
                receipt: structuredClone(release.receipt),
                status: release.manifest.status,
              },
              releaseNumber: request.releaseNumber,
              schemaVersion: 1 as const,
              scope: request.scope,
              selections: request.selections,
              source: {
                repository: release.manifest.source.repository,
                reviewedRevision: release.manifest.source.reviewedRevision,
              },
              targetGeneration: requestedTarget.generation,
              targetId: requestedTarget.id,
            };
            const plan: CollectionPlan = {
              preparedIds: [prepared.id],
              projection: {
                ...evidence,
                id: planId,
                reviewDigest: digestCanonicalJson(evidence),
              },
            };
            collectionPlans.set(planId, plan);
            currentCollectionPlan = plan;
            publishMutation({ ...mutationState });
            return { ok: true, value: { operationId: planId } };
          }

          if (parsed.data.type === "collection.prepare-many") {
            const request = parsed.data;
            if (guardStoreCorrupted) {
              return requestFailure(
                publicError(
                  "reconciliation_required",
                  "Reconciliation is required before another mutation.",
                  "prepare",
                  false,
                ),
              );
            }
            if (options.v1LocalOnlyTargets === true) {
              const sshRequested = request.targets.some((child) => {
                const selected = targetDefinitions().find(
                  ({ id }) => id === child.targetId,
                );
                return selected?.kind === "ssh";
              });
              if (sshRequested) {
                return requestFailure(
                  publicError(
                    "invalid_request",
                    "SSH Targets are next-scope and outside the V1 Local commitment.",
                    "target",
                    false,
                  ),
                );
              }
            }
            const release = officialCollectionCatalog.releases.find(
              (candidate) =>
                candidate.manifest.collectionId === request.collectionId &&
                candidate.manifest.releaseNumber === request.releaseNumber &&
                candidate.manifestDigest === request.manifestDigest,
            );
            if (
              release === undefined ||
              release.manifest.status !== "active" ||
              release.receipt.status !== "approved"
            ) {
              return requestFailure(
                publicError(
                  "mutation_ineligible",
                  "The selected Official Collection release is unavailable.",
                  "collection",
                  false,
                ),
              );
            }
            if (
              activeMutation !== undefined ||
              activeObservation !== undefined ||
              activePreparation !== undefined
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for a selected Target.",
                  "coordinate",
                  true,
                ),
              );
            }

            const plannedChildren: Array<{
              readonly assessment: ReturnType<
                typeof projectOfficialCollections
              >["releases"][number]["assessments"][number];
              readonly request: (typeof request.targets)[number];
              readonly session: FreshTargetSession;
              readonly target: TargetDefinition;
            }> = [];
            for (const requestedChild of request.targets) {
              const selectedTarget = targetDefinitions().find(
                ({ id }) => id === requestedChild.targetId,
              );
              const selectedInventory = inventoryForTarget(
                requestedChild.targetId,
              );
              const selectedMutation =
                requestedChild.targetId === target.id
                  ? mutationState
                  : (mutationStates.get(requestedChild.targetId) ??
                    emptyMutationState());
              const selectedSession =
                requestedChild.targetId === target.id
                  ? freshTargetSession
                  : freshTargetSessions.get(requestedChild.targetId);
              if (
                selectedTarget === undefined ||
                selectedSession === undefined ||
                selectedInventory.freshness !== "fresh" ||
                selectedMutation.phase === "reconciliation-required" ||
                guardedTargetIds.has(requestedChild.targetId)
              ) {
                return requestFailure(
                  publicError(
                    selectedMutation.phase === "reconciliation-required" ||
                      guardedTargetIds.has(requestedChild.targetId)
                      ? "reconciliation_required"
                      : "stale_inventory",
                    "Every selected Target requires a Fresh Inventory and available mutation lifecycle.",
                    "collection",
                    true,
                  ),
                );
              }
              const projected = projectOfficialCollections({
                catalog: officialCollectionCatalog,
                inventory: selectedInventory,
                platform,
                target: projectTarget(selectedTarget),
              });
              const publicRelease = projected.releases.find(
                (candidate) =>
                  candidate.collectionId === request.collectionId &&
                  candidate.releaseNumber === request.releaseNumber &&
                  candidate.manifestDigest === request.manifestDigest,
              );
              const assessment = publicRelease?.assessments.find(
                ({ scope }) => scope === requestedChild.scope,
              );
              const eligible =
                publicRelease?.executable === true &&
                assessment?.compatibility === "compatible" &&
                assessment.inventoryFreshness === "fresh" &&
                requestedChild.selections.every((selection) => {
                  const entry = assessment.entries.find(
                    ({ name }) => name === selection.name,
                  );
                  return (
                    entry?.selectable === true &&
                    entry.selectionModes.includes(selection.mode)
                  );
                });
              if (!eligible || assessment === undefined) {
                return requestFailure(
                  publicError(
                    "mutation_ineligible",
                    "One or more Collection selections are not executable.",
                    "collection",
                    false,
                  ),
                );
              }
              plannedChildren.push({
                assessment,
                request: requestedChild,
                session: selectedSession,
                target: selectedTarget,
              });
            }

            for (const child of plannedChildren) {
              invalidatePreparedForTarget(child.target.id);
            }
            if (currentCollectionPlan !== undefined) {
              discardCollectionPlan(currentCollectionPlan);
            }
            const preparation: ActivePreparation = {
              dependentTargetIds: plannedChildren.map(
                ({ target }) => target.id,
              ),
              invalidated: false,
              ownerEndpointId: endpointState.endpointId,
              promise: undefined,
              session: plannedChildren[0]!.session,
            };
            activePreparation = preparation;
            const promise = (async (): Promise<
              Result<RequestValue, RequestError>
            > => {
              try {
                const preparedChildren: Array<{
                  readonly assessment: (typeof plannedChildren)[number]["assessment"];
                  readonly prepared: PreparedMutation;
                  readonly request: (typeof request.targets)[number];
                  readonly session: FreshTargetSession;
                  readonly target: TargetDefinition;
                }> = [];
                for (const child of plannedChildren) {
                  const prepared = await child.session.process.prepareMutation({
                    freshness: "fresh",
                    intent: {
                      names: child.request.selections.map(({ name }) => name),
                      scope: child.request.scope,
                      source: {
                        revision: release.manifest.source.reviewedRevision,
                        source: release.manifest.source.repository,
                        sourceType: "github",
                      },
                      type: "add",
                    },
                    inventory: child.session.inventory,
                    inventoryId: child.session.inventoryId,
                  });
                  if (preparation.invalidated) {
                    return requestFailure(
                      publicError(
                        "cancelled",
                        "Collection preparation was invalidated before completion.",
                        "prepare",
                        true,
                      ),
                    );
                  }
                  if (!prepared.ok) {
                    return requestFailure(prepared.error as RequestError);
                  }
                  preparedChildren.push({ ...child, prepared: prepared.value });
                }

                const expiresAt = new Date(
                  Math.min(
                    ...preparedChildren.map(({ prepared }) =>
                      Date.parse(prepared.expiresAt),
                    ),
                  ),
                ).toISOString();
                const planId = options.id();
                const evidence: Omit<
                  PublicMultiTargetCollectionPlan,
                  "id" | "reviewDigest"
                > = {
                  children: preparedChildren.map(
                    (
                      {
                        assessment,
                        prepared,
                        request: childRequest,
                        session,
                        target: childTarget,
                      },
                      index,
                    ) => ({
                      assessmentDigest: digestCanonicalJson(assessment),
                      bindingDigest: digestCanonicalJson(session.binding),
                      commandPlan: projectCommandPlan(prepared.commandPlan),
                      inventoryDigest: digestCanonicalJson({
                        inventory: session.inventory,
                        inventoryId: session.inventoryId,
                        targetGeneration: session.binding.generation,
                      }),
                      position: index + 1,
                      preparedDigest: prepared.digest,
                      scope: childRequest.scope,
                      selections: childRequest.selections,
                      target: projectTarget(childTarget),
                    }),
                  ),
                  collectionId: request.collectionId,
                  expiresAt,
                  manifestDigest: request.manifestDigest,
                  order: preparedChildren.map(
                    (
                      { request: childRequest, target: childTarget },
                      index,
                    ) => ({
                      names: childRequest.selections.map(({ name }) => name),
                      position: index + 1,
                      scope: childRequest.scope,
                      targetId: childTarget.id,
                    }),
                  ),
                  releaseEvidence: {
                    compatibility: structuredClone(
                      release.manifest.compatibility,
                    ),
                    receipt: structuredClone(release.receipt),
                    status: release.manifest.status,
                  },
                  releaseNumber: request.releaseNumber,
                  schemaVersion: 2,
                  source: {
                    repository: release.manifest.source.repository,
                    reviewedRevision: release.manifest.source.reviewedRevision,
                  },
                };
                const plan: CollectionPlan = {
                  preparedIds: preparedChildren.map(
                    ({ prepared }) => prepared.id,
                  ),
                  projection: {
                    ...evidence,
                    id: planId,
                    reviewDigest: digestCanonicalJson(evidence),
                  },
                };
                for (const {
                  prepared,
                  target: childTarget,
                } of preparedChildren) {
                  preparedMutations.set(prepared.id, prepared);
                  preparedDependencies.set(
                    prepared.id,
                    plannedChildren.map(({ target }) => target.id),
                  );
                  const childMutation =
                    childTarget.id === target.id
                      ? mutationState
                      : (mutationStates.get(childTarget.id) ??
                        emptyMutationState());
                  mutationStates.set(childTarget.id, {
                    ...childMutation,
                    activeOperationId: null,
                    commandPlan: projectCommandPlan(prepared.commandPlan),
                    lastError: null,
                    outcome: null,
                    phase: "planned",
                    reconciliationDeadline: null,
                  });
                }
                currentCollectionPlan = plan;
                collectionPlans.set(planId, plan);
                if (mutationStates.has(target.id)) {
                  mutationState = structuredClone(
                    mutationStates.get(target.id)!,
                  );
                }
                publish({ ...inventoryState });
                return { ok: true, value: { operationId: planId } };
              } finally {
                if (activePreparation === preparation) {
                  activePreparation = undefined;
                }
              }
            })();
            preparation.promise = promise;
            return promise;
          }

          if (parsed.data.type === "collection.review.request") {
            const plan = collectionPlans.get(parsed.data.collectionPlanId);
            const prepared =
              plan === undefined
                ? undefined
                : preparedMutations.get(plan.preparedIds[0]!);
            if (
              plan === undefined ||
              plan !== currentCollectionPlan ||
              prepared === undefined ||
              clock().getTime() >= Date.parse(plan.projection.expiresAt)
            ) {
              if (plan !== undefined) discardCollectionPlan(plan);
              const error = publicError(
                "review_invalid",
                "The Collection Plan is unavailable for review.",
                "review",
                false,
              );
              if (plan !== undefined) {
                const plannedTargetId =
                  plan.projection.schemaVersion === 1
                    ? plan.projection.targetId
                    : plan.projection.children[0]!.target.id;
                const plannedTargetMutation =
                  plannedTargetId === target.id
                    ? mutationState
                    : (mutationStates.get(plannedTargetId) ??
                      emptyMutationState());
                publishMutationForTarget(plannedTargetId, {
                  ...plannedTargetMutation,
                  activeOperationId: null,
                  commandPlan: null,
                  lastError: error,
                  phase: "failed",
                });
              }
              return requestFailure(error);
            }
            const reviewId = options.id();
            rejectPendingReviews(
              (review) =>
                review.purpose === "execute" &&
                review.prepared.id === prepared.id,
            );
            reviews.set(reviewId, {
              collectionPlan: plan,
              decision: undefined,
              id: reviewId,
              ownerEndpointId: endpointState.endpointId,
              prepared,
              purpose: "execute",
            });
            pruneReviews();
            const reviewTargetIds =
              plan.projection.schemaVersion === 2
                ? plan.projection.children.map(
                    ({ target: childTarget }) => childTarget.id,
                  )
                : [plan.projection.targetId];
            for (const reviewTargetId of reviewTargetIds) {
              const reviewMutation =
                reviewTargetId === target.id
                  ? mutationState
                  : (mutationStates.get(reviewTargetId) ??
                    emptyMutationState());
              publishMutationForTarget(reviewTargetId, {
                ...reviewMutation,
                lastError: null,
                phase: "reviewing",
              });
            }
            options.onReviewRequested?.(reviewId);
            return { ok: true, value: { operationId: reviewId } };
          }

          if (parsed.data.type === "comparison.open") {
            const leftTargetId = parsed.data.leftTargetId;
            const rightTargetId = parsed.data.rightTargetId;
            const leftTarget = targetDefinitions().find(
              ({ id }) => id === leftTargetId,
            );
            const rightTarget = targetDefinitions().find(
              ({ id }) => id === rightTargetId,
            );
            if (leftTarget === undefined || rightTarget === undefined) {
              return requestFailure(
                publicError(
                  "target_not_found",
                  "A selected comparison Target was not found.",
                  "compare",
                  false,
                ),
              );
            }
            const comparisonId = options.id();
            comparisonSelection = {
              id: comparisonId,
              leftTargetId: leftTarget.id,
              rightTargetId: rightTarget.id,
            };
            publish({ ...inventoryState });
            return { ok: true, value: { operationId: comparisonId } };
          }

          if (parsed.data.type === "comparison.prepare") {
            const comparisonId = parsed.data.comparisonId;
            const destinationTargetId = parsed.data.destinationTargetId;
            const rowKey = parsed.data.rowKey;
            const comparison = currentComparison();
            const destinationTarget = targetDefinitions().find(
              ({ id }) => id === destinationTargetId,
            );
            const row = comparison?.rows.find(({ key }) => key === rowKey);
            if (
              comparison === null ||
              comparison.id !== comparisonId ||
              destinationTarget === undefined ||
              (destinationTarget.id !== comparison.leftTargetId &&
                destinationTarget.id !== comparison.rightTargetId) ||
              row === undefined
            ) {
              return requestFailure(
                publicError(
                  "mutation_ineligible",
                  "The selected comparison difference is unavailable.",
                  "prepare",
                  false,
                ),
              );
            }
            if (
              comparison.leftFreshness !== "fresh" ||
              comparison.rightFreshness !== "fresh"
            ) {
              return requestFailure(
                publicError(
                  "stale_inventory",
                  "Fresh Inventory is required on both comparison Targets.",
                  "prepare",
                  true,
                ),
              );
            }
            if (
              activeMutation !== undefined ||
              activeObservation !== undefined ||
              activePreparation !== undefined
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for a Target.",
                  "coordinate",
                  true,
                ),
              );
            }

            const destinationIsLeft =
              destinationTarget.id === comparison.leftTargetId;
            const destinationEntries = destinationIsLeft
              ? row.left.entries
              : row.right.entries;
            const sourceEntries = destinationIsLeft
              ? row.right.entries
              : row.left.entries;
            let intent:
              | import("@skills-desktop/skills-runtime").MutationIntent
              | undefined;
            if (
              row.summary === "missing" &&
              destinationEntries.length === 0 &&
              sourceEntries.length === 1
            ) {
              const sourceEntry = sourceEntries[0]!;
              if (
                sourceEntry.declaredSource.sourceType === "github" &&
                sourceEntry.declaredSource.source !== null
              ) {
                intent = {
                  names: [row.key],
                  scope: sourceEntry.scope,
                  source: {
                    source: sourceEntry.declaredSource.source,
                    sourceType: "github",
                  },
                  type: "add",
                };
              }
            } else if (
              row.summary === "version-drift" &&
              row.dimensions.declaredSource === "matched" &&
              destinationEntries.length === 1 &&
              sourceEntries.length === 1 &&
              destinationEntries[0]!.scope === sourceEntries[0]!.scope
            ) {
              intent = {
                names: [row.key],
                scope: destinationEntries[0]!.scope,
                type: "update",
              };
            }
            if (intent === undefined) {
              return requestFailure(
                publicError(
                  "mutation_ineligible",
                  "This comparison difference cannot produce a safe destination mutation.",
                  "prepare",
                  false,
                ),
              );
            }

            if (destinationTarget.id !== target.id) {
              activateTarget(destinationTarget);
            }
            if (
              mutationState.phase === "reconciliation-required" ||
              freshTargetSession === undefined ||
              inventoryState.freshness !== "fresh"
            ) {
              return requestFailure(
                publicError(
                  mutationState.phase === "reconciliation-required"
                    ? "reconciliation_required"
                    : "stale_inventory",
                  "The destination Target cannot prepare this mutation.",
                  "prepare",
                  false,
                ),
              );
            }
            return runPreparation(endpointState, freshTargetSession, intent, [
              comparison.leftTargetId,
              comparison.rightTargetId,
            ]);
          }

          if (parsed.data.type === "host-trust.review") {
            if (options.v1LocalOnlyTargets === true) {
              return requestFailure(
                publicError(
                  "invalid_request",
                  "主机身份复核未在 V1 开放。",
                  "target",
                  false,
                ),
              );
            }
            const reviewedTargetId = parsed.data.targetId;
            const reviewedTarget = targetDefinitions().find(
              ({ id }) => id === reviewedTargetId,
            );
            const challenge =
              options.skillsTargets.pendingHostTrust(reviewedTargetId);
            if (
              reviewedTarget === undefined ||
              reviewedTarget.kind !== "ssh" ||
              challenge === undefined ||
              challenge.targetGeneration !== reviewedTarget.generation ||
              clock().getTime() >= Date.parse(challenge.expiresAt)
            ) {
              return requestFailure(
                publicError(
                  "host_trust_invalid",
                  "No current SSH host key is available for review.",
                  "trust",
                  false,
                ),
              );
            }
            for (const review of hostTrustReviews.values()) {
              if (
                review.targetId === reviewedTarget.id &&
                review.decision === undefined
              ) {
                review.decision = "reject";
              }
            }
            pruneHostTrustReviews();
            const reviewId = options.id();
            hostTrustReviews.set(reviewId, {
              challenge,
              decision: undefined,
              id: reviewId,
              ownerEndpointId: endpointState.endpointId,
              targetId: reviewedTarget.id,
            });
            options.onReviewRequested?.(reviewId);
            return { ok: true, value: { operationId: reviewId } };
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
              ownerEndpointId: endpointState.endpointId,
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
              ownerEndpointId: endpointState.endpointId,
              prepared: activePrepared,
              purpose: "cancel",
            });
            pruneReviews();
            options.onReviewRequested?.(reviewId);
            return { ok: true, value: { operationId: reviewId } };
          }

          const requestedTargetId =
            "targetId" in parsed.data ? parsed.data.targetId : undefined;
          const requestedTarget = targetDefinitions().find(
            ({ id }) => id === requestedTargetId,
          );
          if (requestedTarget === undefined) {
            return requestFailure(
              publicError(
                "target_not_found",
                "Target was not found.",
                "open",
                false,
              ),
            );
          }
          if (requestedTarget.id !== target.id) {
            if (
              activeMutation !== undefined ||
              activeObservation !== undefined ||
              activePreparation !== undefined
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for a Target.",
                  "coordinate",
                  true,
                ),
              );
            }
            activateTarget(requestedTarget);
          }

          if (options.v1LocalOnlyTargets === true && target.kind === "ssh") {
            return requestFailure(
              publicError(
                "invalid_request",
                "SSH Targets are next-scope and outside the V1 Local commitment.",
                "target",
                false,
              ),
            );
          }

          if (parsed.data.type === "mutation.prepare") {
            if (guardStoreCorrupted) {
              return requestFailure(
                publicError(
                  "reconciliation_required",
                  "Reconciliation is required before another mutation.",
                  "prepare",
                  false,
                ),
              );
            }
            if (options.v1LocalOnlyTargets === true && target.kind === "ssh") {
              return requestFailure(
                publicError(
                  "invalid_request",
                  "SSH Targets are next-scope and outside the V1 Local commitment.",
                  "target",
                  false,
                ),
              );
            }
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
            if (
              activeMutation !== undefined ||
              activeObservation !== undefined ||
              activePreparation !== undefined
            ) {
              return requestFailure(
                publicError(
                  "mutation_conflict",
                  "Another operation is active for this Target.",
                  "coordinate",
                  true,
                ),
              );
            }
            return runPreparation(
              endpointState,
              freshTargetSession,
              parsed.data.intent,
            );
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
            if (
              activeMutation !== undefined ||
              activeObservation !== undefined ||
              activePreparation !== undefined
            ) {
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
              if (activeMutation?.id === operationId)
                activeMutation = undefined;
            });
            activeMutation = {
              controller: new AbortController(),
              id: operationId,
              promise,
            };
            return promise;
          }

          if (activeMutation !== undefined || activePreparation !== undefined) {
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
          invalidatePreparedForTarget(target.id);
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
            targetId: target.id,
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
          if (activePreparation?.ownerEndpointId === endpointState.endpointId) {
            activePreparation.invalidated = true;
          }
          if (
            endpointState.role === "review" &&
            endpointState.reviewId !== undefined
          ) {
            const hostTrustReview = hostTrustReviews.get(
              endpointState.reviewId,
            );
            if (
              hostTrustReview !== undefined &&
              hostTrustReview.decision === undefined
            ) {
              hostTrustReview.decision = "reject";
            }
            const review = reviews.get(endpointState.reviewId);
            if (review !== undefined) rejectTrustedReview(review);
          }
          if (endpointState.role === "workspace") {
            for (const review of reviews.values()) {
              if (review.ownerEndpointId === endpointState.endpointId) {
                rejectTrustedReview(review);
              }
            }
            for (const review of hostTrustReviews.values()) {
              if (
                review.ownerEndpointId === endpointState.endpointId &&
                review.decision === undefined
              ) {
                review.decision = "reject";
              }
            }
          }
        },
      };
    },
    async initialize() {
      if (initialized) return;
      officialCollectionCatalog = validateOfficialCollectionCatalog(
        options.officialCollectionCatalog ?? EMPTY_OFFICIAL_COLLECTION_CATALOG,
      );
      initialized = true;
      const restored = await options.recoveryRecords.restore();
      blockedTargetDefinitions = restored.blockedTargetDefinitions ?? [];
      const restoredAcknowledgements = [
        ...(restored.collectionAcknowledgements ?? []),
      ];
      collectionAcknowledgements = restoredAcknowledgements.filter(
        (acknowledgement) =>
          officialCollectionCatalog.releases.some(
            (release) =>
              release.manifest.collectionId === acknowledgement.collectionId &&
              release.manifest.releaseNumber ===
                acknowledgement.releaseNumber &&
              release.manifestDigest === acknowledgement.manifestDigest,
          ),
      );
      if (
        collectionAcknowledgements.length !== restoredAcknowledgements.length
      ) {
        await options.recoveryRecords.commit({
          acknowledgements: collectionAcknowledgements,
          type: "collections.acknowledgements.replace",
        });
      }
      let restoredSnapshots = [...restored.inventorySnapshots];
      let restoredGuards = [...restored.mutationGuards];
      for (const snapshot of restoredSnapshots) {
        recoverableSnapshots.set(snapshot.targetId, snapshot);
      }
      for (const guard of restoredGuards) {
        recoverableGuards.set(guard.targetId, guard);
      }
      const targetStoreFailed = restored.failures.some(
        (failure) => failure.store === "targetDefinitions",
      );
      recoveryUncertain = restored.failures.some((failure) =>
        ["mutationGuards", "targetDefinitions"].includes(failure.store),
      );
      targetAuthorityUnavailable = targetStoreFailed;
      const restoredLegacyTargetIds = new Map<string, string>();
      if (restored.targetDefinitions.length > 0) {
        const restoredTargets =
          restored.targetDefinitions.map(targetFromDurable);
        for (const definition of restoredTargets) {
          const legacyTargetId = options.skillsTargets.legacyIdFor(definition);
          if (legacyTargetId !== undefined) {
            restoredLegacyTargetIds.set(definition.id, legacyTargetId);
          }
        }
        const repairedTargets = repairPersistedRootWorkspaces(
          restoredTargets,
          startupTarget,
        );
        if (repairedTargets.changed && !targetAuthorityUnavailable) {
          const committed = await options.recoveryRecords.commit({
            targets: repairedTargets.definitions.map(durableTarget),
            type: "targets.replace",
          });
          if (!committed.ok) {
            recoveryUncertain = true;
            targetAuthorityUnavailable = true;
            inventoryState = {
              ...inventoryState,
              lastError: committed.error,
              phase: "error",
            };
          }
        }
        if (!targetAuthorityUnavailable) {
          options.skillsTargets.replaceDefinitions(
            repairedTargets.definitions,
          );
          target =
            targetDefinitions().find(({ id }) => id === target.id) ??
            targetDefinitions()[0]!;
        }
      } else if (!targetStoreFailed) {
        const committed = await options.recoveryRecords.commit({
          targets: [durableTarget(target)],
          type: "targets.replace",
        });
        if (!committed.ok) {
          recoveryUncertain = true;
          targetAuthorityUnavailable = true;
          inventoryState = {
            ...inventoryState,
            lastError: committed.error,
            phase: "error",
          };
        }
      } else {
        const blockedLabels = blockedTargetDefinitions
          .map(({ label }) => label)
          .join(", ");
        inventoryState = {
          ...inventoryState,
          lastError: publicError(
            "process_failed",
            blockedLabels.length === 0
              ? "Saved Target Definitions could not be restored."
              : `Target migration failed for: ${blockedLabels}.`,
            "restore",
            false,
          ),
          phase: "error",
        };
      }
      if (!targetAuthorityUnavailable) {
        for (const definition of targetDefinitions()) {
          const legacyTargetId =
            restoredLegacyTargetIds.get(definition.id) ??
            options.skillsTargets.legacyIdFor(definition);
          if (
            legacyTargetId === undefined ||
            legacyTargetId === definition.id ||
            (!restoredSnapshots.some(
              ({ targetId }) => targetId === legacyTargetId,
            ) &&
              !restoredGuards.some(
                ({ targetId }) => targetId === legacyTargetId,
              ))
          ) {
            continue;
          }
          const remapped = await options.recoveryRecords.commit({
            fromTargetId: legacyTargetId,
            toTargetId: definition.id,
            type: "target.remap",
          });
          if (!remapped.ok) {
            recoveryUncertain = true;
            targetAuthorityUnavailable = true;
            inventoryState = {
              ...inventoryState,
              lastError: remapped.error,
              phase: "error",
            };
            break;
          }
          restoredSnapshots = remapRecoveredTargetId(
            restoredSnapshots,
            legacyTargetId,
            definition.id,
          );
          restoredGuards = remapRecoveredTargetId(
            restoredGuards,
            legacyTargetId,
            definition.id,
          );
          recoverableSnapshots.delete(legacyTargetId);
          recoverableGuards.delete(legacyTargetId);
          const remappedSnapshot = restoredSnapshots.find(
            ({ targetId }) => targetId === definition.id,
          );
          const remappedGuard = restoredGuards.find(
            ({ targetId }) => targetId === definition.id,
          );
          if (remappedSnapshot !== undefined) {
            recoverableSnapshots.set(definition.id, remappedSnapshot);
          }
          if (remappedGuard !== undefined) {
            recoverableGuards.set(definition.id, remappedGuard);
          }
        }
      }
      for (const guard of restoredGuards) {
        guardedTargetIds.add(guard.targetId);
      }
      const inventoryStoreFailed = restored.failures.some(
        (failure) => failure.store === "inventorySnapshots",
      );
      const guardStoreFailed = restored.failures.some(
        (failure) => failure.store === "mutationGuards",
      );
      guardStoreCorrupted = guardStoreFailed;
      if (guardStoreFailed) {
        for (const definition of targetDefinitions()) {
          guardedTargetIds.add(definition.id);
        }
      }
      for (const definition of targetDefinitions()) {
        const prior = restoredSnapshots.find(
          (snapshot) => snapshot.targetId === definition.id,
        );
        let restoredInventory = emptyInventoryState();
        if (prior !== undefined) {
          restoredInventory = {
            activeOperationId: null,
            cliVersion: prior.cliVersion,
            entries: projectEntries(prior.entries),
            freshness: "stale",
            lastError:
              prior.generation === definition.generation
                ? null
                : targetGenerationStaleError(),
            observedAt: prior.observedAt,
            persistenceWarning: null,
            phase: "ready",
          };
        } else if (inventoryStoreFailed) {
          restoredInventory = {
            ...restoredInventory,
            lastError: publicError(
              "process_failed",
              "Saved Inventory evidence could not be restored.",
              "restore",
              true,
            ),
            phase: "error",
          };
        }

        const restoredGuard = restoredGuards.find(
          (guard) => guard.targetId === definition.id,
        );
        let restoredMutation = emptyMutationState();
        if (restoredGuard !== undefined || guardStoreFailed) {
          restoredInventory = {
            ...restoredInventory,
            freshness: staleAfterFailure(restoredInventory.freshness),
          };
          restoredMutation = {
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
        inventoryStates.set(definition.id, restoredInventory);
        mutationStates.set(definition.id, restoredMutation);
      }
      inventoryState = structuredClone(
        inventoryStates.get(target.id) ?? emptyInventoryState(),
      );
      mutationState = structuredClone(
        mutationStates.get(target.id) ?? emptyMutationState(),
      );
      if (targetAuthorityUnavailable) {
        inventoryState = {
          ...inventoryState,
          lastError: publicError(
            "process_failed",
            "Saved Target or recovery authority could not be restored.",
            "restore",
            false,
          ),
          phase: "error",
        };
      }
      storeActiveTargetState();
    },
    restartSafety() {
      const guardReasons: RestartGuardReason[] = [];
      if (activeMutation !== undefined) guardReasons.push("mutation-active");
      if (
        activeObservation !== undefined ||
        activePreparation !== undefined ||
        targetDefinitionsChanging
      ) {
        guardReasons.push("protected-process-active");
      }
      if (
        [...reviews.values()].some(({ decision }) => decision === undefined) ||
        [...hostTrustReviews.values()].some(
          ({ decision }) => decision === undefined,
        )
      ) {
        guardReasons.push("trusted-review-active");
      }
      if (
        guardedTargetIds.size > 0 ||
        mutationState.phase === "reconciliation-required" ||
        [...mutationStates.values()].some(
          ({ phase }) => phase === "reconciliation-required",
        )
      ) {
        guardReasons.push("reconciliation-required");
      }
      if (recoveryUncertain || targetAuthorityUnavailable) {
        guardReasons.push("recovery-uncertain");
      }
      return { guardReasons };
    },
    shutdown() {
      if (shutdownPromise !== undefined) return shutdownPromise;
      shuttingDown = true;
      const observation = activeObservation;
      const mutation = activeMutation;
      const preparation = activePreparation;
      observation?.controller.abort();
      if (preparation !== undefined) preparation.invalidated = true;
      rejectPendingReviews();
      rejectPendingHostTrustReviews();
      shutdownPromise = (async () => {
        const operations = [
          observation?.promise,
          mutation?.promise,
          preparation?.promise,
        ].filter(
          (
            operation,
          ): operation is Promise<Result<RequestValue, RequestError>> =>
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
