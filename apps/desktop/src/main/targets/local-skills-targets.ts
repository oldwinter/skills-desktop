import { createHash } from "node:crypto";

import type { SkillsProcess } from "../adapters/local-skills-process.js";
import type {
  EffectiveTargetBinding,
  SkillsTargets,
  TargetDefinition,
} from "../application/desktop-capabilities.js";

export function createLocalSkillsTargets(input: {
  readonly processFor: (binding: EffectiveTargetBinding) => SkillsProcess;
  readonly workspace: string;
  readonly workspaceLabel: string;
}): SkillsTargets {
  const workspaceIdentity = createHash("sha256")
    .update(input.workspace)
    .digest("hex")
    .slice(0, 24);
  const target: TargetDefinition = {
    generation: 1,
    harness: "Codex",
    id: `local-codex-${workspaceIdentity}`,
    kind: "local",
    label: "This device",
    workspace: input.workspace,
    workspaceLabel: input.workspaceLabel,
  };

  return {
    async open(targetId) {
      const binding: EffectiveTargetBinding = {
        generation: target.generation,
        harness: target.harness,
        kind: target.kind,
        targetId: target.id,
        workspace: target.workspace,
      };
      return targetId === target.id
        ? {
            ok: true,
            value: { binding, process: input.processFor(binding), target },
          }
        : {
            error: {
              code: "target_not_found",
              effects: "none",
              message: "Target was not found.",
              phase: "open",
              retryable: false,
            },
            ok: false,
          };
    },
    primaryTarget: target,
  };
}
