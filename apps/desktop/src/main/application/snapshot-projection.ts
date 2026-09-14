import { posix } from "node:path";

import type { PreparedMutation } from "../adapters/skills-process.js";
import {
  WORKSPACE_PROTOCOL_VERSION,
  type BlockedTargetDefinition,
  type DurableTargetDefinition,
  type PrepareEligibility,
  type PublicCollectionsState,
  type PublicComparison,
  type PublicInventoryEntry,
  type PublicInventoryState,
  type PublicMutationState,
  type TargetDefinition as PublicTargetDefinition,
  type WorkspaceSnapshot,
} from "../../contracts/workspace.js";
import type { TargetDefinition } from "../targets/skills-targets.js";
import { localWorkspaceLabel } from "../targets/workspace-path.js";
import { projectPrepareEligibility } from "./prepare-eligibility.js";
import { publicError } from "./request-errors.js";

export interface ProjectableInventoryEntry {
  readonly agents: readonly string[];
  readonly contentFingerprint: PublicInventoryEntry["contentFingerprint"];
  readonly declaredSource: PublicInventoryEntry["declaredSource"];
  readonly name: string;
  readonly revision: PublicInventoryEntry["revision"];
  readonly scope: PublicInventoryEntry["scope"];
}

export function emptyInventoryState(): PublicInventoryState {
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

export function emptyMutationState(): PublicMutationState {
  return {
    activeOperationId: null,
    commandPlan: null,
    lastError: null,
    outcome: null,
    phase: "idle",
    reconciliationDeadline: null,
  };
}

export function projectEntries(
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

export function projectTarget(target: TargetDefinition): PublicTargetDefinition {
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

export function durableTarget(target: TargetDefinition): DurableTargetDefinition {
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

export function targetFromDurable(
  target: DurableTargetDefinition,
): TargetDefinition {
  return {
    ...target,
    executionBindingDigest: target.executionBindingDigest ?? null,
    workspaceLabel:
      target.kind === "ssh"
        ? posix.basename(target.workspace) || target.workspace
        : localWorkspaceLabel(target.workspace),
  };
}

export function projectCommandPlan(plan: PreparedMutation["commandPlan"]) {
  return {
    ...plan,
    names: [...plan.names],
    source: plan.source === null ? null : { ...plan.source },
  };
}

export function staleAfterFailure(
  freshness: PublicInventoryState["freshness"],
): PublicInventoryState["freshness"] {
  return freshness === "none" ? "none" : "stale";
}

export function targetGenerationStaleError() {
  return publicError(
    "stale_inventory",
    "Target Definition changed; refresh before preparing a mutation.",
    "target",
    true,
  );
}

export function projectWorkspaceSnapshot(input: {
  readonly blockedTargets: readonly BlockedTargetDefinition[];
  readonly comparison: PublicComparison | null;
  readonly collections: PublicCollectionsState;
  readonly eventSequence: number;
  readonly inventory: PublicInventoryState;
  readonly mutation: PublicMutationState;
  readonly sessionEpoch: string;
  readonly stateRevision: number;
  readonly target: PublicTargetDefinition;
  readonly targets: readonly {
    readonly collections?: PublicCollectionsState;
    readonly deletionBlocked: boolean;
    readonly inventory: PublicInventoryState;
    readonly mutation: PublicMutationState;
    readonly target: PublicTargetDefinition;
  }[];
  readonly v1LocalOnlyTargets: boolean;
}): WorkspaceSnapshot {
  return {
    blockedTargets: structuredClone([...input.blockedTargets]),
    comparison: structuredClone(input.comparison),
    collections: structuredClone(input.collections),
    eventSequence: input.eventSequence,
    inventory: structuredClone(input.inventory),
    mutation: structuredClone(input.mutation),
    prepareEligibility: eligibilityFor(
      input.target.kind,
      input.inventory,
      input.mutation,
      input.v1LocalOnlyTargets,
    ),
    schemaVersion: WORKSPACE_PROTOCOL_VERSION,
    sessionEpoch: input.sessionEpoch,
    stateRevision: input.stateRevision,
    target: input.target,
    targets: input.targets.map((state) => ({
      collections: structuredClone(state.collections),
      deletionBlocked: state.deletionBlocked,
      inventory: structuredClone(state.inventory),
      mutation: structuredClone(state.mutation),
      prepareEligibility: eligibilityFor(
        state.target.kind,
        state.inventory,
        state.mutation,
        input.v1LocalOnlyTargets,
      ),
      target: state.target,
    })),
  };
}

function eligibilityFor(
  kind: PublicTargetDefinition["kind"],
  inventory: PublicInventoryState,
  mutation: PublicMutationState,
  v1LocalOnlyTargets: boolean,
): PrepareEligibility {
  return projectPrepareEligibility({
    freshness: inventory.freshness,
    kind,
    mutationPhase: mutation.phase,
    v1LocalOnlyTargets,
  });
}

