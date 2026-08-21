import { describe, expect, it } from "vitest";

import { isInventoryEntryAvailableToHarness } from "./inventory-availability.js";

describe("Inventory harness availability", () => {
  it("recognizes Codex's canonical empty-agent entry without widening other harnesses", () => {
    expect(isInventoryEntryAvailableToHarness({ agents: [] }, "Codex")).toBe(
      true,
    );
    expect(isInventoryEntryAvailableToHarness({ agents: [] }, "Claude")).toBe(
      false,
    );
    expect(
      isInventoryEntryAvailableToHarness({ agents: ["Claude"] }, "Claude"),
    ).toBe(true);
  });
});
