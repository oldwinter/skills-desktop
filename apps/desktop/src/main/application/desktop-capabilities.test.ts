import { describe, expect, it } from "vitest";

import type { Inventory } from "@skills-desktop/skills-runtime";

import { createMemoryRecoveryRecords } from "../persistence/recovery-records.js";
import type { SkillsProcess } from "../adapters/local-skills-process.js";
import {
  createDesktopCapabilities,
  type DesktopEvent,
  type SkillsTargets,
  type TargetDefinition,
} from "./desktop-capabilities.js";

const target: TargetDefinition = {
  generation: 1,
  harness: "Codex",
  id: "local-target",
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

function targetsWith(process: SkillsProcess): SkillsTargets {
  return {
    async open(targetId) {
      if (targetId !== target.id) {
        return {
          error: {
            code: "target_not_found",
            effects: "none",
            message: "Target was not found.",
            phase: "open",
            retryable: false,
          },
          ok: false,
        };
      }
      return {
        ok: true,
        value: {
          binding: {
            generation: target.generation,
            harness: target.harness,
            kind: target.kind,
            targetId: target.id,
            workspace: target.workspace,
          },
          process,
          target,
        },
      };
    },
    primaryTarget: target,
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
            declaredSource: { source: null, sourceType: null },
            name: "restored",
            scope: "global",
          },
        ],
        generation: 1,
        observedAt: "2099-01-01T00:00:00.000Z",
        targetId: target.id,
      },
    ]);
    const process: SkillsProcess = {
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
        declaredSource: { source: "example/skills", sourceType: "github" },
        name: "tdd",
        scope: "project",
      },
    ]);
  });

  it("keeps the last complete Inventory as stale when a later refresh fails", async () => {
    let observations = 0;
    const process: SkillsProcess = {
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
});
