import type {
  PrepareEligibility,
  PublicInventoryState,
  PublicMutationState,
  TargetDefinition,
} from "../../contracts/workspace.js";

export function projectPrepareEligibility(input: {
  readonly freshness: PublicInventoryState["freshness"];
  readonly kind: TargetDefinition["kind"];
  readonly mutationPhase: PublicMutationState["phase"];
  readonly v1LocalOnlyTargets: boolean;
}): PrepareEligibility {
  if (input.v1LocalOnlyTargets && input.kind === "ssh") {
    return {
      allowed: false,
      nextAction: "none",
      reason: "ssh-not-in-v1",
    };
  }
  if (input.freshness !== "fresh") {
    return {
      allowed: false,
      nextAction: "refresh",
      reason: "stale-inventory",
    };
  }
  if (input.mutationPhase === "reconciliation-required") {
    return {
      allowed: false,
      nextAction: "reconcile",
      reason: "reconciliation-required",
    };
  }
  if (input.mutationPhase === "running") {
    return {
      allowed: false,
      nextAction: "wait",
      reason: "mutation-running",
    };
  }
  return {
    allowed: true,
    nextAction: "none",
    reason: null,
  };
}
