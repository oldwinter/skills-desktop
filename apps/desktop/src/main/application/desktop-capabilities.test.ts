import { createHash } from "node:crypto";
import { normalize } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Inventory } from "@skills-desktop/skills-runtime";

import {
  createMemoryRecoveryRecords,
  type RecoveryRecords,
} from "../persistence/recovery-records.js";
import type { SkillsProcess } from "../adapters/local-skills-process.js";
import { createSkillsTargetsCatalog } from "../targets/local-skills-targets.js";
import type { OpenSshTargetAccess } from "../ssh/openssh-target.js";
import {
  createDesktopCapabilities,
  type DesktopEvent,
  type SkillsTargets,
  type TargetDefinition,
} from "./desktop-capabilities.js";

const target: TargetDefinition = {
  generation: 1,
  harness: "Codex",
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "This device",
  workspace: "/work/skills-desktop",
  workspaceLabel: "skills-desktop",
};

const publicTarget = {
  generation: target.generation,
  harness: target.harness,
  id: target.id,
  kind: target.kind,
  label: target.label,
  workspaceLabel: target.workspaceLabel,
};

const freshInventory: Inventory = {
  cliVersion: "1.5.23",
  entries: [
    {
      agents: ["Codex"],
      contentFingerprint: { status: "unknown" },
      declaredSource: { source: "example/skills", sourceType: "github" },
      extensions: { rawPrivateField: "SECRET_EXTENSION" },
      name: "tdd",
      path: "/SECRET_WORKSPACE/.agents/skills/tdd",
      revision: { status: "unknown" },
      scope: "project",
      sourceUrl: "https://SECRET_TOKEN@example.test/repo.git",
    },
  ],
  observedAt: "2026-08-21T10:00:00.000Z",
  schemaVersion: 1,
};

const mutationNotExercised: Pick<
  SkillsProcess,
  "executeConfirmed" | "prepareMutation"
> = {
  async executeConfirmed() {
    return {
      error: {
        code: "confirmation_invalid",
        effects: "none",
        message: "Mutation is not exercised by this inventory contract.",
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
        message: "Mutation is not exercised by this inventory contract.",
        phase: "prepare",
        retryable: false,
      },
      ok: false,
    };
  },
};

function targetsWith(
  process: SkillsProcess,
  id: () => string = () => "00000000-0000-4000-8000-000000000010",
): SkillsTargets {
  return createSkillsTargetsCatalog({
    id,
    initialTarget: target,
    processFor: () => process,
  });
}

const roleSshTarget: TargetDefinition = {
  connectionReference: "build-host",
  executionBindingDigest: "a".repeat(64),
  generation: 2,
  harness: "Codex",
  id: "00000000-0000-4000-8000-000000000018",
  kind: "ssh",
  label: "Build host",
  workspace: "/srv/skills",
  workspaceLabel: "skills",
};

async function createHostTrustRoleFixture(options?: {
  readonly commit?: RecoveryRecords["commit"];
  readonly commitHostTrust?: SkillsTargets["commitHostTrust"];
}) {
  let now = new Date("2026-08-22T10:00:00.000Z");
  let definitions = [roleSshTarget];
  const challenge = {
    algorithm: "ssh-ed25519",
    expiresAt: "2026-08-22T10:05:00.000Z",
    fingerprint: "SHA256:reviewed-fingerprint",
    id: "challenge-1",
    identity: "deploy@resolved.internal:2222",
    kind: "first-use" as const,
    targetGeneration: roleSshTarget.generation,
    targetId: roleSshTarget.id,
  };
  const proposedTarget = {
    ...roleSshTarget,
    generation: roleSshTarget.generation + 1,
  };
  const proposal = {
    definitions: [proposedTarget],
    executionChanged: true,
    target: proposedTarget,
  };
  const commitHostTrust = vi.fn(
    options?.commitHostTrust ??
      (async () => ({ ok: true as const, value: proposal })),
  );
  const replaceDefinitions = vi.fn(
    (replacement: readonly TargetDefinition[]) => {
      definitions = [...replacement];
    },
  );
  const skillsTargets: SkillsTargets = {
    commitHostTrust,
    get definitions() {
      return definitions;
    },
    legacyIdFor() {
      return undefined;
    },
    async open() {
      throw new Error("Target opening is not exercised by host-trust review.");
    },
    pendingHostTrust(targetId) {
      return targetId === roleSshTarget.id ? challenge : undefined;
    },
    get primaryTarget() {
      return definitions[0]!;
    },
    proposeCreate() {
      throw new Error("Target creation is not exercised by host-trust review.");
    },
    proposeDelete() {
      throw new Error("Target deletion is not exercised by host-trust review.");
    },
    proposeHostTrust(targetId, challengeId) {
      if (
        targetId !== roleSshTarget.id ||
        challengeId !== challenge.id ||
        definitions[0]?.generation !== challenge.targetGeneration
      ) {
        return {
          error: {
            code: "host_trust_invalid",
            effects: "none",
            message: "The host-trust review no longer matches this Target.",
            phase: "trust",
            retryable: false,
          },
          ok: false,
        };
      }
      return { ok: true, value: proposal };
    },
    proposeUpdate() {
      throw new Error("Target update is not exercised by host-trust review.");
    },
    replaceDefinitions,
  };
  const memoryRecords = createMemoryRecoveryRecords();
  let fixtureReady = false;
  const commit = vi.fn((change) =>
    fixtureReady && options?.commit !== undefined
      ? options.commit(change)
      : memoryRecords.commit(change),
  );
  const capabilities = createDesktopCapabilities({
    clock: () => now,
    id: () => "host-trust-review",
    recoveryRecords: {
      commit,
      restore: () => memoryRecords.restore(),
    },
    skillsTargets,
  });
  await capabilities.initialize();
  fixtureReady = true;
  commit.mockClear();
  commitHostTrust.mockClear();
  replaceDefinitions.mockClear();
  const workspace = capabilities.attach(
    {
      endpointId: "workspace-host-trust-matrix",
      role: "workspace",
      sessionEpoch: "workspace-epoch",
    },
    () => undefined,
  );
  const requested = await workspace.request({
    targetId: roleSshTarget.id,
    type: "host-trust.review",
    version: 1,
  });
  if (!requested.ok) throw new Error("Host-trust review fixture is invalid.");
  const review = capabilities.attach(
    {
      endpointId: "review-host-trust-matrix",
      reviewId: requested.value.operationId,
      role: "review",
      sessionEpoch: "review-epoch",
    },
    () => undefined,
  );
  const approve = () =>
    review.request({
      decision: "approve",
      type: "review.decide",
      version: 1,
    });
  return {
    approve,
    capabilities,
    challenge,
    commit,
    commitHostTrust,
    replaceDefinitions,
    review,
    setNow(value: string) {
      now = new Date(value);
    },
    skillsTargets,
  };
}

