import { HARNESS_IDS } from "@skills-desktop/skills-runtime";
import { describe, expect, it } from "vitest";

import {
  ILLUSTRATIVE_HARNESSES,
  ILLUSTRATIVE_SKILLS,
  ILLUSTRATIVE_TARGETS,
  targetById,
} from "./illustrative-inventory.js";

describe("illustrative inventory", () => {
  it("only references skills and harnesses that appear in the figure", () => {
    const skillNames = new Set(ILLUSTRATIVE_SKILLS.map((skill) => skill.name));
    const harnessIds = new Set(ILLUSTRATIVE_HARNESSES.map((harness) => harness.id));
    for (const target of ILLUSTRATIVE_TARGETS) {
      for (const skill of target.skills) expect(skillNames.has(skill)).toBe(true);
      for (const harness of target.harnesses) expect(harnessIds.has(harness)).toBe(true);
    }
  });

  it("uses registry harness ids", () => {
    for (const harness of ILLUSTRATIVE_HARNESSES) {
      expect(HARNESS_IDS).toContain(harness.id);
    }
  });

  it("resolves targets by id and rejects unknown ids", () => {
    expect(targetById("api").workspace).toBe("~/code/api");
    expect(() => targetById("missing")).toThrow(/Unknown illustrative target/);
  });
});
