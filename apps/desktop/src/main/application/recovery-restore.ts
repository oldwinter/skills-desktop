import type { InventorySnapshot, MutationGuard } from "../persistence/recovery-records.js";
import type {
  PublicInventoryState,
  PublicMutationState,
} from "../../contracts/workspace.js";
import type { TargetDefinition } from "../targets/skills-targets.js";
import {
  isLocalWorkspaceRoot,
  localWorkspaceLabel,
} from "../targets/workspace-path.js";
import { publicError } from "./request-errors.js";
import {
  emptyInventoryState,
  emptyMutationState,
  projectEntries,
  staleAfterFailure,
  targetGenerationStaleError,
} from "./snapshot-projection.js";

export function repairPersistedRootWorkspaces(
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

export function remapRecoveredTargetId<
  Value extends { readonly targetId: string },
>(
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

export function stateFromRecoveredRecords(
  definition: TargetDefinition,
  snapshot: InventorySnapshot | undefined,
  guard: MutationGuard | undefined,
  currentInventory: PublicInventoryState = emptyInventoryState(),
  currentMutation: PublicMutationState = emptyMutationState(),
): {
  readonly inventory: PublicInventoryState;
  readonly mutation: PublicMutationState;
} {
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
}