describe("DesktopCapabilities inventory role-session contract", () => {
  it("restores stale evidence and publishes an ordered, bounded Fresh Inventory", async () => {
    const restoredRecords = createMemoryRecoveryRecords([
      {
        cliVersion: "1.5.23",
        entries: [
          {
            agents: ["Codex"],
            contentFingerprint: { status: "unknown" },
            declaredSource: { source: null, sourceType: null },
            name: "restored",
            revision: { status: "unknown" },
            scope: "global",
          },
        ],
        generation: 1,
        observedAt: "2099-01-01T00:00:00.000Z",
        targetId: target.id,
      },
    ]);
    const process: SkillsProcess = {
      ...mutationNotExercised,
      async observeInventory() {
        return { ok: true as const, value: freshInventory };
      },
    };
    const events: DesktopEvent[] = [];
    const capabilities = createDesktopCapabilities({
      id: () => "operation-1",
      recoveryRecords: restoredRecords,
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-contents-1",
        role: "workspace",
        sessionEpoch: "epoch-1",
      },
      (event) => events.push(event),
    );

    expect(await session.snapshot()).toMatchObject({
      inventory: {
        entries: [{ name: "restored" }],
        freshness: "stale",
        phase: "ready",
      },
      sessionEpoch: "epoch-1",
      target: publicTarget,
    });

    const refreshed = await session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    expect(refreshed).toEqual({
      ok: true,
      value: { operationId: "operation-1" },
    });
    const snapshot = await session.snapshot();
    expect(snapshot).toMatchObject({
      inventory: {
        entries: [
          {
            agents: ["Codex"],
            declaredSource: { source: "example/skills", sourceType: "github" },
            name: "tdd",
            scope: "project",
          },
        ],
        freshness: "fresh",
        phase: "ready",
      },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /SECRET_WORKSPACE|SECRET_TOKEN|SECRET_EXTENSION/,
    );
    expect(
      events.map((event) => [
        event.sequence,
        event.type === "snapshot.changed"
          ? event.snapshot.inventory.phase
          : event.type,
      ]),
    ).toEqual([
      [1, "loading"],
      [2, "ready"],
    ]);
    expect(events.every(({ sessionEpoch }) => sessionEpoch === "epoch-1")).toBe(
      true,
    );
    expect(events[1]?.stateRevision).toBeGreaterThan(
      events[0]?.stateRevision ?? 0,
    );
    expect(
      (await restoredRecords.restore()).inventorySnapshots[0]?.entries,
    ).toEqual([
      {
        agents: ["Codex"],
        contentFingerprint: { status: "unknown" },
        declaredSource: { source: "example/skills", sourceType: "github" },
        name: "tdd",
        revision: { status: "unknown" },
        scope: "project",
      },
    ]);
  });

  it("keeps current UUID evidence when fixed-point records collide during reattachment", async () => {
    const legacyTargetId = "local-codex-0123456789abcdef01234567";
    const records = createMemoryRecoveryRecords(
      [
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: 1,
          observedAt: "2026-08-21T09:00:00.000Z",
          targetId: legacyTargetId,
        },
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: 1,
          observedAt: "2026-08-21T10:00:00.000Z",
          targetId: target.id,
        },
      ],
      [
        {
          deadline: "2026-08-21T09:10:00.000Z",
          effects: "possible",
          generation: 1,
          operationId: "legacy-mutation",
          phase: "reconciliation-required",
          targetId: legacyTargetId,
        },
        {
          deadline: "2026-08-21T10:10:00.000Z",
          effects: "possible",
          generation: 1,
          operationId: "current-mutation",
          phase: "reconciliation-required",
          targetId: target.id,
        },
      ],
    );
    const capabilities = createDesktopCapabilities({
      id: () => "operation-legacy-remap",
      recoveryRecords: records,
      skillsTargets: createSkillsTargetsCatalog({
        id: () => "00000000-0000-4000-8000-000000000010",
        initialTarget: target,
        legacyIdFor: () => legacyTargetId,
        processFor: () => ({
          ...mutationNotExercised,
          async observeInventory() {
            return { ok: true as const, value: freshInventory };
          },
        }),
      }),
    });

    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-legacy-remap",
        role: "workspace",
        sessionEpoch: "epoch-legacy-remap",
      },
      () => undefined,
    );

    await expect(workspace.snapshot()).resolves.toMatchObject({
      inventory: {
        freshness: "stale",
        observedAt: "2026-08-21T10:00:00.000Z",
        phase: "ready",
      },
      mutation: {
        phase: "reconciliation-required",
        reconciliationDeadline: "2026-08-21T10:10:00.000Z",
      },
      target: { id: target.id },
    });
    await expect(records.restore()).resolves.toMatchObject({
      inventorySnapshots: [{ targetId: target.id }],
      mutationGuards: [{ targetId: target.id }],
      targetDefinitions: [{ id: target.id }],
    });
  });

  it("keeps the last complete Inventory as stale when a later refresh fails", async () => {
    let observations = 0;
    const process: SkillsProcess = {
      ...mutationNotExercised,
      async observeInventory() {
        observations += 1;
        return observations === 1
          ? { ok: true as const, value: freshInventory }
          : {
              error: {
                code: "process_failed" as const,
                effects: "none" as const,
                message: "Inventory observation failed.",
                phase: "observe",
                retryable: true,
              },
              ok: false as const,
            };
      },
    };
    const capabilities = createDesktopCapabilities({
      id: () => `operation-${observations + 1}`,
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      { endpointId: "workspace-1", role: "workspace", sessionEpoch: "epoch-1" },
      () => undefined,
    );
    await session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    const failed = await session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    expect(failed).toMatchObject({
      error: { code: "process_failed" },
      ok: false,
    });
    expect(await session.snapshot()).toMatchObject({
      inventory: {
        entries: [{ name: "tdd" }],
        freshness: "stale",
        lastError: { code: "process_failed" },
        phase: "error",
      },
    });
  });

  it("cancels a pending observation directly and idempotently", async () => {
    const process: SkillsProcess = {
      ...mutationNotExercised,
      async observeInventory({ signal }) {
        if (signal.aborted) {
          return {
            error: {
              code: "cancelled" as const,
              effects: "none" as const,
              message: "Inventory observation was cancelled.",
              phase: "observe",
              retryable: true,
            },
            ok: false as const,
          };
        }
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                error: {
                  code: "cancelled" as const,
                  effects: "none" as const,
                  message: "Inventory observation was cancelled.",
                  phase: "observe",
                  retryable: true,
                },
                ok: false as const,
              }),
            { once: true },
          );
        });
      },
    };
    const capabilities = createDesktopCapabilities({
      id: () => "pending-operation",
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      { endpointId: "workspace-1", role: "workspace", sessionEpoch: "epoch-1" },
      () => undefined,
    );

    const pending = session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    const cancelled = await session.request({
      operationId: "pending-operation",
      type: "inventory.cancel",
      version: 1,
    });
    const cancelledAgain = await session.request({
      operationId: "pending-operation",
      type: "inventory.cancel",
      version: 1,
    });

    expect(cancelled).toEqual({
      ok: true,
      value: { operationId: "pending-operation" },
    });
    expect(cancelledAgain).toEqual(cancelled);
    expect(await pending).toMatchObject({
      error: { code: "cancelled" },
      ok: false,
    });
    expect(await session.snapshot()).toMatchObject({
      inventory: { freshness: "none", phase: "cancelled" },
    });
  });

  it("cancels an endpoint-owned observation when that endpoint is torn down", async () => {
    let observedSignal: AbortSignal | undefined;
    let reportStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const process: SkillsProcess = {
      ...mutationNotExercised,
      async observeInventory({ signal }) {
        observedSignal = signal;
        reportStarted?.();
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                error: {
                  code: "cancelled" as const,
                  effects: "none" as const,
                  message: "Inventory observation was cancelled.",
                  phase: "observe",
                  retryable: true,
                },
                ok: false as const,
              }),
            { once: true },
          );
        });
      },
    };
    const capabilities = createDesktopCapabilities({
      id: () => "owned-operation",
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const owner = capabilities.attach(
      {
        endpointId: "workspace-owner",
        role: "workspace",
        sessionEpoch: "epoch-owner",
      },
      () => undefined,
    );
    const pending = owner.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await started;

    owner.teardown();

    expect(observedSignal?.aborted).toBe(true);
    expect(await pending).toMatchObject({
      error: { code: "cancelled" },
      ok: false,
    });
  });

  it("denies review-role and malformed workspace requests", async () => {
    const process: SkillsProcess = {
      ...mutationNotExercised,
      async observeInventory() {
        return { ok: true as const, value: freshInventory };
      },
    };
    const capabilities = createDesktopCapabilities({
      id: () => "operation-1",
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const review = capabilities.attach(
      { endpointId: "review-1", role: "review", sessionEpoch: "review-epoch" },
      () => undefined,
    );
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-1",
        role: "workspace",
        sessionEpoch: "workspace-epoch",
      },
      () => undefined,
    );

    expect(
      await review.request({
        targetId: target.id,
        type: "inventory.refresh",
        version: 1,
      }),
    ).toMatchObject({ error: { code: "unauthorized" }, ok: false });
    expect(
      await workspace.request({
        executable: "sh",
        targetId: target.id,
        type: "inventory.refresh",
        version: 1,
      }),
    ).toMatchObject({ error: { code: "invalid_request" }, ok: false });
  });

  it("bounds each endpoint event buffer and requires Snapshot resynchronization after overflow", async () => {
    const deliveries: Array<() => void> = [];
    const events: DesktopEvent[] = [];
    const capabilities = createDesktopCapabilities({
      id: () => "operation-1",
      recoveryRecords: createMemoryRecoveryRecords(),
      scheduleEventDelivery(deliver) {
        deliveries.push(deliver);
      },
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          return { ok: true, value: freshInventory };
        },
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      { endpointId: "workspace-1", role: "workspace", sessionEpoch: "epoch-1" },
      (event) => events.push(event),
    );

    await session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    expect(deliveries).toHaveLength(1);
    deliveries[0]?.();
    expect(events).toEqual([
      {
        reason: "buffer_overflow",
        sequence: 1,
        sessionEpoch: "epoch-1",
        stateRevision: 2,
        type: "resync.required",
      },
    ]);
    expect(await session.snapshot()).toMatchObject({
      eventSequence: 1,
      stateRevision: 2,
    });
  });

  it("stops new requests and awaits active observation cancellation during shutdown", async () => {
    let startedObservation: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedObservation = resolve;
    });
    const capabilities = createDesktopCapabilities({
      id: () => "operation-1",
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        observeInventory({ signal }) {
          startedObservation?.();
          return new Promise((resolve) => {
            signal.addEventListener(
              "abort",
              () =>
                resolve({
                  error: {
                    code: "cancelled",
                    effects: "none",
                    message: "Inventory observation was cancelled.",
                    phase: "observe",
                    retryable: true,
                  },
                  ok: false,
                }),
              { once: true },
            );
          });
        },
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      { endpointId: "workspace-1", role: "workspace", sessionEpoch: "epoch-1" },
      () => undefined,
    );
    const pending = session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await started;

    await capabilities.shutdown();

    expect(await pending).toMatchObject({
      error: { code: "cancelled" },
      ok: false,
    });
    expect(
      await session.request({
        targetId: target.id,
        type: "inventory.refresh",
        version: 1,
      }),
    ).toMatchObject({
      error: { code: "target_unavailable", phase: "shutdown" },
      ok: false,
    });
  });

  it("bounds shutdown when a process Adapter does not settle on cancellation", async () => {
    let finishObservation:
      | ((
          result: Awaited<ReturnType<SkillsProcess["observeInventory"]>>,
        ) => void)
      | undefined;
    let startedObservation: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedObservation = resolve;
    });
    const capabilities = createDesktopCapabilities({
      id: () => "operation-1",
      recoveryRecords: createMemoryRecoveryRecords(),
      shutdownTimeoutMs: 0,
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        observeInventory() {
          startedObservation?.();
          return new Promise((resolve) => {
            finishObservation = resolve;
          });
        },
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      { endpointId: "workspace-1", role: "workspace", sessionEpoch: "epoch-1" },
      () => undefined,
    );
    const pending = session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await started;

    await capabilities.shutdown();

    expect(
      await session.request({
        targetId: target.id,
        type: "inventory.refresh",
        version: 1,
      }),
    ).toMatchObject({
      error: { code: "target_unavailable", phase: "shutdown" },
      ok: false,
    });
    finishObservation?.({
      error: {
        code: "cancelled",
        effects: "none",
        message: "Inventory observation was cancelled.",
        phase: "observe",
        retryable: true,
      },
      ok: false,
    });
    await pending;
  });

  it("creates, edits, and deletes durable Target Definitions with stable generated identity", async () => {
    const records = createMemoryRecoveryRecords(
      [],
      [],
      [
        {
          connectionReference: null,
          generation: target.generation,
          harness: target.harness,
          id: target.id,
          kind: target.kind,
          label: target.label,
          workspace: target.workspace,
        },
      ],
    );
    const capabilities = createDesktopCapabilities({
      id: () => "00000000-0000-4000-8000-000000000002",
      recoveryRecords: records,
      skillsTargets: targetsWith(
        {
          ...mutationNotExercised,
          async observeInventory() {
            return { ok: true, value: freshInventory };
          },
        },
        () => "00000000-0000-4000-8000-000000000002",
      ),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-targets",
        role: "workspace",
        sessionEpoch: "epoch-targets",
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
      ok: true,
      value: { operationId: "00000000-0000-4000-8000-000000000002" },
    });

    await expect(
      session.request({
        definition: {
          connectionReference: "build-host",
          harness: "Codex",
          kind: "ssh",
          label: "CI builder",
          workspace: "/srv/skills-next/../skills-next",
        },
        targetId: "00000000-0000-4000-8000-000000000002",
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(session.snapshot()).resolves.toMatchObject({
      targets: [
        { target: { id: "00000000-0000-4000-8000-000000000001" } },
        {
          target: {
            connectionReference: "build-host",
            generation: 2,
            harness: "Codex",
            id: "00000000-0000-4000-8000-000000000002",
            kind: "ssh",
            label: "CI builder",
            workspace: "/srv/skills-next",
          },
        },
      ],
    });
    await expect(records.restore()).resolves.toMatchObject({
      targetDefinitions: [
        { id: "00000000-0000-4000-8000-000000000001" },
        {
          generation: 2,
          id: "00000000-0000-4000-8000-000000000002",
          label: "CI builder",
        },
      ],
    });

    await expect(
      session.request({
        targetId: "00000000-0000-4000-8000-000000000002",
        type: "target.delete",
        version: 1,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(session.snapshot()).resolves.toMatchObject({
      targets: [{ target: { id: "00000000-0000-4000-8000-000000000001" } }],
    });
  });

  it("retains independent explicitly refreshed Target Sessions", async () => {
    const otherTarget: TargetDefinition = {
      ...target,
      id: "00000000-0000-4000-8000-000000000003",
      label: "Other workspace",
      workspace: "/work/other",
      workspaceLabel: "other",
    };
    const definitions = [target, otherTarget];
    const inventoryFor = (name: string): Inventory => ({
      ...freshInventory,
      entries: [{ ...freshInventory.entries[0]!, name }],
    });
    const skillsTargets = createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000011",
      initialTarget: target,
      processFor(binding) {
        return {
          ...mutationNotExercised,
          async observeInventory() {
            return {
              ok: true as const,
              value: inventoryFor(
                binding.targetId === target.id ? "left-skill" : "right-skill",
              ),
            };
          },
        };
      },
    });
    const records = createMemoryRecoveryRecords(
      [],
      [],
      definitions.map((definition) => ({
        connectionReference: null,
        generation: definition.generation,
        harness: definition.harness,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    );
    let nextId = 0;
    const capabilities = createDesktopCapabilities({
      id: () => `operation-${++nextId}`,
      recoveryRecords: records,
      skillsTargets,
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-multiple-targets",
        role: "workspace",
        sessionEpoch: "epoch-multiple-targets",
      },
      () => undefined,
    );

    await session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await session.request({
      targetId: otherTarget.id,
      type: "inventory.refresh",
      version: 1,
    });

    await expect(session.snapshot()).resolves.toMatchObject({
      targets: [
        {
          inventory: {
            entries: [{ name: "left-skill" }],
            freshness: "fresh",
          },
          target: { id: target.id },
        },
        {
          inventory: {
            entries: [{ name: "right-skill" }],
            freshness: "fresh",
          },
          target: { id: otherTarget.id },
        },
      ],
    });
  });

  it("advances generation while retaining prior Inventory as explicitly stale evidence", async () => {
    const records = createMemoryRecoveryRecords(
      [
        {
          cliVersion: "1.5.23",
          entries: freshInventory.entries.map((entry) => ({
            agents: [...entry.agents],
            contentFingerprint: { ...entry.contentFingerprint },
            declaredSource: { ...entry.declaredSource },
            name: entry.name,
            revision: { ...entry.revision },
            scope: entry.scope,
          })),
          generation: 1,
          observedAt: freshInventory.observedAt,
          targetId: target.id,
        },
      ],
      [],
      [
        {
          connectionReference: null,
          generation: 1,
          harness: target.harness,
          id: target.id,
          kind: "local",
          label: target.label,
          workspace: target.workspace,
        },
      ],
    );
    const capabilities = createDesktopCapabilities({
      id: () => "unused-id",
      recoveryRecords: records,
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          return { ok: true, value: freshInventory };
        },
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-generation",
        role: "workspace",
        sessionEpoch: "epoch-generation",
      },
      () => undefined,
    );

    await session.request({
      definition: {
        connectionReference: null,
        harness: target.harness,
        kind: "local",
        label: target.label,
        workspace: "/work/skills-desktop-next",
      },
      targetId: target.id,
      type: "target.update",
      version: 1,
    });

    await expect(session.snapshot()).resolves.toMatchObject({
      inventory: {
        entries: [{ name: "tdd" }],
        freshness: "stale",
        lastError: { code: "stale_inventory", phase: "target" },
      },
      target: {
        generation: 2,
        workspace: normalize("/work/skills-desktop-next"),
      },
    });

    const restarted = createDesktopCapabilities({
      id: () => "unused-restart-id",
      recoveryRecords: records,
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          return { ok: true, value: freshInventory };
        },
      }),
    });
    await restarted.initialize();
    const restartedSession = restarted.attach(
      {
        endpointId: "workspace-generation-restart",
        role: "workspace",
        sessionEpoch: "epoch-generation-restart",
      },
      () => undefined,
    );
    await expect(restartedSession.snapshot()).resolves.toMatchObject({
      inventory: {
        entries: [{ name: "tdd" }],
        freshness: "stale",
        lastError: { code: "stale_inventory" },
      },
      target: { generation: 2 },
    });
  });

  it("rejects Target changes while its Inventory observation is active", async () => {
    const otherTarget: TargetDefinition = {
      ...target,
      id: "00000000-0000-4000-8000-000000000004",
      label: "Other Target",
      workspace: "/work/other",
      workspaceLabel: "other",
    };
    let observationStarted!: () => void;
    let releaseObservation!: () => void;
    const started = new Promise<void>((resolve) => {
      observationStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseObservation = resolve;
    });
    const records = createMemoryRecoveryRecords(
      [],
      [],
      [target, otherTarget].map((definition) => ({
        connectionReference: definition.connectionReference ?? null,
        generation: definition.generation,
        harness: definition.harness,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    );
    const capabilities = createDesktopCapabilities({
      id: () => "race-operation",
      recoveryRecords: records,
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          observationStarted();
          await blocked;
          return { ok: true, value: freshInventory };
        },
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-target-race",
        role: "workspace",
        sessionEpoch: "epoch-target-race",
      },
      () => undefined,
    );

    const refresh = session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await started;
    await expect(
      session.request({
        definition: {
          connectionReference: null,
          harness: target.harness,
          kind: target.kind,
          label: target.label,
          workspace: "/work/changed-during-refresh",
        },
        targetId: target.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    await expect(
      session.request({
        targetId: target.id,
        type: "target.delete",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    releaseObservation();
    await expect(refresh).resolves.toMatchObject({ ok: true });
    await expect(session.snapshot()).resolves.toMatchObject({
      inventory: { freshness: "fresh" },
      target: { generation: 1, id: target.id, workspace: target.workspace },
    });
  });

  it("reserves a Target while an execution-relevant update is proposed", async () => {
    let releaseCanonicalization!: () => void;
    let canonicalizationStarted!: () => void;
    const canonicalizationBlocked = new Promise<void>((resolve) => {
      releaseCanonicalization = resolve;
    });
    const started = new Promise<void>((resolve) => {
      canonicalizationStarted = resolve;
    });
    let observations = 0;
    const skillsTargets = createSkillsTargetsCatalog({
      async canonicalizeLocalWorkspace(workspace) {
        canonicalizationStarted();
        await canonicalizationBlocked;
        return workspace;
      },
      id: () => "00000000-0000-4000-8000-000000000018",
      initialTarget: target,
      processFor: () => ({
        ...mutationNotExercised,
        async observeInventory() {
          observations += 1;
          return { ok: true, value: freshInventory };
        },
      }),
    });
    const records = createMemoryRecoveryRecords(
      [],
      [],
      [
        {
          connectionReference: null,
          generation: target.generation,
          harness: target.harness,
          id: target.id,
          kind: target.kind,
          label: target.label,
          workspace: target.workspace,
        },
      ],
    );
    const capabilities = createDesktopCapabilities({
      id: () => "target-change-operation",
      recoveryRecords: records,
      skillsTargets,
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-change-first",
        role: "workspace",
        sessionEpoch: "epoch-change-first",
      },
      () => undefined,
    );

    const update = session.request({
      definition: {
        connectionReference: null,
        harness: target.harness,
        kind: target.kind,
        label: target.label,
        workspace: "/work/changed-first",
      },
      targetId: target.id,
      type: "target.update",
      version: 1,
    });
    await started;
    await expect(
      session.request({
        targetId: target.id,
        type: "inventory.refresh",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    expect(observations).toBe(0);

    releaseCanonicalization();
    await expect(update).resolves.toMatchObject({ ok: true });
    await expect(session.snapshot()).resolves.toMatchObject({
      inventory: { freshness: "none" },
      target: { generation: 2, workspace: normalize("/work/changed-first") },
    });
  });

  it("reserves the Target session and discards preparation after owner teardown", async () => {
    const unrelatedTarget: TargetDefinition = {
      ...target,
      id: "00000000-0000-4000-8000-000000000026",
      label: "Unrelated Target",
      workspace: "/work/unrelated",
      workspaceLabel: "unrelated",
    };
    let releasePreparation!: () => void;
    let preparationStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const started = new Promise<void>((resolve) => {
      preparationStarted = resolve;
    });
    const capabilities = createDesktopCapabilities({
      id: () => "preparation-race-operation",
      recoveryRecords: createMemoryRecoveryRecords(
        [],
        [],
        [target, unrelatedTarget].map((definition) => ({
          connectionReference: null,
          generation: definition.generation,
          harness: definition.harness,
          id: definition.id,
          kind: definition.kind,
          label: definition.label,
          workspace: definition.workspace,
        })),
      ),
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          return { ok: true as const, value: freshInventory };
        },
        async prepareMutation(input) {
          preparationStarted();
          await blocked;
          return {
            ok: true as const,
            value: {
              commandPlan: {
                harness: target.harness,
                names: ["tdd"],
                operation: "remove" as const,
                preview: "review-only preview",
                schemaVersion: 1 as const,
                scope: "project" as const,
                source: null,
                targetId: target.id,
                timeoutMs: 30_000,
              },
              digest: "a".repeat(64),
              expiresAt: "2099-01-01T00:10:00.000Z",
              id: "prepared-during-race",
              inventoryId: input.inventoryId,
              targetGeneration: target.generation,
              targetId: target.id,
            },
          };
        },
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-preparation-race",
        role: "workspace",
        sessionEpoch: "epoch-preparation-race",
      },
      () => undefined,
    );
    await session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    const preparation = session.request({
      intent: { names: ["tdd"], scope: "project", type: "remove" },
      targetId: target.id,
      type: "mutation.prepare",
      version: 1,
    });
    await started;
    await expect(
      session.request({
        definition: {
          connectionReference: null,
          harness: target.harness,
          kind: target.kind,
          label: target.label,
          workspace: "/work/changed-during-preparation",
        },
        targetId: target.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    await expect(
      session.request({
        targetId: target.id,
        type: "target.delete",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    await expect(
      session.request({
        definition: {
          connectionReference: null,
          harness: unrelatedTarget.harness,
          kind: unrelatedTarget.kind,
          label: "Renamed unrelated Target",
          workspace: unrelatedTarget.workspace,
        },
        targetId: unrelatedTarget.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      session.request({
        targetId: unrelatedTarget.id,
        type: "target.delete",
        version: 1,
      }),
    ).resolves.toMatchObject({ ok: true });

    session.teardown();
    releasePreparation();
    await expect(preparation).resolves.toMatchObject({
      error: { code: "cancelled", phase: "prepare" },
      ok: false,
    });
    const replacementSession = capabilities.attach(
      {
        endpointId: "workspace-after-preparation-race",
        role: "workspace",
        sessionEpoch: "epoch-after-preparation-race",
      },
      () => undefined,
    );
    await expect(replacementSession.snapshot()).resolves.toMatchObject({
      mutation: { commandPlan: null, phase: "idle" },
      target: { generation: 1, workspace: target.workspace },
    });
  });

  it("blocks edit and deletion for a guarded Target", async () => {
    const guardedTarget = {
      ...target,
      id: "00000000-0000-4000-8000-000000000005",
      workspace: "/work/guarded",
      workspaceLabel: "guarded",
    };
    const records = createMemoryRecoveryRecords(
      [],
      [
        {
          deadline: "2026-08-21T10:10:00.000Z",
          effects: "possible",
          generation: 1,
          operationId: "guarded-operation",
          phase: "reconciliation-required",
          targetId: guardedTarget.id,
        },
      ],
      [target, guardedTarget].map((definition) => ({
        connectionReference: null,
        generation: definition.generation,
        harness: definition.harness,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    );
    const capabilities = createDesktopCapabilities({
      id: () => "unused-id",
      recoveryRecords: records,
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          return { ok: true, value: freshInventory };
        },
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-guarded-target",
        role: "workspace",
        sessionEpoch: "epoch-guarded-target",
      },
      () => undefined,
    );

    await expect(
      session.request({
        targetId: guardedTarget.id,
        type: "target.delete",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "reconciliation_required" },
      ok: false,
    });
    await expect(
      session.request({
        definition: {
          connectionReference: null,
          harness: "Codex",
          kind: "local",
          label: "Changed label",
          workspace: guardedTarget.workspace,
        },
        targetId: guardedTarget.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "reconciliation_required" },
      ok: false,
    });
    await expect(session.snapshot()).resolves.toMatchObject({
      targets: [
        { target: { id: target.id } },
        { deletionBlocked: true, target: { id: guardedTarget.id } },
      ],
    });
  });

  it("reattaches a retained legacy Guard when its Target is created", async () => {
    const legacyTargetId = "local-codex-fedcba9876543210fedcba98";
    const createdTargetId = "00000000-0000-4000-8000-000000000027";
    const legacyWorkspace = "/work/legacy-retained";
    const records = createMemoryRecoveryRecords(
      [
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: 1,
          observedAt: "2026-08-20T08:00:00.000Z",
          targetId: legacyTargetId,
        },
      ],
      [
        {
          deadline: "2026-08-20T08:10:00.000Z",
          effects: "possible",
          generation: 1,
          operationId: "retained-legacy-guard",
          phase: "reconciliation-required",
          targetId: legacyTargetId,
        },
      ],
      [
        {
          connectionReference: null,
          generation: target.generation,
          harness: target.harness,
          id: target.id,
          kind: target.kind,
          label: target.label,
          workspace: target.workspace,
        },
      ],
    );
    const capabilities = createDesktopCapabilities({
      id: () => "same-session-legacy-operation",
      recoveryRecords: records,
      skillsTargets: createSkillsTargetsCatalog({
        id: () => createdTargetId,
        initialTarget: target,
        legacyIdFor(definition) {
          return definition.workspace === normalize(legacyWorkspace)
            ? legacyTargetId
            : undefined;
        },
        processFor: () => ({
          ...mutationNotExercised,
          async observeInventory() {
            return { ok: true as const, value: freshInventory };
          },
        }),
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-retained-legacy",
        role: "workspace",
        sessionEpoch: "epoch-retained-legacy",
      },
      () => undefined,
    );

    await expect(
      session.request({
        definition: {
          connectionReference: null,
          harness: "Codex",
          kind: "local",
          label: "Recovered workspace",
          workspace: legacyWorkspace,
        },
        type: "target.create",
        version: 1,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { operationId: createdTargetId },
    });
    await expect(records.restore()).resolves.toMatchObject({
      inventorySnapshots: [{ targetId: createdTargetId }],
      mutationGuards: [{ targetId: createdTargetId }],
    });
    await expect(session.snapshot()).resolves.toMatchObject({
      targets: [
        { target: { id: target.id } },
        {
          deletionBlocked: true,
          inventory: { freshness: "stale" },
          mutation: { phase: "reconciliation-required" },
          target: { id: createdTargetId },
        },
      ],
    });
    await session.request({
      targetId: createdTargetId,
      type: "inventory.refresh",
      version: 1,
    });
    await expect(
      session.request({
        intent: { names: ["tdd"], scope: "project", type: "remove" },
        targetId: createdTargetId,
        type: "mutation.prepare",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "reconciliation_required" },
      ok: false,
    });
  });

  it("reattaches retained legacy recovery on retarget without replacing current evidence", async () => {
    const legacyTargetId = "local-codex-abcdef0123456789abcdef01";
    const legacyWorkspace = "/work/legacy-retarget";
    const currentObservedAt = "2026-08-21T11:00:00.000Z";
    const records = createMemoryRecoveryRecords(
      [
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: target.generation,
          observedAt: currentObservedAt,
          targetId: target.id,
        },
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: 1,
          observedAt: "2026-08-20T11:00:00.000Z",
          targetId: legacyTargetId,
        },
      ],
      [
        {
          deadline: "2026-08-20T11:10:00.000Z",
          effects: "possible",
          generation: 1,
          operationId: "retained-retarget-guard",
          phase: "reconciliation-required",
          targetId: legacyTargetId,
        },
      ],
      [
        {
          connectionReference: null,
          generation: target.generation,
          harness: target.harness,
          id: target.id,
          kind: target.kind,
          label: target.label,
          workspace: target.workspace,
        },
      ],
    );
    const capabilities = createDesktopCapabilities({
      id: () => "same-session-retarget-operation",
      recoveryRecords: records,
      skillsTargets: createSkillsTargetsCatalog({
        id: () => "unused-target-id",
        initialTarget: target,
        legacyIdFor(definition) {
          return definition.workspace === normalize(legacyWorkspace)
            ? legacyTargetId
            : undefined;
        },
        processFor: () => ({
          ...mutationNotExercised,
          async observeInventory() {
            return { ok: true as const, value: freshInventory };
          },
        }),
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-retained-retarget",
        role: "workspace",
        sessionEpoch: "epoch-retained-retarget",
      },
      () => undefined,
    );

    await expect(
      session.request({
        definition: {
          connectionReference: null,
          harness: target.harness,
          kind: target.kind,
          label: "Retargeted workspace",
          workspace: legacyWorkspace,
        },
        targetId: target.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { operationId: target.id },
    });
    await expect(records.restore()).resolves.toMatchObject({
      inventorySnapshots: [
        { observedAt: currentObservedAt, targetId: target.id },
      ],
      mutationGuards: [{ targetId: target.id }],
    });
    await expect(session.snapshot()).resolves.toMatchObject({
      inventory: {
        freshness: "stale",
        observedAt: currentObservedAt,
      },
      mutation: { phase: "reconciliation-required" },
      target: { generation: target.generation + 1, id: target.id },
      targets: [{ deletionBlocked: true, target: { id: target.id } }],
    });
  });

  it("does not open a fallback Target when durable Target authority is unreadable", async () => {
    let openCalls = 0;
    const capabilities = createDesktopCapabilities({
      id: () => "unused-id",
      recoveryRecords: {
        async commit() {
          throw new Error("Target store must remain blocked.");
        },
        async restore() {
          return {
            failures: [
              {
                code: "corrupt_store" as const,
                store: "targetDefinitions" as const,
              },
            ],
            hostTrustRecords: [],
            inventorySnapshots: [],
            mutationGuards: [],
            targetDefinitions: [],
          };
        },
      },
      skillsTargets: createSkillsTargetsCatalog({
        id: () => "00000000-0000-4000-8000-000000000012",
        initialTarget: target,
        processFor() {
          openCalls += 1;
          return {
            ...mutationNotExercised,
            async observeInventory() {
              return { ok: true as const, value: freshInventory };
            },
          };
        },
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-unreadable-targets",
        role: "workspace",
        sessionEpoch: "epoch-unreadable-targets",
      },
      () => undefined,
    );

    await expect(
      session.request({
        targetId: target.id,
        type: "inventory.refresh",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "target_unavailable", phase: "restore" },
      ok: false,
    });
    expect(openCalls).toBe(0);
  });

  it("compares selected Fresh or Stale inventories without opening a Target", async () => {
    const otherTarget: TargetDefinition = {
      ...target,
      harness: "Claude",
      id: "00000000-0000-4000-8000-000000000006",
      label: "Comparison right",
      workspace: "/work/right",
      workspaceLabel: "right",
    };
    const evidence = (value: string) => ({
      authority: "npx-skills",
      kind: "git-commit",
      status: "known" as const,
      value,
    });
    const entry = (
      name: string,
      source: string | null,
      revision: ReturnType<typeof evidence> | { readonly status: "unknown" },
      scope: "global" | "project" = "project",
    ) => ({
      agents: ["Codex"],
      contentFingerprint:
        revision.status === "known"
          ? {
              ...revision,
              kind: "sha256",
              value: `fingerprint-${revision.value}`,
            }
          : revision,
      declaredSource: {
        source,
        sourceType: source === null ? null : "github",
      },
      name,
      revision,
      scope,
    });
    const leftEntries = [
      entry("missing", "example/source", evidence("one")),
      entry("source", "example/left", evidence("one")),
      {
        ...entry("drift", "example/source", evidence("one")),
        contentFingerprint: {
          ...evidence("same-content"),
          kind: "sha256",
        },
      },
      {
        ...entry("fingerprint", "example/source", evidence("same")),
        contentFingerprint: {
          ...evidence("left-content"),
          kind: "sha256",
        },
      },
      entry("mixed-drift", "example/source", evidence("left")),
      entry("mixed-drift", null, { status: "unknown" }, "global"),
      entry("mixed-source", "example/left", evidence("same")),
      entry("mixed-source", null, { status: "unknown" }, "global"),
      entry("unequal-drift", "example/source", evidence("left")),
      entry("unequal-drift", "example/source", { status: "unknown" }, "global"),
      entry("unequal-source", "example/left", evidence("same")),
      entry("unequal-source", null, { status: "unknown" }, "global"),
      entry("unknown", "example/source", { status: "unknown" }),
      entry("matched", "example/source", evidence("same")),
      {
        ...entry(
          "scope-independent",
          "example/source",
          evidence("same"),
          "project",
        ),
        agents: [],
      },
    ];
    const rightEntries = [
      entry("source", "example/right", evidence("one")),
      {
        ...entry("drift", "example/source", evidence("two")),
        contentFingerprint: {
          ...evidence("same-content"),
          kind: "sha256",
        },
      },
      {
        ...entry("fingerprint", "example/source", evidence("same")),
        contentFingerprint: {
          ...evidence("right-content"),
          kind: "sha256",
        },
      },
      entry("mixed-drift", "example/source", evidence("right")),
      entry("mixed-drift", null, { status: "unknown" }, "global"),
      entry("mixed-source", "example/right", evidence("same")),
      entry("mixed-source", null, { status: "unknown" }, "global"),
      entry("unequal-drift", "example/source", evidence("right-b")),
      entry("unequal-drift", "example/source", evidence("right-c"), "global"),
      entry("unequal-source", "example/right-b", evidence("same")),
      entry("unequal-source", "example/right-c", evidence("same"), "global"),
      entry("unknown", "example/source", { status: "unknown" }),
      entry("matched", "example/source", evidence("same")),
      entry("scope-independent", "example/source", evidence("same"), "global"),
    ];
    const records = createMemoryRecoveryRecords(
      [
        {
          cliVersion: "1.5.23",
          entries: leftEntries,
          generation: 1,
          observedAt: "2026-08-21T10:00:00.000Z",
          targetId: target.id,
        },
        {
          cliVersion: "1.5.23",
          entries: rightEntries,
          generation: 1,
          observedAt: "2026-08-21T10:01:00.000Z",
          targetId: otherTarget.id,
        },
      ],
      [],
      [target, otherTarget].map((definition) => ({
        connectionReference: null,
        generation: definition.generation,
        harness: definition.harness,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    );
    let openCalls = 0;
    const capabilities = createDesktopCapabilities({
      id: () => "comparison-1",
      recoveryRecords: records,
      skillsTargets: createSkillsTargetsCatalog({
        id: () => "00000000-0000-4000-8000-000000000013",
        initialTarget: target,
        processFor() {
          openCalls += 1;
          return {
            ...mutationNotExercised,
            async observeInventory() {
              return { ok: true as const, value: freshInventory };
            },
          };
        },
      }),
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-comparison",
        role: "workspace",
        sessionEpoch: "epoch-comparison",
      },
      () => undefined,
    );

    await expect(
      session.request({
        leftTargetId: target.id,
        rightTargetId: otherTarget.id,
        type: "comparison.open",
        version: 1,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { operationId: "comparison-1" },
    });
    expect(openCalls).toBe(0);
    await expect(session.snapshot()).resolves.toMatchObject({
      comparison: {
        leftFreshness: "stale",
        leftTargetId: target.id,
        rightFreshness: "stale",
        rightTargetId: otherTarget.id,
        rows: [
          {
            dimensions: {
              contentFingerprint: "matched",
              revision: "drift",
            },
            key: "drift",
            summary: "version-drift",
          },
          {
            dimensions: {
              contentFingerprint: "drift",
              declaredSource: "matched",
              presence: "both",
              revision: "matched",
            },
            key: "fingerprint",
            summary: "version-drift",
          },
          { key: "matched", summary: "matched" },
          {
            dimensions: { presence: "left-only" },
            key: "missing",
            summary: "missing",
          },
          {
            dimensions: { revision: "drift" },
            key: "mixed-drift",
            summary: "version-drift",
          },
          {
            dimensions: { declaredSource: "mismatch" },
            key: "mixed-source",
            summary: "source-mismatch",
          },
          {
            dimensions: {
              contentFingerprint: "matched",
              declaredSource: "matched",
              presence: "both",
              revision: "matched",
            },
            key: "scope-independent",
            left: { freshness: "stale", harnessAvailability: "available" },
            right: {
              freshness: "stale",
              harnessAvailability: "unavailable",
            },
            summary: "matched",
          },
          {
            dimensions: { declaredSource: "mismatch" },
            key: "source",
            summary: "source-mismatch",
          },
          {
            dimensions: { revision: "drift" },
            key: "unequal-drift",
            summary: "version-drift",
          },
          {
            dimensions: { declaredSource: "mismatch" },
            key: "unequal-source",
            summary: "source-mismatch",
          },
          {
            dimensions: {
              contentFingerprint: "unknown",
              revision: "unknown",
            },
            key: "unknown",
            summary: "unknown-evidence",
          },
        ],
      },
    });
    await expect(
      session.request({
        comparisonId: "comparison-1",
        destinationTargetId: otherTarget.id,
        rowKey: "missing",
        type: "comparison.prepare",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "stale_inventory" },
      ok: false,
    });
    expect(openCalls).toBe(0);
  });

  it("prepares an exact eligible destination intent from Fresh comparison evidence", async () => {
    let releasePreparation!: () => void;
    let preparationStarted!: () => void;
    const preparationBlocked = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const started = new Promise<void>((resolve) => {
      preparationStarted = resolve;
    });
    let releaseShutdownPreparation!: () => void;
    let shutdownPreparationStarted!: () => void;
    const shutdownPreparationBlocked = new Promise<void>((resolve) => {
      releaseShutdownPreparation = resolve;
    });
    const shutdownStarted = new Promise<void>((resolve) => {
      shutdownPreparationStarted = resolve;
    });
    const destination: TargetDefinition = {
      ...target,
      id: "00000000-0000-4000-8000-000000000007",
      label: "Destination",
      workspace: "/work/destination",
      workspaceLabel: "destination",
    };
    const definitions = [target, destination];
    const sourceInventory: Inventory = {
      ...freshInventory,
      entries: [{ ...freshInventory.entries[0]!, name: "copy-me" }],
    };
    const destinationInventory: Inventory = {
      ...freshInventory,
      entries: [],
    };
    const preparedInputs: unknown[] = [];
    let preparationCalls = 0;
    const skillsTargets = createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000014",
      initialTarget: target,
      processFor(binding) {
        const selected = definitions.find(({ id }) => id === binding.targetId)!;
        return {
          ...mutationNotExercised,
          async observeInventory() {
            return {
              ok: true as const,
              value:
                selected.id === destination.id
                  ? destinationInventory
                  : sourceInventory,
            };
          },
          async prepareMutation(input) {
            preparedInputs.push(input);
            preparationCalls += 1;
            if (preparationCalls === 1) {
              preparationStarted();
              await preparationBlocked;
            } else {
              shutdownPreparationStarted();
              await shutdownPreparationBlocked;
            }
            return {
              ok: true as const,
              value: {
                commandPlan: {
                  harness: selected.harness,
                  names:
                    preparationCalls === 1 ? ["copy-me"] : ["must-not-publish"],
                  operation: "add" as const,
                  preview: "review-only preview",
                  schemaVersion: 1 as const,
                  scope: "project" as const,
                  source: {
                    source: "example/skills",
                    sourceType: "github" as const,
                  },
                  targetId: selected.id,
                  timeoutMs: 30_000,
                },
                digest: "a".repeat(64),
                expiresAt: "2099-01-01T00:10:00.000Z",
                id:
                  preparationCalls === 1
                    ? "prepared-from-comparison"
                    : "discarded-during-shutdown",
                inventoryId: input.inventoryId,
                targetGeneration: selected.generation,
                targetId: selected.id,
              },
            };
          },
        };
      },
    });
    const records = createMemoryRecoveryRecords(
      [],
      [],
      definitions.map((definition) => ({
        connectionReference: null,
        generation: definition.generation,
        harness: definition.harness,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    );
    let nextId = 0;
    const capabilities = createDesktopCapabilities({
      id: () => `comparison-operation-${++nextId}`,
      recoveryRecords: records,
      skillsTargets,
    });
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-comparison-prepare",
        role: "workspace",
        sessionEpoch: "epoch-comparison-prepare",
      },
      () => undefined,
    );
    await session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await session.request({
      targetId: destination.id,
      type: "inventory.refresh",
      version: 1,
    });
    const openedComparison = await session.request({
      leftTargetId: target.id,
      rightTargetId: destination.id,
      type: "comparison.open",
      version: 1,
    });
    expect(openedComparison.ok).toBe(true);
    const comparisonId = openedComparison.ok
      ? openedComparison.value.operationId
      : "unavailable";
    await expect(session.snapshot()).resolves.toMatchObject({
      comparison: {
        leftFreshness: "fresh",
        rightFreshness: "fresh",
        rows: [
          {
            dimensions: { presence: "left-only" },
            key: "copy-me",
            summary: "missing",
          },
        ],
      },
    });

    const preparation = session.request({
      comparisonId,
      destinationTargetId: destination.id,
      rowKey: "copy-me",
      type: "comparison.prepare",
      version: 1,
    });
    await started;
    await expect(
      session.request({
        definition: {
          connectionReference: null,
          harness: target.harness,
          kind: target.kind,
          label: target.label,
          workspace: "/work/source-changed-during-comparison-preparation",
        },
        targetId: target.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    await expect(
      session.request({
        targetId: target.id,
        type: "target.delete",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    await expect(
      session.request({
        targetId: target.id,
        type: "inventory.refresh",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    await expect(
      session.request({
        definition: {
          connectionReference: null,
          harness: destination.harness,
          kind: destination.kind,
          label: destination.label,
          workspace: "/work/changed-during-comparison-preparation",
        },
        targetId: destination.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    await expect(
      session.request({
        targetId: destination.id,
        type: "target.delete",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    releasePreparation();
    await expect(preparation).resolves.toEqual({
      ok: true,
      value: { operationId: "prepared-from-comparison" },
    });
    expect(preparedInputs).toMatchObject([
      {
        freshness: "fresh",
        intent: {
          names: ["copy-me"],
          scope: "project",
          source: { source: "example/skills", sourceType: "github" },
          type: "add",
        },
      },
    ]);
    await expect(session.snapshot()).resolves.toMatchObject({
      targets: [
        { target: { id: target.id } },
        {
          mutation: {
            commandPlan: { names: ["copy-me"], operation: "add" },
            phase: "planned",
          },
          target: { id: destination.id },
        },
      ],
    });

    const openedReview = await session.request({
      preparedMutationId: "prepared-from-comparison",
      type: "review.request",
      version: 1,
    });
    expect(openedReview).toEqual({
      ok: true,
      value: { operationId: expect.any(String) },
    });
    const reviewId = openedReview.ok
      ? openedReview.value.operationId
      : "unavailable";
    const review = capabilities.attach(
      {
        endpointId: "review-comparison-dependency",
        reviewId,
        role: "review",
        sessionEpoch: "epoch-comparison-dependency",
      },
      () => undefined,
    );
    await expect(review.snapshot()).resolves.toMatchObject({
      status: "pending",
    });
    await expect(
      session.request({
        definition: {
          connectionReference: null,
          harness: target.harness,
          kind: target.kind,
          label: target.label,
          workspace: "/work/source-changed-after-comparison-preparation",
        },
        targetId: target.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(review.snapshot()).resolves.toEqual({
      decision: "reject",
      schemaVersion: 1,
      status: "settled",
    });
    await expect(session.snapshot()).resolves.toMatchObject({
      comparison: { leftFreshness: "stale" },
      mutation: { commandPlan: null, phase: "idle" },
      target: { id: destination.id },
    });
    await session.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    const discardedPreparation = session.request({
      comparisonId,
      destinationTargetId: destination.id,
      rowKey: "copy-me",
      type: "comparison.prepare",
      version: 1,
    });
    await shutdownStarted;
    let shutdownSettled = false;
    const shutdown = capabilities.shutdown().then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    releaseShutdownPreparation();
    await expect(discardedPreparation).resolves.toMatchObject({
      error: { code: "cancelled", phase: "prepare" },
      ok: false,
    });
    await shutdown;
    await expect(session.snapshot()).resolves.toMatchObject({
      mutation: {
        commandPlan: null,
        phase: "idle",
      },
    });
  });
});

describe("DesktopCapabilities SSH host-trust role-session contract", () => {
  it("requires isolated reviewed trust before publishing a remote Inventory", async () => {
    const sshTarget: TargetDefinition = {
      connectionReference: "build-host",
      executionBindingDigest: null,
      generation: 1,
      harness: "Codex",
      id: "00000000-0000-4000-8000-000000000018",
      kind: "ssh",
      label: "Build host",
      workspace: "/srv/skills",
      workspaceLabel: "skills",
    };
    let trusted = false;
    let durableGeneration = 0;
    const access: OpenSshTargetAccess = {
      async confirm(challengeId, reviewedTarget) {
        expect(challengeId).toBe("challenge-1");
        expect(reviewedTarget.generation).toBe(2);
        expect(durableGeneration).toBe(3);
        trusted = true;
        return {
          ok: true,
          value: { bindingDigest: "a".repeat(64), kind: "first-use" },
        };
      },
      async inspect(reviewedTarget) {
        if (trusted) {
          return {
            ok: true,
            value: {
              binding: {
                bindingDigest: "a".repeat(64),
                connectionReference: "build-host",
                connectionConfig:
                  "Host build-host\n  HostName resolved.internal\n",
                hostKey: { algorithm: "ssh-ed25519", key: "AQIDBA==" },
                hostKeyIdentity: "[resolved.internal]:2222",
                hostname: "resolved.internal",
                port: 2222,
                trustStorePath: "/application/known_hosts",
                user: "deploy",
                wireDialect: {
                  bootstrapDigest: "b".repeat(64),
                  protocolVersion: 2,
                },
              },
              bindingDigest: "a".repeat(64),
              status: "ready",
            },
          };
        }
        return {
          ok: true,
          value: {
            bindingDigest: "a".repeat(64),
            challenge: {
              algorithm: "ssh-ed25519",
              expiresAt: "2026-08-22T10:05:00.000Z",
              fingerprint: "SHA256:reviewed-fingerprint",
              id: "challenge-1",
              identity: "deploy@resolved.internal:2222",
              kind: "first-use",
              targetGeneration: reviewedTarget.generation,
              targetId: reviewedTarget.id,
            },
            status: "trust-required",
          },
        };
      },
      pendingChallenge(reviewedTargetId) {
        return trusted || reviewedTargetId !== sshTarget.id
          ? undefined
          : {
              algorithm: "ssh-ed25519",
              expiresAt: "2026-08-22T10:05:00.000Z",
              fingerprint: "SHA256:reviewed-fingerprint",
              id: "challenge-1",
              identity: "deploy@resolved.internal:2222",
              kind: "first-use",
              targetGeneration: 2,
              targetId: sshTarget.id,
            };
      },
    };
    const process: SkillsProcess = {
      ...mutationNotExercised,
      async observeInventory() {
        return { ok: true, value: freshInventory };
      },
    };
    const targets = createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: sshTarget,
      processFor: () => process,
      sshAccess: access,
    });
    const presented: string[] = [];
    let sequence = 0;
    const memoryRecords = createMemoryRecoveryRecords();
    const capabilities = createDesktopCapabilities({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => `operation-${++sequence}`,
      onReviewRequested: (reviewId) => presented.push(reviewId),
      recoveryRecords: {
        async commit(record) {
          const committed = await memoryRecords.commit(record);
          if (committed.ok && record.type === "targets.replace") {
            durableGeneration = Math.max(
              ...record.targets.map(({ generation }) => generation),
            );
          }
          return committed;
        },
        restore: () => memoryRecords.restore(),
      },
      skillsTargets: targets,
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-ssh-trust",
        role: "workspace",
        sessionEpoch: "workspace-epoch",
      },
      () => undefined,
    );

    await expect(
      workspace.request({
        targetId: sshTarget.id,
        type: "inventory.refresh",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "host_trust_required" },
      ok: false,
    });
    await expect(workspace.snapshot()).resolves.toMatchObject({
      inventory: {
        freshness: "none",
        lastError: { code: "host_trust_required" },
        phase: "error",
      },
      target: { generation: 2 },
    });

    const reviewRequested = await workspace.request({
      targetId: sshTarget.id,
      type: "host-trust.review",
      version: 1,
    });
    expect(reviewRequested).toMatchObject({ ok: true });
    if (!reviewRequested.ok) throw new Error();
    expect(presented).toEqual([reviewRequested.value.operationId]);
    const review = capabilities.attach(
      {
        endpointId: "review-ssh-trust",
        reviewId: reviewRequested.value.operationId,
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );
    await expect(review.snapshot()).resolves.toMatchObject({
      projection: {
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:reviewed-fingerprint",
        identity: "deploy@resolved.internal:2222",
        trustAction: "first-use",
      },
      status: "pending",
    });
    await expect(
      review.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(workspace.snapshot()).resolves.toMatchObject({
      target: { generation: 3 },
    });

    await expect(
      workspace.request({
        targetId: sshTarget.id,
        type: "inventory.refresh",
        version: 1,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(workspace.snapshot()).resolves.toMatchObject({
      inventory: {
        entries: [{ name: "tdd" }],
        freshness: "fresh",
        phase: "ready",
      },
    });
  });

  it("rejects an expired host-trust approval without persistence or trust writes", async () => {
    const fixture = await createHostTrustRoleFixture();
    fixture.setNow(fixture.challenge.expiresAt);

    await expect(fixture.approve()).resolves.toMatchObject({
      error: { code: "host_trust_invalid" },
      ok: false,
    });
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.commitHostTrust).not.toHaveBeenCalled();
    expect(fixture.replaceDefinitions).not.toHaveBeenCalled();
  });

  it("rejects a drifted Target generation without persistence or trust writes", async () => {
    const fixture = await createHostTrustRoleFixture();
    fixture.skillsTargets.replaceDefinitions([
      { ...roleSshTarget, generation: roleSshTarget.generation + 1 },
    ]);
    fixture.replaceDefinitions.mockClear();

    await expect(fixture.approve()).resolves.toMatchObject({
      error: { code: "host_trust_invalid" },
      ok: false,
    });
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.commitHostTrust).not.toHaveBeenCalled();
    expect(fixture.replaceDefinitions).not.toHaveBeenCalled();
  });

  it("stops before the trust write and generation transition when persistence fails", async () => {
    const fixture = await createHostTrustRoleFixture({
      async commit() {
        return {
          error: {
            code: "persist_failed",
            effects: "none",
            message: "Target authority could not be persisted.",
            phase: "persist",
            retryable: true,
          },
          ok: false,
        };
      },
    });

    await expect(fixture.approve()).resolves.toMatchObject({
      error: { code: "persist_failed" },
      ok: false,
    });
    expect(fixture.commit).toHaveBeenCalledTimes(1);
    expect(fixture.commitHostTrust).not.toHaveBeenCalled();
    expect(fixture.replaceDefinitions).not.toHaveBeenCalled();
  });

  it("serializes concurrent host-trust approvals", async () => {
    let releaseCommit!: () => void;
    let commitStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const started = new Promise<void>((resolve) => {
      commitStarted = resolve;
    });
    const fixture = await createHostTrustRoleFixture({
      async commit() {
        commitStarted();
        await blocked;
        return { ok: true, value: undefined };
      },
    });
    const competingReview = fixture.capabilities.attach(
      {
        endpointId: "competing-host-trust-review",
        reviewId: "host-trust-review",
        role: "review",
        sessionEpoch: "competing-review-epoch",
      },
      () => undefined,
    );

    const first = fixture.approve();
    await started;
    await expect(
      competingReview.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict" },
      ok: false,
    });
    expect(fixture.commitHostTrust).not.toHaveBeenCalled();

    releaseCommit();
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(fixture.commitHostTrust).toHaveBeenCalledTimes(1);
    expect(fixture.replaceDefinitions).toHaveBeenCalledTimes(1);
  });

  it("rejects replay after one host-trust approval", async () => {
    const fixture = await createHostTrustRoleFixture();

    await expect(fixture.approve()).resolves.toMatchObject({ ok: true });
    await expect(fixture.approve()).resolves.toMatchObject({
      error: { code: "unauthorized" },
      ok: false,
    });
    expect(fixture.commit).toHaveBeenCalledTimes(1);
    expect(fixture.commitHostTrust).toHaveBeenCalledTimes(1);
    expect(fixture.replaceDefinitions).toHaveBeenCalledTimes(1);
  });

  it("settles a torn-down host-trust review as rejected", async () => {
    const fixture = await createHostTrustRoleFixture();
    fixture.review.teardown();

    await expect(fixture.approve()).resolves.toMatchObject({
      error: { code: "unauthorized" },
      ok: false,
    });
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.commitHostTrust).not.toHaveBeenCalled();
    expect(fixture.replaceDefinitions).not.toHaveBeenCalled();
  });
});

describe("DesktopCapabilities mutation role-session contract", () => {
  it("keeps review approval pending while a Target update is reserved", async () => {
    let releaseCanonicalization!: () => void;
    let canonicalizationStarted!: () => void;
    const canonicalizationBlocked = new Promise<void>((resolve) => {
      releaseCanonicalization = resolve;
    });
    const started = new Promise<void>((resolve) => {
      canonicalizationStarted = resolve;
    });
    let executions = 0;
    let presentedReviewId: string | undefined;
    const skillsTargets = createSkillsTargetsCatalog({
      async canonicalizeLocalWorkspace(workspace) {
        canonicalizationStarted();
        await canonicalizationBlocked;
        return workspace;
      },
      id: () => "00000000-0000-4000-8000-000000000025",
      initialTarget: target,
      processFor: () => ({
        async executeConfirmed(input) {
          executions += 1;
          return mutationNotExercised.executeConfirmed(input);
        },
        async observeInventory() {
          return { ok: true as const, value: freshInventory };
        },
        async prepareMutation(input) {
          return {
            ok: true as const,
            value: {
              commandPlan: {
                harness: target.harness,
                names: ["tdd"],
                operation: "remove" as const,
                preview: "review-only preview",
                schemaVersion: 1 as const,
                scope: "project" as const,
                source: null,
                targetId: target.id,
                timeoutMs: 30_000,
              },
              digest: "a".repeat(64),
              expiresAt: "2099-01-01T00:10:00.000Z",
              id: "prepared-before-target-change",
              inventoryId: input.inventoryId,
              targetGeneration: target.generation,
              targetId: target.id,
            },
          };
        },
      }),
    });
    const ids = [
      "refresh-review-race",
      "inventory-review-race",
      "review-target-change",
    ];
    const capabilities = createDesktopCapabilities({
      id: () => ids.shift() ?? "unexpected-review-race-id",
      onReviewRequested(reviewId) {
        presentedReviewId = reviewId;
      },
      recoveryRecords: createMemoryRecoveryRecords(
        [],
        [],
        [
          {
            connectionReference: null,
            generation: target.generation,
            harness: target.harness,
            id: target.id,
            kind: target.kind,
            label: target.label,
            workspace: target.workspace,
          },
        ],
      ),
      skillsTargets,
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-review-target-change",
        role: "workspace",
        sessionEpoch: "epoch-review-target-change",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await workspace.request({
      intent: { names: ["tdd"], scope: "project", type: "remove" },
      targetId: target.id,
      type: "mutation.prepare",
      version: 1,
    });
    await workspace.request({
      preparedMutationId: "prepared-before-target-change",
      type: "review.request",
      version: 1,
    });
    expect(presentedReviewId).toBe("review-target-change");
    const review = capabilities.attach(
      {
        endpointId: "review-target-change",
        reviewId: presentedReviewId,
        role: "review",
        sessionEpoch: "review-target-change-epoch",
      },
      () => undefined,
    );

    const update = workspace.request({
      definition: {
        connectionReference: null,
        harness: target.harness,
        kind: target.kind,
        label: target.label,
        workspace: "/work/changed-before-approval",
      },
      targetId: target.id,
      type: "target.update",
      version: 1,
    });
    await started;
    await expect(
      review.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    await expect(review.snapshot()).resolves.toMatchObject({
      status: "pending",
    });
    expect(executions).toBe(0);

    releaseCanonicalization();
    await expect(update).resolves.toMatchObject({ ok: true });
    await expect(review.snapshot()).resolves.toEqual({
      decision: "reject",
      schemaVersion: 1,
      status: "settled",
    });
    expect(executions).toBe(0);
  });

  it("keeps Target A review pending while Target B preparation is active", async () => {
    let releasePreparation!: () => void;
    let preparationStarted!: () => void;
    const preparationBlocked = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const started = new Promise<void>((resolve) => {
      preparationStarted = resolve;
    });
    const otherTarget: TargetDefinition = {
      ...target,
      id: "00000000-0000-4000-8000-000000000008",
      label: "Independent Target",
      workspace: "/work/independent",
      workspaceLabel: "independent",
    };
    const definitions = [target, otherTarget];
    const skillsTargets = createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000015",
      initialTarget: target,
      processFor(binding) {
        const selected = definitions.find(({ id }) => id === binding.targetId)!;
        return {
          ...mutationNotExercised,
          async observeInventory() {
            return { ok: true as const, value: freshInventory };
          },
          async prepareMutation(input) {
            if (selected.id === otherTarget.id) {
              preparationStarted();
              await preparationBlocked;
            }
            return {
              ok: true as const,
              value: {
                commandPlan: {
                  harness: selected.harness,
                  names: ["tdd"],
                  operation: "remove" as const,
                  preview: "review-only preview",
                  schemaVersion: 1 as const,
                  scope: "project" as const,
                  source: null,
                  targetId: selected.id,
                  timeoutMs: 30_000,
                },
                digest: "a".repeat(64),
                expiresAt: "2099-01-01T00:10:00.000Z",
                id:
                  selected.id === target.id
                    ? "prepared-target-a"
                    : "prepared-target-b",
                inventoryId: input.inventoryId,
                targetGeneration: selected.generation,
                targetId: selected.id,
              },
            };
          },
        };
      },
    });
    const records = createMemoryRecoveryRecords(
      [],
      [],
      definitions.map((definition) => ({
        connectionReference: null,
        generation: definition.generation,
        harness: definition.harness,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    );
    let nextId = 0;
    let reviewId: string | undefined;
    const capabilities = createDesktopCapabilities({
      id: () => `independent-operation-${++nextId}`,
      onReviewRequested(id) {
        reviewId = id;
      },
      recoveryRecords: records,
      skillsTargets,
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-independent-reviews",
        role: "workspace",
        sessionEpoch: "epoch-independent-reviews",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await workspace.request({
      intent: { names: ["tdd"], scope: "project", type: "remove" },
      targetId: target.id,
      type: "mutation.prepare",
      version: 1,
    });
    await workspace.request({
      preparedMutationId: "prepared-target-a",
      type: "review.request",
      version: 1,
    });
    expect(reviewId).toBeDefined();

    await workspace.request({
      targetId: otherTarget.id,
      type: "inventory.refresh",
      version: 1,
    });
    const review = capabilities.attach(
      {
        endpointId: "review-independent-target-a",
        reviewId,
        role: "review",
        sessionEpoch: "review-independent-target-a",
      },
      () => undefined,
    );
    await expect(review.snapshot()).resolves.toMatchObject({
      projection: {
        commandPlan: { targetId: target.id },
        reviewId,
      },
      status: "pending",
    });
    const targetBPreparation = workspace.request({
      intent: { names: ["tdd"], scope: "project", type: "remove" },
      targetId: otherTarget.id,
      type: "mutation.prepare",
      version: 1,
    });
    await started;
    await expect(
      review.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "mutation_conflict", phase: "coordinate" },
      ok: false,
    });
    await expect(review.snapshot()).resolves.toMatchObject({
      status: "pending",
    });
    await expect(workspace.snapshot()).resolves.toMatchObject({
      mutation: { phase: "idle" },
      target: { id: otherTarget.id },
    });
    review.teardown();
    await expect(review.snapshot()).resolves.toEqual({
      decision: "reject",
      schemaVersion: 1,
      status: "settled",
    });
    await expect(workspace.snapshot()).resolves.toMatchObject({
      mutation: { phase: "idle" },
      target: { id: otherTarget.id },
    });

    releasePreparation();
    await expect(targetBPreparation).resolves.toEqual({
      ok: true,
      value: { operationId: "prepared-target-b" },
    });
    await expect(workspace.snapshot()).resolves.toMatchObject({
      mutation: {
        commandPlan: { targetId: otherTarget.id },
        phase: "planned",
      },
      target: { id: otherTarget.id },
    });
    await expect(review.snapshot()).resolves.toMatchObject({
      decision: "reject",
      status: "settled",
    });
  });

  it("requires a role-bound Trusted Review and durable Guard before execution", async () => {
    const records = createMemoryRecoveryRecords(
      [],
      [],
      [
        {
          connectionReference: null,
          generation: target.generation,
          harness: target.harness,
          id: target.id,
          kind: target.kind,
          label: target.label,
          workspace: target.workspace,
        },
      ],
    );
    const lifecycle: string[] = [];
    const guardedRecords = {
      async commit(change: Parameters<typeof records.commit>[0]) {
        lifecycle.push(change.type);
        return records.commit(change);
      },
      restore: () => records.restore(),
    };
    const postflightInventory: Inventory = {
      ...freshInventory,
      entries: [],
      observedAt: "2026-08-21T10:01:00.000Z",
    };
    const process: SkillsProcess = {
      async executeConfirmed({ confirmation }) {
        lifecycle.push("executeConfirmed");
        expect((await records.restore()).mutationGuards).toMatchObject([
          {
            effects: "none",
            operationId: "mutation-operation-1",
            targetId: target.id,
          },
        ]);
        expect(confirmation).toEqual({
          digest: "a".repeat(64),
          preparedMutationId: "prepared-1",
        });
        return {
          ok: true,
          value: {
            effects: { status: "verified" as const },
            inventory: postflightInventory,
            preparedMutationId: "prepared-1",
            process: {
              disposition: "completed" as const,
              exitCode: 0,
              termination: "known" as const,
            },
          },
        };
      },
      async observeInventory() {
        return { ok: true, value: freshInventory };
      },
      async prepareMutation(input) {
        expect(input).toMatchObject({
          freshness: "fresh",
          intent: {
            names: ["tdd"],
            scope: "project",
            type: "remove",
          },
          inventory: freshInventory,
        });
        return {
          ok: true,
          value: {
            commandPlan: {
              harness: "Codex",
              names: ["tdd"],
              operation: "remove" as const,
              preview: "npx skills@1.5.23 remove tdd --agent codex --yes",
              schemaVersion: 1 as const,
              scope: "project" as const,
              source: null,
              targetId: target.id,
              timeoutMs: 120_000,
            },
            digest: "a".repeat(64),
            expiresAt: "2026-08-21T10:10:00.000Z",
            id: "prepared-1",
            inventoryId: input.inventoryId,
            targetGeneration: 1,
            targetId: target.id,
          },
        };
      },
    };
    const ids = [
      "refresh-1",
      "inventory-1",
      "review-1",
      "mutation-operation-1",
    ];
    const presented: string[] = [];
    const capabilities = createDesktopCapabilities({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => ids.shift() ?? "unexpected-id",
      onReviewRequested: (reviewId) => presented.push(reviewId),
      recoveryRecords: guardedRecords,
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-1",
        role: "workspace",
        sessionEpoch: "workspace-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    expect(
      await workspace.request({
        intent: {
          names: ["tdd"],
          scope: "project",
          type: "remove",
        },
        targetId: target.id,
        type: "mutation.prepare",
        version: 1,
      }),
    ).toEqual({ ok: true, value: { operationId: "prepared-1" } });
    expect(await workspace.snapshot()).toMatchObject({
      mutation: {
        commandPlan: { names: ["tdd"], operation: "remove" },
        phase: "planned",
      },
    });
    expect(
      await workspace.request({
        preparedMutationId: "prepared-1",
        type: "review.request",
        version: 1,
      }),
    ).toEqual({ ok: true, value: { operationId: "review-1" } });
    expect(presented).toEqual(["review-1"]);

    expect(
      await workspace.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(lifecycle).not.toContain("executeConfirmed");

    const review = capabilities.attach(
      {
        endpointId: "review-contents-1",
        reviewId: "review-1",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );
    expect(await review.snapshot()).toMatchObject({
      projection: {
        commandPlan: { names: ["tdd"], operation: "remove" },
        reviewId: "review-1",
        target: publicTarget,
      },
      status: "pending",
    });

    expect(
      await review.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).toEqual({
      ok: true,
      value: { operationId: "mutation-operation-1" },
    });
    expect(lifecycle).toEqual([
      "inventory.replace",
      "guard.put",
      "executeConfirmed",
      "inventory.replace",
      "guard.clear",
    ]);
    expect((await records.restore()).mutationGuards).toEqual([]);
    expect(await workspace.snapshot()).toMatchObject({
      inventory: { entries: [], freshness: "fresh" },
      mutation: {
        outcome: {
          effects: { status: "verified" },
          process: { disposition: "completed", termination: "known" },
        },
        phase: "succeeded",
      },
    });
    expect(
      await review.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).toMatchObject({ error: { code: "unauthorized" }, ok: false });
    expect(
      lifecycle.filter((entry) => entry === "executeConfirmed"),
    ).toHaveLength(1);
  });

  it("rejects expired and newer-Inventory reviews without execution", async () => {
    let now = new Date("2026-08-21T10:00:00.000Z");
    let preparations = 0;
    let executions = 0;
    const process: SkillsProcess = {
      async executeConfirmed() {
        executions += 1;
        throw new Error("execution must remain unreachable");
      },
      async observeInventory() {
        return {
          ok: true,
          value: { ...freshInventory, observedAt: now.toISOString() },
        };
      },
      async prepareMutation(input) {
        preparations += 1;
        return {
          ok: true,
          value: {
            commandPlan: {
              harness: "Codex",
              names: ["tdd"],
              operation: "remove",
              preview: "npx skills@1.5.23 remove tdd --agent codex --yes",
              schemaVersion: 1,
              scope: "project",
              source: null,
              targetId: target.id,
              timeoutMs: 120_000,
            },
            digest: `${preparations}`.repeat(64),
            expiresAt:
              preparations === 1
                ? "2026-08-21T10:01:00.000Z"
                : "2026-08-21T11:00:00.000Z",
            id: `prepared-${preparations}`,
            inventoryId: input.inventoryId,
            targetGeneration: 1,
            targetId: target.id,
          },
        };
      },
    };
    const ids = [
      "refresh-1",
      "inventory-1",
      "review-expired",
      "review-drift",
      "refresh-2",
      "inventory-2",
    ];
    const capabilities = createDesktopCapabilities({
      clock: () => now,
      id: () => ids.shift() ?? "unexpected",
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-expiry-drift",
        role: "workspace",
        sessionEpoch: "workspace-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    const prepare = () =>
      workspace.request({
        intent: { names: ["tdd"], scope: "project", type: "remove" },
        targetId: target.id,
        type: "mutation.prepare",
        version: 1,
      });
    await prepare();
    await workspace.request({
      preparedMutationId: "prepared-1",
      type: "review.request",
      version: 1,
    });
    const expiredReview = capabilities.attach(
      {
        endpointId: "review-expired-window",
        reviewId: "review-expired",
        role: "review",
        sessionEpoch: "review-expired-epoch",
      },
      () => undefined,
    );
    now = new Date("2026-08-21T10:01:00.000Z");

    expect(
      await expiredReview.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).toMatchObject({ error: { code: "review_expired" }, ok: false });
    expect(executions).toBe(0);

    await prepare();
    await workspace.request({
      preparedMutationId: "prepared-2",
      type: "review.request",
      version: 1,
    });
    const driftedReview = capabilities.attach(
      {
        endpointId: "review-drift-window",
        reviewId: "review-drift",
        role: "review",
        sessionEpoch: "review-drift-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    expect(
      await driftedReview.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).toMatchObject({ error: { code: "unauthorized" }, ok: false });
    expect(executions).toBe(0);
  });

  it("keeps a restarted Guard blocked until explicit post-deadline reconciliation", async () => {
    let now = new Date("2026-08-21T10:00:00.000Z");
    let observations = 0;
    const records = createMemoryRecoveryRecords(
      [
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: 1,
          observedAt: "2026-08-21T09:00:00.000Z",
          targetId: target.id,
        },
      ],
      [
        {
          deadline: "2026-08-21T10:05:00.000Z",
          effects: "possible",
          generation: 1,
          operationId: "prior-mutation",
          phase: "reconciliation-required",
          targetId: target.id,
        },
      ],
    );
    const process: SkillsProcess = {
      ...mutationNotExercised,
      async observeInventory() {
        observations += 1;
        return {
          ok: true,
          value: {
            ...freshInventory,
            observedAt: now.toISOString(),
          },
        };
      },
    };
    const capabilities = createDesktopCapabilities({
      clock: () => now,
      id: () => `operation-${observations + 1}`,
      recoveryRecords: records,
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-recovery",
        role: "workspace",
        sessionEpoch: "recovery-epoch",
      },
      () => undefined,
    );

    expect(await workspace.snapshot()).toMatchObject({
      inventory: { freshness: "stale" },
      mutation: {
        phase: "reconciliation-required",
        reconciliationDeadline: "2026-08-21T10:05:00.000Z",
      },
    });
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    expect(await workspace.snapshot()).toMatchObject({
      inventory: { freshness: "fresh" },
      mutation: { phase: "reconciliation-required" },
    });
    expect((await records.restore()).mutationGuards).toHaveLength(1);
    expect(
      await workspace.request({
        intent: {
          names: ["tdd"],
          scope: "project",
          type: "remove",
        },
        targetId: target.id,
        type: "mutation.prepare",
        version: 1,
      }),
    ).toMatchObject({
      error: { code: "reconciliation_required" },
      ok: false,
    });
    expect(
      await workspace.request({
        targetId: target.id,
        type: "mutation.reconcile",
        version: 1,
      }),
    ).toMatchObject({ error: { code: "reconciliation_wait" }, ok: false });
    expect(observations).toBe(1);

    now = new Date("2026-08-21T10:05:00.000Z");
    expect(
      await workspace.request({
        targetId: target.id,
        type: "mutation.reconcile",
        version: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(observations).toBe(2);
    expect((await records.restore()).mutationGuards).toEqual([]);
    expect(await workspace.snapshot()).toMatchObject({
      inventory: { freshness: "fresh", observedAt: now.toISOString() },
      mutation: {
        phase: "idle",
        reconciliationDeadline: null,
      },
    });
  });

  it("proves a failed Guard commit cannot reach the process Adapter", async () => {
    const records = createMemoryRecoveryRecords();
    let executions = 0;
    const process: SkillsProcess = {
      async executeConfirmed() {
        executions += 1;
        throw new Error("execution must remain unreachable");
      },
      async observeInventory() {
        return { ok: true, value: freshInventory };
      },
      async prepareMutation(input) {
        return {
          ok: true,
          value: {
            commandPlan: {
              harness: "Codex",
              names: ["tdd"],
              operation: "remove",
              preview: "npx skills@1.5.23 remove tdd --agent codex --yes",
              schemaVersion: 1,
              scope: "project",
              source: null,
              targetId: target.id,
              timeoutMs: 120_000,
            },
            digest: "b".repeat(64),
            expiresAt: "2026-08-21T10:10:00.000Z",
            id: "prepared-guard-failure",
            inventoryId: input.inventoryId,
            targetGeneration: 1,
            targetId: target.id,
          },
        };
      },
    };
    const ids = ["refresh", "inventory", "review", "mutation"];
    const capabilities = createDesktopCapabilities({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => ids.shift() ?? "unexpected",
      recoveryRecords: {
        async commit(change) {
          if (change.type === "guard.put") {
            return {
              error: {
                code: "persist_failed" as const,
                effects: "none" as const,
                message: "Recovery authority could not be persisted.",
                phase: "persist",
                retryable: true,
              },
              ok: false as const,
            };
          }
          return records.commit(change);
        },
        restore: () => records.restore(),
      },
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-guard-failure",
        role: "workspace",
        sessionEpoch: "workspace-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await workspace.request({
      intent: {
        names: ["tdd"],
        scope: "project",
        type: "remove",
      },
      targetId: target.id,
      type: "mutation.prepare",
      version: 1,
    });
    await workspace.request({
      preparedMutationId: "prepared-guard-failure",
      type: "review.request",
      version: 1,
    });
    const review = capabilities.attach(
      {
        endpointId: "review-guard-failure",
        reviewId: "review",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );

    expect(
      await review.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
    expect(executions).toBe(0);
    expect((await records.restore()).mutationGuards).toEqual([]);
    expect(await workspace.snapshot()).toMatchObject({
      mutation: { phase: "failed" },
    });
  });

  it("retains the original deadline and Guard when termination is uncertain", async () => {
    const otherTarget: TargetDefinition = {
      ...target,
      id: "00000000-0000-4000-8000-000000000009",
      label: "Other Target",
      workspace: "/work/uncertain-other",
      workspaceLabel: "uncertain-other",
    };
    const records = createMemoryRecoveryRecords(
      [],
      [],
      [target, otherTarget].map((definition) => ({
        connectionReference: definition.connectionReference ?? null,
        generation: definition.generation,
        harness: definition.harness,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    );
    const process: SkillsProcess = {
      async executeConfirmed() {
        return {
          ok: true,
          value: {
            effects: { status: "possible" as const },
            inventory: null,
            preparedMutationId: "prepared-uncertain",
            process: {
              disposition: "timed-out" as const,
              exitCode: null,
              termination: "unknown" as const,
            },
          },
        };
      },
      async observeInventory() {
        return { ok: true, value: freshInventory };
      },
      async prepareMutation(input) {
        return {
          ok: true,
          value: {
            commandPlan: {
              harness: "Codex",
              names: ["tdd"],
              operation: "remove",
              preview: "npx skills@1.5.23 remove tdd --agent codex --yes",
              schemaVersion: 1,
              scope: "project",
              source: null,
              targetId: target.id,
              timeoutMs: 120_000,
            },
            digest: "c".repeat(64),
            expiresAt: "2026-08-21T10:10:00.000Z",
            id: "prepared-uncertain",
            inventoryId: input.inventoryId,
            targetGeneration: 1,
            targetId: target.id,
          },
        };
      },
    };
    const ids = ["refresh", "inventory", "review", "mutation"];
    let now = new Date("2026-08-21T10:00:00.000Z");
    const capabilities = createDesktopCapabilities({
      clock: () => now,
      id: () => ids.shift() ?? "unexpected",
      recoveryRecords: records,
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-uncertain",
        role: "workspace",
        sessionEpoch: "workspace-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await workspace.request({
      intent: { names: ["tdd"], scope: "project", type: "remove" },
      targetId: target.id,
      type: "mutation.prepare",
      version: 1,
    });
    await workspace.request({
      preparedMutationId: "prepared-uncertain",
      type: "review.request",
      version: 1,
    });
    const review = capabilities.attach(
      {
        endpointId: "review-uncertain",
        reviewId: "review",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );

    expect(
      await review.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).toMatchObject({
      error: { code: "reconciliation_required", effects: "possible" },
      ok: false,
    });
    expect((await records.restore()).mutationGuards).toEqual([
      {
        deadline: "2026-08-21T10:02:00.000Z",
        effects: "possible",
        generation: 1,
        operationId: "mutation",
        phase: "reconciliation-required",
        targetId: target.id,
      },
    ]);
    expect(await workspace.snapshot()).toMatchObject({
      inventory: { freshness: "stale" },
      mutation: {
        phase: "reconciliation-required",
        reconciliationDeadline: "2026-08-21T10:02:00.000Z",
      },
      targets: [
        { deletionBlocked: true, target: { id: target.id } },
        { target: { id: otherTarget.id } },
      ],
    });

    const changedDefinition = {
      connectionReference: null,
      harness: target.harness,
      kind: target.kind,
      label: "Changed after uncertainty",
      workspace: target.workspace,
    } as const;
    await expect(
      workspace.request({
        definition: changedDefinition,
        targetId: target.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "reconciliation_required" },
      ok: false,
    });
    await expect(
      workspace.request({
        targetId: target.id,
        type: "target.delete",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "reconciliation_required" },
      ok: false,
    });

    now = new Date("2026-08-21T10:02:00.000Z");
    await expect(
      workspace.request({
        targetId: target.id,
        type: "mutation.reconcile",
        version: 1,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      workspace.request({
        definition: changedDefinition,
        targetId: target.id,
        type: "target.update",
        version: 1,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(workspace.snapshot()).resolves.toMatchObject({
      targets: [
        { deletionBlocked: false, target: { label: changedDefinition.label } },
        { target: { id: otherTarget.id } },
      ],
    });
  });

  it("requires a second Trusted Review to cancel a running mutation", async () => {
    const records = createMemoryRecoveryRecords();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let cancellationObserved = false;
    const process: SkillsProcess = {
      async executeConfirmed({ signal }) {
        markStarted();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              cancellationObserved = true;
              resolve();
            },
            { once: true },
          );
        });
        return {
          ok: true,
          value: {
            effects: { status: "not-observed" as const },
            inventory: freshInventory,
            preparedMutationId: "prepared-cancel",
            process: {
              disposition: "cancelled" as const,
              exitCode: null,
              termination: "known" as const,
            },
          },
        };
      },
      async observeInventory() {
        return { ok: true, value: freshInventory };
      },
      async prepareMutation(input) {
        return {
          ok: true,
          value: {
            commandPlan: {
              harness: "Codex",
              names: ["tdd"],
              operation: "remove",
              preview: "npx skills@1.5.23 remove tdd --agent codex --yes",
              schemaVersion: 1,
              scope: "project",
              source: null,
              targetId: target.id,
              timeoutMs: 120_000,
            },
            digest: "d".repeat(64),
            expiresAt: "2026-08-21T10:10:00.000Z",
            id: "prepared-cancel",
            inventoryId: input.inventoryId,
            targetGeneration: 1,
            targetId: target.id,
          },
        };
      },
    };
    const ids = [
      "refresh",
      "inventory",
      "execute-review",
      "mutation",
      "cancel-review-rejected",
      "cancel-review",
    ];
    const capabilities = createDesktopCapabilities({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => ids.shift() ?? "unexpected",
      recoveryRecords: records,
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-cancel",
        role: "workspace",
        sessionEpoch: "workspace-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await workspace.request({
      intent: { names: ["tdd"], scope: "project", type: "remove" },
      targetId: target.id,
      type: "mutation.prepare",
      version: 1,
    });
    await workspace.request({
      preparedMutationId: "prepared-cancel",
      type: "review.request",
      version: 1,
    });
    const executionReview = capabilities.attach(
      {
        endpointId: "execute-review-window",
        reviewId: "execute-review",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );
    const execution = executionReview.request({
      decision: "approve",
      type: "review.decide",
      version: 1,
    });
    await started;

    expect(cancellationObserved).toBe(false);
    expect(
      await workspace.request({
        operationId: "mutation",
        type: "review.cancel-request",
        version: 1,
      }),
    ).toEqual({
      ok: true,
      value: { operationId: "cancel-review-rejected" },
    });
    expect(cancellationObserved).toBe(false);
    const rejectedCancellationReview = capabilities.attach(
      {
        endpointId: "rejected-cancel-review-window",
        reviewId: "cancel-review-rejected",
        role: "review",
        sessionEpoch: "cancel-review-rejected-epoch",
      },
      () => undefined,
    );
    rejectedCancellationReview.teardown();
    expect(await workspace.snapshot()).toMatchObject({
      mutation: { activeOperationId: "mutation", phase: "running" },
    });
    expect(cancellationObserved).toBe(false);
    expect(
      await workspace.request({
        operationId: "mutation",
        type: "review.cancel-request",
        version: 1,
      }),
    ).toEqual({ ok: true, value: { operationId: "cancel-review" } });
    const cancellationReview = capabilities.attach(
      {
        endpointId: "cancel-review-window",
        reviewId: "cancel-review",
        role: "review",
        sessionEpoch: "cancel-review-epoch",
      },
      () => undefined,
    );
    expect(await cancellationReview.snapshot()).toMatchObject({
      projection: { purpose: "cancel" },
      status: "pending",
    });

    expect(
      await cancellationReview.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).toEqual({ ok: true, value: { operationId: "mutation" } });
    expect(await execution).toEqual({
      ok: true,
      value: { operationId: "mutation" },
    });
    expect(cancellationObserved).toBe(true);
    expect((await records.restore()).mutationGuards).toEqual([]);
    expect(await workspace.snapshot()).toMatchObject({
      mutation: {
        outcome: {
          effects: { status: "not-observed" },
          process: { disposition: "cancelled", termination: "known" },
        },
        phase: "failed",
      },
    });
  });

  it("waits boundedly for a confirmed mutation without cancelling it on teardown", async () => {
    const records = createMemoryRecoveryRecords();
    let markStarted!: () => void;
    let releaseMutation!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    let mutationSignal: AbortSignal | undefined;
    const process: SkillsProcess = {
      async executeConfirmed({ signal }) {
        mutationSignal = signal;
        markStarted();
        await released;
        return {
          ok: true,
          value: {
            effects: { status: "verified" as const },
            inventory: { ...freshInventory, entries: [] },
            preparedMutationId: "prepared-shutdown",
            process: {
              disposition: "completed" as const,
              exitCode: 0,
              termination: "known" as const,
            },
          },
        };
      },
      async observeInventory() {
        return { ok: true, value: freshInventory };
      },
      async prepareMutation(input) {
        return {
          ok: true,
          value: {
            commandPlan: {
              harness: "Codex",
              names: ["tdd"],
              operation: "remove",
              preview: "npx skills@1.5.23 remove tdd --agent codex --yes",
              schemaVersion: 1,
              scope: "project",
              source: null,
              targetId: target.id,
              timeoutMs: 120_000,
            },
            digest: "e".repeat(64),
            expiresAt: "2026-08-21T10:10:00.000Z",
            id: "prepared-shutdown",
            inventoryId: input.inventoryId,
            targetGeneration: 1,
            targetId: target.id,
          },
        };
      },
    };
    const ids = ["refresh", "inventory", "review", "mutation"];
    const capabilities = createDesktopCapabilities({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      id: () => ids.shift() ?? "unexpected",
      recoveryRecords: records,
      shutdownTimeoutMs: 1_000,
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-shutdown-mutation",
        role: "workspace",
        sessionEpoch: "workspace-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    await workspace.request({
      intent: { names: ["tdd"], scope: "project", type: "remove" },
      targetId: target.id,
      type: "mutation.prepare",
      version: 1,
    });
    await workspace.request({
      preparedMutationId: "prepared-shutdown",
      type: "review.request",
      version: 1,
    });
    const review = capabilities.attach(
      {
        endpointId: "review-shutdown-mutation",
        reviewId: "review",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );
    const execution = review.request({
      decision: "approve",
      type: "review.decide",
      version: 1,
    });
    await started;
    workspace.teardown();
    let shutdownSettled = false;
    const shutdown = capabilities.shutdown().then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();

    expect(shutdownSettled).toBe(false);
    expect(mutationSignal?.aborted).toBe(false);
    expect((await records.restore()).mutationGuards).toHaveLength(1);

    releaseMutation();
    await execution;
    await shutdown;
    expect((await records.restore()).mutationGuards).toEqual([]);
  });
});

describe("DesktopCapabilities Official Collection contract", () => {
  const manifestDigest =
    "sha256:baa005a7c8644f332c902328ae998c657ae4bc861ba2e5ce29bc4a2eb493af48";
  const validCatalog = {
    releases: [
      {
        manifest: {
          collectionId: "skills-desktop-starter",
          compatibility: {
            cliVersion: "1.5.23",
            harnesses: ["Codex"],
            platforms: ["linux"],
            requiredCapabilities: ["local"],
          },
          description: "Discover and install reviewed agent Skills.",
          releaseNumber: 1,
          schemaVersion: 1,
          skills: ["find-skills", "tdd"],
          source: {
            repository: "vercel-labs/skills",
            repositoryUrl: "https://github.com/vercel-labs/skills",
            reviewedRevision: "0123456789abcdef0123456789abcdef01234567",
            sourceType: "github",
          },
          status: "active",
          supersedesDigest: null as string | null,
          title: "Skills Desktop Starter",
        },
        manifestDigest,
        receipt: {
          author: "collection-author",
          manifestDigest,
          reviewLocation: "https://github.com/oldwinter/skills-desktop/pull/1",
          reviewPolicy: "official-collection-v1",
          reviewedAt: "2026-08-22T06:00:00.000Z",
          reviewer: "independent-reviewer",
          schemaVersion: 1,
          status: "approved",
        },
      },
    ],
    schemaVersion: 1,
  };

  const canonicalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonicalize)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, child]) => [key, canonicalize(child)]),
          )
        : value;
  const digestFor = (manifest: unknown) =>
    `sha256:${createHash("sha256")
      .update(JSON.stringify(canonicalize(manifest)))
      .digest("hex")}`;
  const refreshEnvelopeDigest = (
    release: (typeof validCatalog.releases)[number],
  ) => {
    release.manifestDigest = digestFor(release.manifest);
    release.receipt.manifestDigest = release.manifestDigest;
  };

  it("fails startup closed when the bundled catalog has unknown fields", async () => {
    const capabilities = createDesktopCapabilities({
      id: () => "unused",
      officialCollectionCatalog: {
        releases: [],
        schemaVersion: 1,
        unexpectedExecutableData: true,
      },
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          return { ok: true, value: freshInventory };
        },
      }),
    });

    await expect(capabilities.initialize()).rejects.toThrow(
      "Official Collection catalog",
    );
  });

  it.each([
    {
      corrupt(catalog: typeof validCatalog) {
        catalog.releases[0]!.manifestDigest = `sha256:${"0".repeat(64)}`;
      },
      name: "invalid manifest digest",
    },
    {
      corrupt(catalog: typeof validCatalog) {
        catalog.releases[0]!.manifest.skills = ["tdd", "tdd"];
        refreshEnvelopeDigest(catalog.releases[0]!);
      },
      name: "duplicate Skill names",
    },
    {
      corrupt(catalog: typeof validCatalog) {
        catalog.releases[0]!.manifest.skills = ["tdd", "TDD"];
        refreshEnvelopeDigest(catalog.releases[0]!);
      },
      name: "case-conflicting Skill names",
    },
    {
      corrupt(catalog: typeof validCatalog) {
        catalog.releases[0]!.manifest.source.reviewedRevision = "main";
      },
      name: "mutable source revision",
    },
    {
      corrupt(catalog: typeof validCatalog) {
        catalog.releases[0]!.manifest.source.repositoryUrl =
          "https://gitlab.com/vercel-labs/skills";
        refreshEnvelopeDigest(catalog.releases[0]!);
      },
      name: "unsupported source",
    },
    {
      corrupt(catalog: typeof validCatalog) {
        catalog.releases[0]!.receipt.reviewer = "collection-author";
      },
      name: "non-independent receipt",
    },
    {
      corrupt(catalog: typeof validCatalog) {
        const prior = catalog.releases[0]!;
        const next = structuredClone(prior);
        next.manifest.releaseNumber = 2;
        next.manifest.status = "deprecated";
        next.manifest.supersedesDigest = `sha256:${"f".repeat(64)}`;
        refreshEnvelopeDigest(next);
        catalog.releases.push(next);
      },
      name: "broken supersedes chain",
    },
    {
      corrupt(catalog: typeof validCatalog) {
        catalog.releases.push(structuredClone(catalog.releases[0]!));
      },
      name: "duplicate release identity",
    },
  ])("fails startup closed for $name", async ({ corrupt }) => {
    const invalidCatalog = structuredClone(validCatalog);
    corrupt(invalidCatalog);
    const capabilities = createDesktopCapabilities({
      id: () => "unused",
      officialCollectionCatalog: invalidCatalog,
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          return { ok: true, value: freshInventory };
        },
      }),
    });

    await expect(capabilities.initialize()).rejects.toThrow(
      "Official Collection catalog",
    );
  });

  it("fails startup closed when compatibility is missing", async () => {
    const release = structuredClone(validCatalog.releases[0]!);
    const { compatibility: _compatibility, ...manifest } = release.manifest;
    const capabilities = createDesktopCapabilities({
      id: () => "unused",
      officialCollectionCatalog: {
        releases: [{ ...release, manifest }],
        schemaVersion: 1,
      },
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          return { ok: true, value: freshInventory };
        },
      }),
    });

    await expect(capabilities.initialize()).rejects.toThrow(
      "Official Collection catalog",
    );
  });

  it("assesses a valid active release against one Fresh Local Target", async () => {
    const ids = ["refresh-collection", "inventory-collection"];
    const capabilities = createDesktopCapabilities({
      id: () => ids.shift() ?? "unexpected",
      officialCollectionCatalog: validCatalog,
      platform: "linux",
      recoveryRecords: createMemoryRecoveryRecords(),
      skillsTargets: targetsWith({
        ...mutationNotExercised,
        async observeInventory() {
          return { ok: true, value: freshInventory };
        },
      }),
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-collections",
        role: "workspace",
        sessionEpoch: "collections-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    expect(await workspace.snapshot()).toMatchObject({
      collections: {
        acknowledgements: [],
        plan: null,
        releases: expect.arrayContaining([
          expect.objectContaining({
            assessments: expect.arrayContaining([
              expect.objectContaining({
                compatibility: "compatible",
                entries: expect.arrayContaining([
                  expect.objectContaining({
                    name: "find-skills",
                    selectable: true,
                    status: "missing",
                  }),
                  expect.objectContaining({
                    name: "tdd",
                    selectable: false,
                    status: "source-conflict",
                  }),
                ]),
                inventoryFreshness: "fresh",
                scope: "project",
                targetGeneration: 1,
                targetId: target.id,
              }),
            ]),
            collectionId: "skills-desktop-starter",
            executable: true,
            manifestDigest,
            releaseNumber: 1,
            status: "active",
          }),
        ]),
      },
    });
  });

  it("projects and prepares a Collection for a selected non-active Local Target", async () => {
    const otherTarget: TargetDefinition = {
      ...target,
      id: "00000000-0000-4000-8000-000000000003",
      label: "Other workspace",
      workspace: "/work/other",
      workspaceLabel: "other",
    };
    const definitions = [target, otherTarget];
    const preparedTargets: string[] = [];
    const skillsTargets = createSkillsTargetsCatalog({
      id: () => "unused-target-id",
      initialTarget: target,
      processFor(binding) {
        return {
          async executeConfirmed() {
            return {
              error: {
                code: "confirmation_invalid" as const,
                effects: "none" as const,
                message: "Execution is not part of this test.",
                phase: "execute",
                retryable: false,
              },
              ok: false as const,
            };
          },
          async observeInventory() {
            return {
              ok: true as const,
              value:
                binding.targetId === otherTarget.id
                  ? {
                      ...freshInventory,
                      entries: [
                        ...freshInventory.entries,
                        {
                          agents: ["Codex"],
                          contentFingerprint: { status: "unknown" as const },
                          declaredSource: {
                            source: "vercel-labs/skills",
                            sourceType: "github",
                          },
                          extensions: {},
                          name: "find-skills",
                          path: "/redacted/find-skills",
                          revision: { status: "unknown" as const },
                          scope: "project" as const,
                          sourceUrl: null,
                        },
                      ],
                    }
                  : freshInventory,
            };
          },
          async prepareMutation(input) {
            preparedTargets.push(binding.targetId);
            expect(input.intent).toEqual({
              names: ["find-skills"],
              scope: "project",
              source: {
                revision: "0123456789abcdef0123456789abcdef01234567",
                source: "vercel-labs/skills",
                sourceType: "github",
              },
              type: "add",
            });
            return {
              ok: true as const,
              value: {
                commandPlan: {
                  harness: "Codex",
                  names: ["find-skills"],
                  operation: "add" as const,
                  preview:
                    "npx skills@1.5.23 add https://github.com/vercel-labs/skills/archive/0123456789abcdef0123456789abcdef01234567.tar.gz --skill find-skills --agent codex --yes",
                  schemaVersion: 1 as const,
                  scope: "project" as const,
                  source: {
                    revision: "0123456789abcdef0123456789abcdef01234567",
                    source: "vercel-labs/skills",
                    sourceType: "github" as const,
                  },
                  targetId: binding.targetId,
                  timeoutMs: 600_000,
                },
                digest: "f".repeat(64),
                expiresAt: "2026-08-22T06:10:00.000Z",
                id: "prepared-other-collection",
                inventoryId: input.inventoryId,
                targetGeneration: binding.generation,
                targetId: binding.targetId,
              },
            };
          },
        };
      },
    });
    const records = createMemoryRecoveryRecords(
      [],
      [],
      definitions.map((definition) => ({
        connectionReference: null,
        generation: definition.generation,
        harness: definition.harness,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    );
    const ids = [
      "refresh-other",
      "inventory-other",
      "refresh-primary",
      "inventory-primary",
      "collection-plan-other",
    ];
    let now = new Date("2026-08-22T06:00:00.000Z");
    const capabilities = createDesktopCapabilities({
      clock: () => now,
      id: () => ids.shift() ?? "unexpected",
      officialCollectionCatalog: validCatalog,
      platform: "linux",
      recoveryRecords: records,
      skillsTargets,
    });
    await capabilities.initialize();
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-other-collection",
        role: "workspace",
        sessionEpoch: "other-collection-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: otherTarget.id,
      type: "inventory.refresh",
      version: 1,
    });
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });

    expect(await workspace.snapshot()).toMatchObject({
      target: { id: target.id },
      targets: [
        {
          collections: {
            releases: [
              {
                assessments: expect.arrayContaining([
                  expect.objectContaining({ targetId: target.id }),
                ]),
              },
            ],
          },
          target: { id: target.id },
        },
        {
          collections: {
            releases: [
              {
                assessments: expect.arrayContaining([
                  expect.objectContaining({ targetId: otherTarget.id }),
                ]),
              },
            ],
          },
          target: { id: otherTarget.id },
        },
      ],
    });
    await expect(
      workspace.request({
        collectionId: "skills-desktop-starter",
        manifestDigest,
        releaseNumber: 1,
        scope: "project",
        selections: [{ mode: "reapply", name: "find-skills" }],
        targetId: otherTarget.id,
        type: "collection.prepare",
        version: 1,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { operationId: "collection-plan-other" },
    });
    expect(preparedTargets).toEqual([otherTarget.id]);
    await expect(workspace.snapshot()).resolves.toMatchObject({
      collections: {
        plan: { targetId: otherTarget.id },
      },
      target: { id: otherTarget.id },
    });
    now = new Date("2026-08-22T06:10:00.000Z");
    await expect(
      workspace.request({
        collectionPlanId: "collection-plan-other",
        type: "collection.review.request",
        version: 1,
      }),
    ).resolves.toMatchObject({
      error: { code: "review_invalid" },
      ok: false,
    });
    await expect(workspace.snapshot()).resolves.toMatchObject({
      collections: { plan: null },
      mutation: { commandPlan: null, phase: "failed" },
    });
  });

  it("reviews and executes one pinned child through the existing durable lifecycle", async () => {
    const records = createMemoryRecoveryRecords();
    const lifecycle: string[] = [];
    const capturedIntents: unknown[] = [];
    const process: SkillsProcess = {
      async executeConfirmed({ confirmation }) {
        lifecycle.push("executeConfirmed");
        expect(confirmation).toEqual({
          digest: "c".repeat(64),
          preparedMutationId: "prepared-collection",
        });
        return {
          ok: true,
          value: {
            effects: { status: "content-unverified" as const },
            inventory: {
              ...freshInventory,
              entries: [
                ...freshInventory.entries,
                {
                  agents: ["Codex"],
                  contentFingerprint: { status: "unknown" as const },
                  declaredSource: {
                    source: "vercel-labs/skills",
                    sourceType: "github",
                  },
                  extensions: {},
                  name: "find-skills",
                  path: "/redacted/find-skills",
                  revision: { status: "unknown" as const },
                  scope: "project" as const,
                  sourceUrl: null,
                },
              ],
            },
            preparedMutationId: "prepared-collection",
            process: {
              disposition: "completed" as const,
              exitCode: 0,
              termination: "known" as const,
            },
          },
        };
      },
      async observeInventory() {
        return { ok: true, value: freshInventory };
      },
      async prepareMutation(input) {
        capturedIntents.push(input.intent);
        return {
          ok: true,
          value: {
            commandPlan: {
              harness: "Codex",
              names: ["find-skills"],
              operation: "add" as const,
              preview:
                "npx skills@1.5.23 add https://github.com/vercel-labs/skills/archive/0123456789abcdef0123456789abcdef01234567.tar.gz --skill find-skills --agent codex --yes",
              schemaVersion: 1 as const,
              scope: "project" as const,
              source: {
                revision: "0123456789abcdef0123456789abcdef01234567",
                source: "vercel-labs/skills",
                sourceType: "github" as const,
              },
              targetId: target.id,
              timeoutMs: 600_000,
            },
            digest: "c".repeat(64),
            expiresAt: "2026-08-22T06:10:00.000Z",
            id: "prepared-collection",
            inventoryId: input.inventoryId,
            targetGeneration: 1,
            targetId: target.id,
          },
        };
      },
    };
    const ids = [
      "refresh-collection",
      "inventory-collection",
      "collection-plan",
      "collection-review",
      "collection-execution",
    ];
    const capabilities = createDesktopCapabilities({
      clock: () => new Date("2026-08-22T06:00:00.000Z"),
      id: () => ids.shift() ?? "unexpected",
      officialCollectionCatalog: validCatalog,
      platform: "linux",
      recoveryRecords: {
        async commit(change) {
          lifecycle.push(change.type);
          return records.commit(change);
        },
        restore: () => records.restore(),
      },
      skillsTargets: targetsWith(process),
    });
    await capabilities.initialize();
    lifecycle.length = 0;
    const workspace = capabilities.attach(
      {
        endpointId: "workspace-collection-lifecycle",
        role: "workspace",
        sessionEpoch: "collection-lifecycle-epoch",
      },
      () => undefined,
    );
    await workspace.request({
      targetId: target.id,
      type: "inventory.refresh",
      version: 1,
    });
    lifecycle.length = 0;

    expect(
      await workspace.request({
        collectionId: "skills-desktop-starter",
        manifestDigest,
        releaseNumber: 1,
        scope: "project",
        selections: [{ mode: "add", name: "tdd" }],
        targetId: target.id,
        type: "collection.prepare",
        version: 1,
      }),
    ).toMatchObject({
      error: { code: "mutation_ineligible" },
      ok: false,
    });
    expect(capturedIntents).toEqual([]);

    expect(
      await workspace.request({
        collectionId: "skills-desktop-starter",
        manifestDigest,
        releaseNumber: 1,
        scope: "project",
        selections: [{ mode: "add", name: "find-skills" }],
        targetId: target.id,
        type: "collection.prepare",
        version: 1,
      }),
    ).toEqual({ ok: true, value: { operationId: "collection-plan" } });
    expect(capturedIntents).toEqual([
      {
        names: ["find-skills"],
        scope: "project",
        source: {
          revision: "0123456789abcdef0123456789abcdef01234567",
          source: "vercel-labs/skills",
          sourceType: "github",
        },
        type: "add",
      },
    ]);
    expect(await workspace.snapshot()).toMatchObject({
      collections: {
        plan: {
          childCommandPlan: {
            names: ["find-skills"],
            operation: "add",
            source: {
              revision: "0123456789abcdef0123456789abcdef01234567",
              source: "vercel-labs/skills",
            },
          },
          collectionId: "skills-desktop-starter",
          id: "collection-plan",
          manifestDigest,
          releaseNumber: 1,
          reviewDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          scope: "project",
          selections: [{ mode: "add", name: "find-skills" }],
          targetGeneration: 1,
          targetId: target.id,
        },
      },
    });
    expect(
      await workspace.request({
        collectionPlanId: "collection-plan",
        type: "collection.review.request",
        version: 1,
      }),
    ).toEqual({ ok: true, value: { operationId: "collection-review" } });
    const review = capabilities.attach(
      {
        endpointId: "review-collection-lifecycle",
        reviewId: "collection-review",
        role: "review",
        sessionEpoch: "review-collection-epoch",
      },
      () => undefined,
    );
    expect(await review.snapshot()).toMatchObject({
      projection: {
        collectionPlan: {
          collectionId: "skills-desktop-starter",
          manifestDigest,
          selections: [{ mode: "add", name: "find-skills" }],
        },
        reviewId: "collection-review",
      },
      status: "pending",
    });

    expect(
      await review.request({
        decision: "approve",
        type: "review.decide",
        version: 1,
      }),
    ).toEqual({
      ok: true,
      value: { operationId: "collection-execution" },
    });
    expect(lifecycle).toEqual([
      "collections.acknowledgements.replace",
      "guard.put",
      "executeConfirmed",
      "inventory.replace",
      "guard.clear",
    ]);
    expect((await records.restore()).collectionAcknowledgements).toEqual([
      {
        acknowledgedAt: "2026-08-22T06:00:00.000Z",
        collectionId: "skills-desktop-starter",
        kind: "release",
        manifestDigest,
        releaseNumber: 1,
      },
    ]);
    expect((await records.restore()).mutationGuards).toEqual([]);
    expect(await workspace.snapshot()).toMatchObject({
      inventory: { freshness: "fresh" },
      mutation: {
        outcome: { effects: { status: "content-unverified" } },
        phase: "succeeded",
      },
    });
  });
});
