import { describe, expect, it } from "vitest";

import { MAX_CLI_OUTPUT_BYTES, parseCliInventory } from "./inventory.js";

const validProjectSkill = {
  name: "tdd",
  path: "/workspace/.agents/skills/tdd",
  scope: "project",
  agents: ["Codex"],
  source: "mattpocock/skills",
  sourceUrl: "https://github.com/mattpocock/skills.git",
  sourceType: "github",
};

describe("CLI Inventory schema", () => {
  it("preserves exact identity, null provenance, and bounded additive evidence", () => {
    const result = parseCliInventory(
      JSON.stringify([
        {
          name: "Case-Sensitive-Skill",
          path: "/workspace/.agents/skills/Case-Sensitive-Skill",
          scope: "project",
          agents: ["Codex"],
          source: null,
          sourceUrl: null,
          sourceType: null,
          upstreamNote: { supported: true },
        },
      ]),
      "project",
    );

    expect(result).toEqual({
      ok: true,
      value: [
        {
          agents: ["Codex"],
          declaredSource: { source: null, sourceType: null },
          extensions: { upstreamNote: { supported: true } },
          name: "Case-Sensitive-Skill",
          path: "/workspace/.agents/skills/Case-Sensitive-Skill",
          scope: "project",
          sourceUrl: null,
          revision: { status: "unknown" },
          contentFingerprint: { status: "unknown" },
        },
      ],
    });
  });

  it("rejects an incompatible known field", () => {
    const result = parseCliInventory(
      JSON.stringify([{ ...validProjectSkill, agents: "Codex" }]),
      "project",
    );

    expect(result).toMatchObject({
      error: { code: "invalid_inventory", effects: "none", phase: "parse" },
      ok: false,
    });
  });

  it("rejects a duplicate Skill Identity", () => {
    const result = parseCliInventory(
      JSON.stringify([validProjectSkill, { ...validProjectSkill, path: "/other/tdd" }]),
      "project",
    );

    expect(result).toMatchObject({
      error: { code: "duplicate_inventory_entry" },
      ok: false,
    });
  });

  it("rejects conflicting provenance for one scope and name", () => {
    const result = parseCliInventory(
      JSON.stringify([
        validProjectSkill,
        {
          ...validProjectSkill,
          source: "another/source",
          sourceUrl: "https://github.com/another/source.git",
        },
      ]),
      "project",
    );

    expect(result).toMatchObject({
      error: { code: "conflicting_inventory_entry" },
      ok: false,
    });
  });

  it("rejects output above the byte limit before decoding", () => {
    const result = parseCliInventory(" ".repeat(MAX_CLI_OUTPUT_BYTES + 1), "project");

    expect(result).toMatchObject({
      error: { code: "inventory_too_large" },
      ok: false,
    });
  });

  it("rejects deeply nested additive evidence", () => {
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 10; depth += 1) nested = { nested };
    const result = parseCliInventory(
      JSON.stringify([{ ...validProjectSkill, additiveEvidence: nested }]),
      "project",
    );

    expect(result).toMatchObject({
      error: { code: "unsupported_schema" },
      ok: false,
    });
  });
});
