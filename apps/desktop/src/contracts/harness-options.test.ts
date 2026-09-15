import { HARNESS_IDS } from "@skills-desktop/skills-runtime";
import { describe, expect, it } from "vitest";

import {
  HARNESS_OPTIONS,
  matchesHarnessQuery,
  normalizeHarnessSelection,
} from "./harness-options.js";

describe("harness options", () => {
  it("projects every pinned registry entry in registry order", () => {
    expect(HARNESS_OPTIONS.map(({ id }) => id)).toEqual([...HARNESS_IDS]);
    expect(Object.isFrozen(HARNESS_OPTIONS)).toBe(true);
    expect(HARNESS_OPTIONS.find(({ id }) => id === "eve")).toEqual({
      globalScopeSupported: false,
      id: "eve",
      label: "Eve",
    });
    for (const option of HARNESS_OPTIONS) {
      expect(Object.keys(option).sort()).toEqual([
        "globalScopeSupported",
        "id",
        "label",
      ]);
    }
  });

  it("normalizes a draft selection into unique registry order", () => {
    expect(
      normalizeHarnessSelection(["cursor", "codex", "cursor", "claude-code"]),
    ).toEqual({ ok: true, value: ["claude-code", "codex", "cursor"] });
  });

  it("rejects empty and unknown selections with closed codes", () => {
    expect(normalizeHarnessSelection([])).toMatchObject({
      code: "empty_harness_set",
      ok: false,
    });
    expect(normalizeHarnessSelection(["codex", "not-a-harness"])).toMatchObject(
      { code: "unsupported_harness", ok: false },
    );
  });

  it("matches queries against the label or CLI id case-insensitively", () => {
    const claude = HARNESS_OPTIONS.find(({ id }) => id === "claude-code");
    if (claude === undefined) throw new Error("expected claude-code");
    expect(matchesHarnessQuery(claude, "  ")).toBe(true);
    expect(matchesHarnessQuery(claude, "CLAUDE")).toBe(true);
    expect(matchesHarnessQuery(claude, "claude-c")).toBe(true);
    expect(matchesHarnessQuery(claude, "cursor")).toBe(false);
  });
});
