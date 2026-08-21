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
        declaredSource: { source: "example/skills", sourceType: "github" },
        name: "tdd",
        scope: "project",
      },
    ]);
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
});

describe("DesktopCapabilities mutation role-session contract", () => {
  it("requires a role-bound Trusted Review and durable Guard before execution", async () => {
    const records = createMemoryRecoveryRecords();
    const lifecycle: string[] = [];
    const guardedRecords = {
      async commit(
        change: Parameters<typeof records.commit>[0],
      ) {
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
      await workspace.request({ decision: "approve", type: "review.decide", version: 1 }),
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
    expect(lifecycle.filter((entry) => entry === "executeConfirmed")).toHaveLength(
      1,
    );
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
    const records = createMemoryRecoveryRecords();
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
    const capabilities = createDesktopCapabilities({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
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
