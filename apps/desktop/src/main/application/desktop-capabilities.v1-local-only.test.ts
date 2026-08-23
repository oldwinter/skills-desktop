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

const sshTarget: TargetDefinition = {
  connectionReference: "build-host",
  generation: 1,
  harness: "Codex",
  id: "00000000-0000-4000-8000-000000000002",
  kind: "ssh",
  label: "Build host",
  workspace: "/srv/skills",
  workspaceLabel: "remote",
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

const sshRejectError = {
  code: "invalid_request",
  effects: "none",
  message: "SSH Targets are next-scope and outside the V1 Local commitment.",
  phase: "target",
  retryable: false,
} as const;

function durable(target: TargetDefinition) {
  return {
    connectionReference: target.connectionReference ?? null,
    executionBindingDigest: null,
    generation: target.generation,
    harness: target.harness,
    id: target.id,
    kind: target.kind,
    label: target.label,
    workspace: target.workspace,
  };
}

describe("V1 Local-only Target authority", () => {
  it("rejects ssh Target create when v1LocalOnlyTargets is enabled", async () => {
    const capabilities = createDesktopCapabilities({
      id: () => "00000000-0000-4000-8000-000000000099",
      recoveryRecords: createMemoryRecoveryRecords([], [], [durable(localTarget)]),
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
      error: sshRejectError,
    });
  });

  it("rejects collection.prepare-many that includes an ssh Target", async () => {
    const skillsTargets = createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: localTarget,
      processFor: () => unusedProcess,
    });
    skillsTargets.replaceDefinitions([localTarget, sshTarget]);
    const capabilities = createDesktopCapabilities({
      id: () => "00000000-0000-4000-8000-000000000099",
      recoveryRecords: createMemoryRecoveryRecords(
        [],
        [],
        [durable(localTarget), durable(sshTarget)],
      ),
      skillsTargets,
      v1LocalOnlyTargets: true,
    });
    await capabilities.initialize();
    expect(skillsTargets.definitions.map((target) => target.kind)).toEqual([
      "local",
      "ssh",
    ]);
    const session = capabilities.attach(
      {
        endpointId: "workspace-v1-prepare-many",
        role: "workspace",
        sessionEpoch: "epoch-v1-many",
      },
      () => undefined,
    );

    await expect(
      session.request({
        collectionId: "skills-desktop-starter",
        manifestDigest: `sha256:${"a".repeat(64)}`,
        releaseNumber: 1,
        targets: [
          {
            scope: "project",
            selections: [{ mode: "add", name: "find-skills" }],
            targetId: localTarget.id,
          },
          {
            scope: "project",
            selections: [{ mode: "add", name: "find-skills" }],
            targetId: sshTarget.id,
          },
        ],
        type: "collection.prepare-many",
        version: 1,
      }),
    ).resolves.toEqual({
      ok: false,
      error: sshRejectError,
    });
  });

  it("rejects operational requests for a restored SSH Target without opening SSH", async () => {
    const readySshTarget: TargetDefinition = {
      ...sshTarget,
      executionBindingDigest: "a".repeat(64),
      generation: 4,
    };
    let inspectCalls = 0;
    let observeCalls = 0;
    let prepareCalls = 0;
    let executeCalls = 0;
    const commits: string[] = [];
    const records = createMemoryRecoveryRecords(
      [],
      [],
      [durable(localTarget), durable(readySshTarget)],
    );
    const capabilities = createDesktopCapabilities({
      id: () => "00000000-0000-4000-8000-000000000099",
      recoveryRecords: {
        commit(change) {
          commits.push(change.type);
          return records.commit(change);
        },
        restore: () => records.restore(),
      },
      skillsTargets: createSkillsTargetsCatalog({
        id: () => "00000000-0000-4000-8000-000000000099",
        initialTarget: localTarget,
        processFor: () => ({
          ...unusedProcess,
          async executeConfirmed() {
            executeCalls += 1;
            return unusedProcess.executeConfirmed();
          },
          async observeInventory() {
            observeCalls += 1;
            return unusedProcess.observeInventory();
          },
          async prepareMutation() {
            prepareCalls += 1;
            return unusedProcess.prepareMutation();
          },
        }),
        sshAccess: {
          async confirm() {
            throw new Error("SSH confirm must not run in V1 Local-only.");
          },
          async inspect() {
            inspectCalls += 1;
            throw new Error("SSH inspect must not run in V1 Local-only.");
          },
          pendingChallenge() {
            return {
              algorithm: "ssh-ed25519",
              expiresAt: "2099-01-01T00:00:00.000Z",
              fingerprint: "SHA256:restored",
              id: "challenge-restored",
              identity: "deploy@resolved.internal:2222",
              kind: "first-use",
              targetGeneration: readySshTarget.generation,
              targetId: readySshTarget.id,
            };
          },
        },
      }),
      v1LocalOnlyTargets: true,
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-v1-restored-ssh",
        role: "workspace",
        sessionEpoch: "epoch-v1-restored-ssh",
      },
      () => undefined,
    );
    commits.length = 0;

    await expect(session.snapshot()).resolves.toMatchObject({
      targets: expect.arrayContaining([
        expect.objectContaining({
          target: expect.objectContaining({
            id: readySshTarget.id,
            kind: "ssh",
          }),
        }),
      ]),
    });

    for (const request of [
      {
        targetId: readySshTarget.id,
        type: "inventory.refresh" as const,
        version: 1 as const,
      },
      {
        intent: { names: ["tdd"], scope: "project" as const, type: "remove" as const },
        targetId: readySshTarget.id,
        type: "mutation.prepare" as const,
        version: 1 as const,
      },
      {
        targetId: readySshTarget.id,
        type: "mutation.reconcile" as const,
        version: 1 as const,
      },
    ]) {
      await expect(session.request(request)).resolves.toEqual({
        ok: false,
        error: sshRejectError,
      });
    }

    await expect(
      session.request({
        targetId: readySshTarget.id,
        type: "host-trust.review",
        version: 1,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_request",
        effects: "none",
        message: "主机身份复核未在 V1 开放。",
        phase: "target",
        retryable: false,
      },
    });

    expect(inspectCalls).toBe(0);
    expect(observeCalls).toBe(0);
    expect(prepareCalls).toBe(0);
    expect(executeCalls).toBe(0);
    expect(commits).toEqual([]);
    await expect(records.restore()).resolves.toMatchObject({
      mutationGuards: [],
      targetDefinitions: expect.arrayContaining([
        expect.objectContaining({
          generation: readySshTarget.generation,
          id: readySshTarget.id,
          kind: "ssh",
        }),
      ]),
    });
  });
});
