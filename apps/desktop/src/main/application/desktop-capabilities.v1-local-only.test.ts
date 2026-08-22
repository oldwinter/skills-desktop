import { describe, expect, it } from "vitest";

import { createMemoryRecoveryRecords } from "../persistence/recovery-records.js";
import {
  createDesktopCapabilities,
  type TargetDefinition,
} from "./desktop-capabilities.js";
import { createSkillsTargetsCatalog } from "../targets/local-skills-targets.js";
import type { SkillsProcess } from "../adapters/local-skills-process.js";

const localTarget: TargetDefinition = {
  generation: 1,
  harness: "Codex",
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "This device",
  workspace: "/work/skills-desktop",
  workspaceLabel: "skills-desktop",
};

const unusedProcess = {
  async executeConfirmed() {
    return {
      error: {
        code: "confirmation_invalid",
        effects: "none",
        message: "unused",
        phase: "execute",
        retryable: false,
      },
      ok: false as const,
    };
  },
  async observeInventory() {
    return {
      ok: true as const,
      value: {
        cliVersion: "1.5.23",
        entries: [],
        observedAt: "2026-08-21T10:00:00.000Z",
        schemaVersion: 1 as const,
      },
    };
  },
  async prepareMutation() {
    return {
      error: {
        code: "mutation_ineligible",
        effects: "none",
        message: "unused",
        phase: "prepare",
        retryable: false,
      },
      ok: false as const,
    };
  },
} satisfies SkillsProcess;

describe("V1 Local-only Target authority", () => {
  it("rejects ssh Target create when v1LocalOnlyTargets is enabled", async () => {
    const capabilities = createDesktopCapabilities({
      id: () => "00000000-0000-4000-8000-000000000099",
      recoveryRecords: createMemoryRecoveryRecords(
        [],
        [],
        [
          {
            connectionReference: null,
            generation: localTarget.generation,
            harness: localTarget.harness,
            id: localTarget.id,
            kind: localTarget.kind,
            label: localTarget.label,
            workspace: localTarget.workspace,
          },
        ],
      ),
      skillsTargets: createSkillsTargetsCatalog({
        id: () => "00000000-0000-4000-8000-000000000099",
        initialTarget: localTarget,
        processFor: () => unusedProcess,
      }),
      v1LocalOnlyTargets: true,
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-v1-local-only",
        role: "workspace",
        sessionEpoch: "epoch-v1",
      },
      () => undefined,
    );

    await expect(
      session.request({
        definition: {
          connectionReference: "build-host",
          harness: "Codex",
          kind: "ssh",
          label: "Build host",
          workspace: "/srv/skills",
        },
        type: "target.create",
        version: 1,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_request",
        effects: "none",
        message:
          "SSH Targets are next-scope and outside the V1 Local commitment.",
        phase: "target",
        retryable: false,
      },
    });
  });
});
