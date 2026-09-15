import { describe, expect, it } from "vitest";

import { describeHarnessEffect } from "./harness-effect.js";
import { commandPlanSchema, type CommandPlan } from "./workspace.js";

const basePlan: CommandPlan = {
  harness: "codex",
  names: ["tdd"],
  operation: "remove",
  preview: "npx skills@1.5.23 remove tdd --agent codex --yes",
  schemaVersion: 1,
  scope: "project",
  source: null,
  targetId: "00000000-0000-4000-8000-000000000001",
  timeoutMs: 120_000,
};

describe("Command Plan harness effect", () => {
  it("accepts bound and CLI-unscoped effects and keeps older plans valid", () => {
    expect(commandPlanSchema.safeParse(basePlan).success).toBe(true);
    expect(
      commandPlanSchema.safeParse({
        ...basePlan,
        harnessEffect: { harnessIds: ["codex"], kind: "bound" },
      }).success,
    ).toBe(true);
    expect(
      commandPlanSchema.safeParse({
        ...basePlan,
        harnessEffect: {
          kind: "cli-unscoped",
          targetHarnessIds: ["amp", "codex"],
        },
        operation: "update",
      }).success,
    ).toBe(true);
    for (const harnessEffect of [
      { kind: "bound" },
      { harnessIds: [], kind: "bound" },
      { harnessIds: ["codex", "amp"], kind: "bound" },
      { kind: "cli-unscoped" },
      { harnessIds: ["codex"], kind: "everything" },
    ]) {
      expect(
        commandPlanSchema.safeParse({ ...basePlan, harnessEffect }).success,
      ).toBe(false);
    }
  });

  it("describes bound plans and falls back to the operation for older plans", () => {
    expect(describeHarnessEffect(basePlan)).toMatchObject({
      harnessIds: ["codex"],
      kind: "bound",
      summary: expect.stringContaining("Only the codex link for"),
    });
    expect(
      describeHarnessEffect({
        ...basePlan,
        harnessEffect: { harnessIds: ["amp", "cursor"], kind: "bound" },
        harnessIds: ["amp", "cursor"],
      }),
    ).toMatchObject({
      harnessIds: ["amp", "cursor"],
      kind: "bound",
      summary: expect.stringContaining("Only the amp, cursor links for"),
    });
  });

  it("discloses that update reaches every CLI-managed harness in the scope", () => {
    const explicit = describeHarnessEffect({
      ...basePlan,
      harnessEffect: {
        kind: "cli-unscoped",
        targetHarnessIds: ["amp", "codex"],
      },
      operation: "update",
      scope: "global",
    });
    expect(explicit.kind).toBe("cli-unscoped");
    expect(explicit.harnessIds).toEqual(["amp", "codex"]);
    expect(explicit.summary).toContain("in global scope");
    expect(explicit.summary).toContain("This Target binds amp, codex.");

    const legacyUpdate = describeHarnessEffect({
      ...basePlan,
      operation: "update",
    });
    expect(legacyUpdate).toMatchObject({
      harnessIds: ["codex"],
      kind: "cli-unscoped",
    });
  });

  it("localizes the prose but never the harness identifiers", () => {
    const chinese = describeHarnessEffect(
      {
        ...basePlan,
        harnessEffect: {
          kind: "cli-unscoped",
          targetHarnessIds: ["amp", "codex"],
        },
        operation: "update",
      },
      "zh-CN",
    );
    expect(chinese.title).toBe("影响所有由 CLI 管理的 Harness");
    expect(chinese.summary).toContain("amp, codex");
    expect(chinese.summary).toContain("项目范围");
    expect(chinese.summary).not.toMatch(/pinned Skills CLI/);
    expect(describeHarnessEffect(basePlan, "zh-CN").summary).toContain(
      "codex",
    );
  });
});
