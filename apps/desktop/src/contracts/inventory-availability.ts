export function isInventoryEntryAvailableToHarness(
  entry: { readonly agents: readonly string[] },
  harness: string,
): boolean {
  return (
    entry.agents.includes(harness) ||
    (harness === "Codex" && entry.agents.length === 0)
  );
}
