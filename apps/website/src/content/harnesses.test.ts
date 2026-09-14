import { HARNESS_REGISTRY } from "@skills-desktop/skills-runtime";
import { describe, expect, it } from "vitest";

import {
  FEATURED_HARNESSES,
  FEATURED_HARNESS_COUNT,
  HARNESS_REGISTRY_LABEL,
  HARNESS_TOTAL,
  REMAINING_HARNESSES,
  tileLabel,
} from "./harnesses.js";

describe("harness cards", () => {
  it("covers the whole pinned registry exactly once", () => {
    const ids = [...FEATURED_HARNESSES, ...REMAINING_HARNESSES].map((card) => card.id);
    expect(ids).toHaveLength(HARNESS_TOTAL);
    expect(new Set(ids).size).toBe(HARNESS_REGISTRY.length);
    expect(FEATURED_HARNESSES).toHaveLength(FEATURED_HARNESS_COUNT);
  });

  it("derives display names and scope support from the registry rather than hand-typed copy", () => {
    for (const card of [...FEATURED_HARNESSES, ...REMAINING_HARNESSES]) {
      const entry = HARNESS_REGISTRY.find((candidate) => candidate.cliId === card.id);
      expect(entry).toBeDefined();
      expect(card.name).toBe(entry?.displayAliases[0]);
      expect(card.globalSupported).toBe(entry?.scopeSupport.global);
    }
  });

  it("sorts the remaining harnesses alphabetically by display name", () => {
    const names = REMAINING_HARNESSES.map((card) => card.name);
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right, "en")));
  });

  it("labels the registry with its version and dialect", () => {
    expect(HARNESS_REGISTRY_LABEL).toMatch(/^registry v\d+ · skills-1\.5\.23$/);
  });
});

describe("tileLabel", () => {
  it("uses the initials of the first two words", () => {
    expect(tileLabel("Claude Code")).toBe("CC");
    expect(tileLabel("Gemini CLI")).toBe("GC");
    expect(tileLabel("inference.sh")).toBe("Is");
  });

  it("falls back to the first two letters of a single word", () => {
    expect(tileLabel("Codex")).toBe("Co");
    expect(tileLabel("cursor")).toBe("Cu");
    expect(tileLabel("")).toBe("");
  });
});
