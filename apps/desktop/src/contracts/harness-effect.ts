import type { CommandPlan, CommandPlanHarnessEffect } from "./workspace.js";

export interface HarnessEffectDescription {
  readonly harnessIds: readonly string[];
  readonly kind: CommandPlanHarnessEffect["kind"];
  readonly summary: string;
  readonly title: string;
}

function scopeWord(scope: CommandPlan["scope"]): string {
  return scope === "project" ? "project" : "global";
}

/**
 * Describes which harness links a Command Plan can touch (ADR 0014). Plans
 * produced before `harnessEffect` existed fall back to the operation: only
 * `update` runs without `--agent`, so only `update` is CLI-unscoped.
 */
export function describeHarnessEffect(
  commandPlan: CommandPlan,
): HarnessEffectDescription {
  const effect: CommandPlanHarnessEffect =
    commandPlan.harnessEffect ??
    (commandPlan.operation === "update"
      ? {
          kind: "cli-unscoped",
          targetHarnessIds: commandPlan.harnessIds ?? [commandPlan.harness],
        }
      : {
          harnessIds: commandPlan.harnessIds ?? [commandPlan.harness],
          kind: "bound",
        });
  if (effect.kind === "bound") {
    const list = effect.harnessIds.join(", ");
    return {
      harnessIds: effect.harnessIds,
      kind: "bound",
      summary: `Only the ${list} link${effect.harnessIds.length === 1 ? "" : "s"} for the listed Skills change. Links for other harnesses stay as they are.`,
      title: "Bound to selected harnesses",
    };
  }
  return {
    harnessIds: effect.targetHarnessIds,
    kind: "cli-unscoped",
    summary: `The pinned Skills CLI cannot limit update to a harness. It updates every CLI-managed link for the listed Skills in ${scopeWord(commandPlan.scope)} scope, including harnesses this Target does not bind. This Target binds ${effect.targetHarnessIds.join(", ")}.`,
    title: "Affects every CLI-managed harness",
  };
}
