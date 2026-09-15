import { describe, expect, it } from "vitest";

import type { WorkspaceSnapshot } from "../../contracts/workspace.js";
import {
  createMemoryRecoveryRecords,
  type DurableChange,
  type RecoveryRecords,
  type RestoredRecoveryRecords,
} from "../persistence/recovery-records.js";
import { createSkillsTargetsCatalog } from "../targets/local-skills-targets.js";
import type { SkillsProcess } from "../adapters/local-skills-process.js";
import {
  createDesktopCapabilities,
  type TargetDefinition,
} from "./desktop-capabilities.js";

const localTarget: TargetDefinition = {
  connectionReference: null,
  dialectId: "skills-1.5.23",
  executionBindingDigest: null,
  generation: 1,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "This device",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/work/skills-desktop",
  workspaceLabel: "skills-desktop",
};

const blockedId = "00000000-0000-4000-8000-000000000024";

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

/**
 * Scripted RecoveryRecords whose Target store is blocked by an unknown legacy
 * harness until the typed repair arrives, mirroring the JSON adapter contract.
 */
function blockedRecoveryRecords() {
  const commits: DurableChange[] = [];
  let repaired = false;
  const records: RecoveryRecords = {
    async commit(change) {
      commits.push(change);
      if (change.type === "target.repair-legacy-harness") {
        if (change.targetId !== blockedId || repaired) {
          return {
            error: {
              code: "persist_failed",
              effects: "none",
              message: "No blocked Target Definition matches this repair.",
              phase: "persist",
              retryable: false,
            },
            ok: false,
          };
        }
        repaired = true;
      }
      return { ok: true, value: undefined };
    },
    async restore(): Promise<RestoredRecoveryRecords> {
      return repaired
        ? {
            blockedTargetDefinitions: [],
            failures: [],
            hostTrustRecords: [],
            inventorySnapshots: [],
            mutationGuards: [],
            targetDefinitions: [
              {
                connectionReference: null,
                dialectId: "skills-1.5.23",
                executionBindingDigest: null,
                generation: 5,
                harnessIds: ["claude-code"],
                id: blockedId,
                kind: "local",
                label: "Needs repair",
                registryDigest: localTarget.registryDigest,
                registryVersion: 1,
                workspace: "/work/blocked",
              },
            ],
          }
        : {
            blockedTargetDefinitions: [
              {
                generation: 4,
                id: blockedId,
                label: "Needs repair",
                legacyHarness: "Future Harness",
                reason: "unsupported_harness",
              },
            ],
            failures: [
              {
                code: "migration_failed",
                store: "targetDefinitions",
                targetIds: [blockedId],
              },
            ],
            hostTrustRecords: [],
            inventorySnapshots: [],
            mutationGuards: [],
            targetDefinitions: [],
          };
    },
  };
  return { commits, records };
}

function capabilitiesWith(records: RecoveryRecords) {
  return createDesktopCapabilities({
    id: () => "00000000-0000-4000-8000-000000000099",
    recoveryRecords: records,
    skillsTargets: createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: localTarget,
      processFor: () => unusedProcess,
    }),
    v1LocalOnlyTargets: true,
  });
}

describe("Recovery Center typed Target repair (#209)", () => {
  it("projects blocked Targets, repairs one through RecoveryRecords, and asks for a restart", async () => {
    const { commits, records } = blockedRecoveryRecords();
    const capabilities = capabilitiesWith(records);
    await capabilities.initialize();
    const events: WorkspaceSnapshot[] = [];
    const session = capabilities.attach(
      {
        endpointId: "workspace-recovery",
        role: "workspace",
        sessionEpoch: "epoch-recovery",
      },
      (event) => {
        if (event.type === "snapshot.changed") events.push(event.snapshot);
      },
    );

    const before = (await session.snapshot()) as WorkspaceSnapshot;
    expect(before.blockedTargets).toEqual([
      {
        generation: 4,
        id: blockedId,
        label: "Needs repair",
        legacyHarness: "Future Harness",
        reason: "unsupported_harness",
      },
    ]);
    expect(before.recovery).toEqual({
      repairedTargets: [],
      restartRequired: false,
    });
    expect(before.inventory.phase).toBe("error");
    expect(before.inventory.lastError).not.toBeNull();

    await expect(
      session.request({
        targetId: localTarget.id,
        type: "inventory.refresh",
        version: 2,
      }),
    ).resolves.toMatchObject({
      error: { code: "target_unavailable" },
      ok: false,
    });

    await expect(
      session.request({
        harnessId: "not-a-harness",
        targetId: blockedId,
        type: "target.repair",
        version: 2,
      }),
    ).resolves.toMatchObject({
      error: { code: "invalid_request" },
      ok: false,
    });
    await expect(
      session.request({
        harnessId: "codex",
        targetId: localTarget.id,
        type: "target.repair",
        version: 2,
      }),
    ).resolves.toMatchObject({
      error: { code: "target_not_found" },
      ok: false,
    });
    expect(
      commits.filter(({ type }) => type === "target.repair-legacy-harness"),
    ).toHaveLength(0);

    await expect(
      session.request({
        harnessId: "claude-code",
        targetId: blockedId,
        type: "target.repair",
        version: 2,
      }),
    ).resolves.toEqual({ ok: true, value: { operationId: blockedId } });
    expect(
      commits.filter(({ type }) => type === "target.repair-legacy-harness"),
    ).toEqual([
      {
        harnessId: "claude-code",
        targetId: blockedId,
        type: "target.repair-legacy-harness",
      },
    ]);

    const after = (await session.snapshot()) as WorkspaceSnapshot;
    expect(after.blockedTargets).toEqual([]);
    expect(after.recovery).toEqual({
      repairedTargets: [
        { harnessId: "claude-code", id: blockedId, label: "Needs repair" },
      ],
      restartRequired: true,
    });
    expect(after.targets?.map(({ target }) => target.id)).not.toContain(
      blockedId,
    );

    await expect(
      session.request({
        harnessId: "codex",
        targetId: blockedId,
        type: "target.repair",
        version: 2,
      }),
    ).resolves.toMatchObject({
      error: { code: "target_not_found" },
      ok: false,
    });
    session.teardown();
  });

  it("reports a healthy store without repair work", async () => {
    const capabilities = capabilitiesWith(
      createMemoryRecoveryRecords([], [], [
        (({ workspaceLabel: _label, ...durable }) => durable)(localTarget),
      ]),
    );
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-healthy",
        role: "workspace",
        sessionEpoch: "epoch-healthy",
      },
      () => undefined,
    );
    const snapshot = (await session.snapshot()) as WorkspaceSnapshot;
    expect(snapshot.blockedTargets).toEqual([]);
    expect(snapshot.recovery).toEqual({
      repairedTargets: [],
      restartRequired: false,
    });
    await expect(
      session.request({
        harnessId: "codex",
        targetId: blockedId,
        type: "target.repair",
        version: 2,
      }),
    ).resolves.toMatchObject({
      error: { code: "target_not_found" },
      ok: false,
    });
    session.teardown();
  });
});
