import { describe, expect, it } from "vitest";

import { SOURCE_FAMILIES } from "@skills-desktop/skills-runtime";

import { CATALOGS } from "./i18n/translate.js";
import { describeCommandPlanSource } from "./source-disclosure.js";
import { commandPlanSchema, type CommandPlan } from "./workspace.js";

const addPlan: CommandPlan = {
  harness: "codex",
  names: ["find-skills"],
  operation: "add",
  preview:
    "npx skills@1.5.23 add vercel-labs/skills --skill find-skills --agent codex --yes",
  schemaVersion: 1,
  scope: "project",
  source: { source: "vercel-labs/skills", sourceType: "github" },
  targetId: "00000000-0000-4000-8000-000000000001",
  timeoutMs: 600_000,
};

describe("Command Plan source disclosure (ADR 0015)", () => {
  it("keeps legacy GitHub plans valid and discloses them as mutable unless revision-pinned", () => {
    expect(commandPlanSchema.safeParse(addPlan).success).toBe(true);
    expect(describeCommandPlanSource(addPlan.source!)).toMatchObject({
      family: "github",
      familyLabel: "GitHub repository",
      mutability: "mutable",
      source: "vercel-labs/skills",
      title: "Mutable source",
    });
    const pinned = describeCommandPlanSource({
      revision: "0123456789abcdef0123456789abcdef01234567",
      source: "vercel-labs/skills",
      sourceType: "github",
    });
    expect(pinned).toMatchObject({
      mutability: "pinned",
      source: "vercel-labs/skills@0123456789abcdef0123456789abcdef01234567",
      title: "Pinned source",
    });
    expect(pinned.summary).toContain(pinned.source);
  });

  it("carries the inspected descriptor's family and mutability and localizes only the prose", () => {
    const inspected = {
      family: "http-archive" as const,
      inspectionDigest: "a".repeat(64),
      inspectionId: "inspection-1",
      mutability: "mutable" as const,
      ref: null,
      source: "https://example.test/skills.tar.gz",
      sourceType: "inspected" as const,
    };
    expect(
      commandPlanSchema.safeParse({ ...addPlan, source: inspected }).success,
    ).toBe(true);
    const english = describeCommandPlanSource(inspected);
    expect(english).toMatchObject({
      family: "http-archive",
      familyLabel: "HTTP archive",
      mutability: "mutable",
      source: inspected.source,
    });
    const chinese = describeCommandPlanSource(inspected, "zh-CN");
    expect(chinese.source).toBe(inspected.source);
    expect(chinese.summary).toContain(inspected.source);
    expect(chinese.title).not.toBe(english.title);
    expect(chinese.familyLabel).not.toBe(english.familyLabel);
  });

  it("has a localized label for every reviewed source family", () => {
    for (const family of SOURCE_FAMILIES) {
      const disclosure = describeCommandPlanSource({
        family,
        inspectionDigest: "a".repeat(64),
        inspectionId: "inspection-1",
        mutability: family === "git" ? "pinned" : "mutable",
        ref: null,
        source: "example",
        sourceType: "inspected",
      });
      expect(disclosure.familyLabel).not.toMatch(/^source\./);
      expect(disclosure.familyLabel.length).toBeGreaterThan(0);
      expect(Object.values(CATALOGS.en)).toContain(disclosure.familyLabel);
    }
  });
});
