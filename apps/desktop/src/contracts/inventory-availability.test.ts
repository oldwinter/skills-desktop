import { describe, expect, it } from "vitest";

import { isInventoryEntryAvailableToHarness } from "./inventory-availability.js";

describe("Inventory harness availability", () => {
  it("recognizes Codex's canonical empty-agent entry without widening other harnesses", () => {
    expect(
      isInventoryEntryAvailableToHarness(
        { agents: [], scope: "project" },
        "Codex",
      ),
    ).toBe(true);
    expect(
      isInventoryEntryAvailableToHarness(
        { agents: [], scope: "project" },
        "Claude",
      ),
    ).toBe(false);
    expect(
      isInventoryEntryAvailableToHarness(
        { agents: ["Claude"], scope: "project" },
        "Claude",
      ),
    ).toBe(true);
    expect(
      isInventoryEntryAvailableToHarness(
        { agents: ["Codex"], scope: "project" },
        "Amp",
      ),
    ).toBe(true);
    expect(
      isInventoryEntryAvailableToHarness(
        { agents: ["Codex"], scope: "global" },
        "Amp",
      ),
    ).toBe(false);
  });
});
