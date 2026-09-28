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

  it("rejects additive evidence above the field-count limit", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`extra${index}`, true]),
    );
    const result = parseCliInventory(
      JSON.stringify([{ ...validProjectSkill, ...wide }]),
      "project",
    );

    expect(result).toMatchObject({
      error: { code: "unsupported_schema", effects: "none", phase: "parse" },
      ok: false,
    });
  });

  it("rejects additive evidence above the byte limit", () => {
    const result = parseCliInventory(
      JSON.stringify([
        { ...validProjectSkill, note: "x".repeat(64 * 1024) },
      ]),
      "project",
    );

    expect(result).toMatchObject({
      error: { code: "inventory_too_large", effects: "none", phase: "parse" },
      ok: false,
    });
  });

  it("rejects wide shallow additive evidence above the node limit", () => {
    const result = parseCliInventory(
      JSON.stringify([
        { ...validProjectSkill, flags: Array(2050).fill(0) },
      ]),
      "project",
    );

    expect(result).toMatchObject({
      error: { code: "unsupported_schema", effects: "none", phase: "parse" },
      ok: false,
    });
  });

  it("rejects decoded output that is not a list", () => {
    const result = parseCliInventory(
      JSON.stringify({ name: "tdd" }),
      "project",
    );

    expect(result).toMatchObject({
      error: { code: "invalid_inventory", effects: "none", phase: "parse" },
      ok: false,
    });
  });

  it("rejects decoded output above the entry limit", () => {
    const entries = Array.from({ length: 5_001 }, (_, index) => ({
      ...validProjectSkill,
      name: `skill-${index}`,
      path: `/workspace/.agents/skills/skill-${index}`,
    }));
    const result = parseCliInventory(JSON.stringify(entries), "project");

    expect(result).toMatchObject({
      error: { code: "invalid_inventory", effects: "none", phase: "parse" },
      ok: false,
    });
  });
});
