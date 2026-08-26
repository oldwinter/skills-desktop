import {
  interpretHarnessCoverage,
  resolveLegacyHarnessAlias,
} from "@skills-desktop/skills-runtime";

export function isInventoryEntryAvailableToHarness(
  entry: {
    readonly agents: readonly string[];
    readonly scope: "global" | "project";
  },
  harness: string,
): boolean {
  if (entry.agents.includes(harness)) return true;
  const requested = resolveLegacyHarnessAlias(harness);
  if (!requested.ok) return false;
  const coverage = interpretHarnessCoverage({
    harnessId: requested.value,
    inventoryTokens: entry.agents,
    scope: entry.scope,
  });
  return coverage === "direct" || coverage === "shared";
}
