import { createTranslator } from "./i18n/translate.js";
import { DEFAULT_LOCALE, type Locale } from "./preferences.js";
import type { CommandPlan, CommandPlanHarnessEffect } from "./workspace.js";

export interface HarnessEffectDescription {
  readonly harnessIds: readonly string[];
  readonly kind: CommandPlanHarnessEffect["kind"];
  readonly summary: string;
  readonly title: string;
}

/**
 * Describes which harness links a Command Plan can touch (ADR 0014). Plans
 * produced before `harnessEffect` existed fall back to the operation: only
 * `update` runs without `--agent`, so only `update` is CLI-unscoped. Harness
 * IDs are interpolated verbatim; only the surrounding prose is localized.
 */
export function describeHarnessEffect(
  commandPlan: CommandPlan,
  locale: Locale = DEFAULT_LOCALE,
): HarnessEffectDescription {
  const { t, tc } = createTranslator(locale);
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
    return {
      harnessIds: effect.harnessIds,
      kind: "bound",
      summary: tc("harnessEffect.bound.summary", effect.harnessIds.length, {
        list: effect.harnessIds.join(", "),
      }),
      title: t("harnessEffect.bound.title"),
    };
  }
  return {
    harnessIds: effect.targetHarnessIds,
    kind: "cli-unscoped",
    summary: t("harnessEffect.unscoped.summary", {
      list: effect.targetHarnessIds.join(", "),
      scope: t(
        commandPlan.scope === "project"
          ? "common.scope.project"
          : "common.scope.global",
      ).toLocaleLowerCase(locale),
    }),
    title: t("harnessEffect.unscoped.title"),
  };
}
