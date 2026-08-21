import { describe, expect, it } from "vitest";

import type { SkillsProcess } from "../adapters/local-skills-process.js";
import { createLocalSkillsTargets } from "./local-skills-targets.js";

const process: SkillsProcess = {
  async executeConfirmed() {
    return {
      error: {
        code: "confirmation_invalid",
        effects: "none",
        message: "Not used by this contract.",
        phase: "execute",
        retryable: false,
      },
      ok: false,
    };
  },
  async prepareMutation() {
    return {
      error: {
        code: "mutation_ineligible",
        effects: "none",
        message: "Not used by this contract.",
        phase: "prepare",
        retryable: false,
      },
      ok: false,
    };
  },
  async observeInventory() {
    return {
      error: {
        code: "process_failed",
        effects: "none",
        message: "Not used by this contract.",
        phase: "test",
        retryable: false,
      },
      ok: false,
    };
  },
};

describe("Local SkillsTargets identity", () => {
  it("owns the canonical workspace and freezes it into each opened Effective Binding", async () => {
    const bindings: unknown[] = [];
    const first = createLocalSkillsTargets({
      processFor(binding) {
        bindings.push(binding);
        return process;
      },
      workspace: "/work/alpha",
      workspaceLabel: "alpha",
    });
    const same = createLocalSkillsTargets({
      processFor: () => process,
      workspace: "/work/alpha",
      workspaceLabel: "alpha-renamed-label",
    }).primaryTarget;
    const other = createLocalSkillsTargets({
      processFor: () => process,
      workspace: "/work/beta",
      workspaceLabel: "beta",
    }).primaryTarget;

    expect(first.primaryTarget.id).toBe(same.id);
    expect(first.primaryTarget.id).not.toBe(other.id);
    expect(first.primaryTarget).toMatchObject({
      generation: 1,
      workspace: "/work/alpha",
    });
    expect(first.primaryTarget.id).not.toContain("/work/alpha");

    const opened = await first.open(first.primaryTarget.id);
    expect(opened).toMatchObject({
      ok: true,
      value: {
        binding: {
          generation: 1,
          harness: "Codex",
          kind: "local",
          targetId: first.primaryTarget.id,
          workspace: "/work/alpha",
        },
        process,
        target: first.primaryTarget,
      },
    });
    expect(bindings).toEqual([
      {
        generation: 1,
        harness: "Codex",
        kind: "local",
        targetId: first.primaryTarget.id,
        workspace: "/work/alpha",
      },
    ]);
  });
});
