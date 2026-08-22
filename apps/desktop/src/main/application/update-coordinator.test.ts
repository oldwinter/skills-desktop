import { describe, expect, it, vi } from "vitest";

import {
  aboutReleaseDiagnosticsSchema,
  aboutUpdateSnapshotSchema,
  type AboutUpdateSnapshot,
  type RestartGuardReason,
} from "../../contracts/about.js";
import type {
  DeferredUpdateRecord,
  DeferredUpdateRecords,
} from "../persistence/deferred-update-records.js";
import {
  createUpdateCoordinator,
  type UpdateAdapterEvent,
} from "./update-coordinator.js";

describe("UpdateCoordinator policy", () => {
  it("waits for the startup delay before the first automatic check", async () => {
    const now = new Date("2026-08-22T06:00:00.000Z");
    let scheduledCheck: (() => void | Promise<void>) | undefined;
    const checkForUpdates = vi.fn();
    const after = vi.fn((_delayMs: number, action: () => void | Promise<void>) => {
      scheduledCheck = action;
      return () => undefined;
    });
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => now },
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      scheduler: { after },
      updater: { checkForUpdates },
    });

    await coordinator.start();
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(30_000, expect.any(Function));

    await scheduledCheck?.();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("publishes refreshed eligibility for automatic checking and synchronous errors", async () => {
    const now = new Date("2026-08-22T06:00:00.000Z");
    const scheduledChecks: Array<() => void | Promise<void>> = [];
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => now },
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      scheduler: {
        after: vi.fn((_delayMs, action) => {
          scheduledChecks.push(action);
          return () => undefined;
        }),
      },
      updater: {
        checkForUpdates: vi.fn(() => {
          throw new Error("bounded by the coordinator");
        }),
      },
    });
    const snapshots: AboutUpdateSnapshot[] = [];

    await coordinator.start();
    coordinator.subscribe((snapshot) => snapshots.push(snapshot));
    await scheduledChecks[0]?.();

    expect(
      snapshots.map(({ nextAutomaticCheckAt, state }) => ({
        nextAutomaticCheckAt,
        state: state.kind,
      })),
    ).toEqual([
      {
        nextAutomaticCheckAt: "2026-08-23T06:00:00.000Z",
        state: "checking",
      },
      {
        nextAutomaticCheckAt: "2026-08-23T06:00:00.000Z",
        state: "error",
      },
    ]);
  });

  it("waits until 24 hours after the persisted check before checking again", async () => {
    const now = new Date("2026-08-22T06:00:00.000Z");
    let scheduledCheck: (() => void | Promise<void>) | undefined;
    const checkForUpdates = vi.fn();
    const after = vi.fn((_delayMs: number, action: () => void | Promise<void>) => {
      scheduledCheck = action;
      return () => undefined;
    });
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "arm64",
        isPackaged: true,
        platform: "darwin",
        version: "0.1.0",
      },
      clock: { now: () => now },
      records: {
        load: vi.fn(async () => "2026-08-21T18:00:00.000Z"),
        save: vi.fn(async () => undefined),
      },
      scheduler: { after },
      updater: { checkForUpdates },
    });

    await coordinator.start();
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(
      12 * 60 * 60 * 1_000,
      expect.any(Function),
    );

    await scheduledCheck?.();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit user check before automatic eligibility", async () => {
    const now = new Date("2026-08-22T06:00:00.000Z");
    const cancelScheduledCheck = vi.fn();
    const checkForUpdates = vi.fn();
    const save = vi.fn(async () => undefined);
    const after = vi.fn(() => cancelScheduledCheck);
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => now },
      records: {
        load: vi.fn(async () => "2026-08-22T00:00:00.000Z"),
        save,
      },
      scheduler: { after },
      updater: { checkForUpdates },
    });

    await coordinator.start();
    await coordinator.requestCheck();

    expect(save).toHaveBeenCalledWith("2026-08-22T06:00:00.000Z");
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(cancelScheduledCheck).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenLastCalledWith(
      24 * 60 * 60 * 1_000,
      expect.any(Function),
    );
  });

  it("coalesces concurrent explicit checks while the durable record is pending", async () => {
    let finishSave: (() => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const checkForUpdates = vi.fn();
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      records: { load: vi.fn(async () => null), save },
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: { checkForUpdates },
    });

    await coordinator.start();
    const firstCheck = coordinator.requestCheck();
    const concurrentCheck = coordinator.requestCheck();

    expect(save).toHaveBeenCalledTimes(1);
    finishSave?.();
    await Promise.all([firstCheck, concurrentCheck]);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it.each<{
    event: UpdateAdapterEvent;
    expectedState: AboutUpdateSnapshot["state"];
  }>([
    {
      event: { type: "checking" },
      expectedState: { kind: "checking", requestedBy: "user" },
    },
    {
      event: { type: "update-available" },
      expectedState: { kind: "update-available" },
    },
    {
      event: { candidateVersion: "0.2.0", type: "update-downloaded" },
      expectedState: { kind: "update-downloaded" },
    },
    {
      event: { type: "update-not-available" },
      expectedState: { kind: "up-to-date" },
    },
    {
      event: { type: "error" },
      expectedState: {
        error: {
          code: "check_failed",
          message: "The update check could not be completed.",
          retryable: true,
        },
        kind: "error",
      },
    },
  ])(
    "projects the $event.type updater event",
    async ({ event, expectedState }) => {
      let receiveEvent:
        | ((event: UpdateAdapterEvent) => void | Promise<void>)
        | undefined;
      const coordinator = createUpdateCoordinator({
        application: {
          architecture: "x64",
          isPackaged: true,
          platform: "win32",
          version: "0.1.0",
        },
        clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
        records: {
          load: vi.fn(async () => null),
          save: vi.fn(async () => undefined),
        },
        scheduler: { after: vi.fn(() => () => undefined) },
        updater: {
          checkForUpdates: vi.fn(({ onEvent }) => {
            receiveEvent = onEvent;
          }),
        },
      });

      await coordinator.start();
      await coordinator.requestCheck();
      await receiveEvent?.(event);

      expect(coordinator.getSnapshot().state).toEqual(expectedState);
    },
  );

  it("ignores updater events from an older completed check", async () => {
    const checks: Array<{
      readonly onEvent: (event: UpdateAdapterEvent) => void;
    }> = [];
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      scheduler: {
        after: vi.fn(() => () => undefined),
      },
      updater: {
        checkForUpdates: vi.fn((input) => checks.push(input)),
      },
    });

    await coordinator.start();
    await coordinator.requestCheck();
    checks[0]!.onEvent({ type: "update-not-available" });
    await coordinator.requestCheck();
    checks[0]!.onEvent({ type: "error" });

    expect(coordinator.getSnapshot().state).toEqual({
      kind: "checking",
      requestedBy: "user",
    });
  });

  it("projects updater failures as a bounded retryable error", async () => {
    let receiveEvent: ((event: UpdateAdapterEvent) => void) | undefined;
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: {
        checkForUpdates: vi.fn(({ onEvent }) => {
          receiveEvent = onEvent;
        }),
      },
    });

    await coordinator.start();
    await coordinator.requestCheck();
    receiveEvent?.({ type: "error" });

    expect(coordinator.getSnapshot().state).toEqual({
      error: {
        code: "check_failed",
        message: "The update check could not be completed.",
        retryable: true,
      },
      kind: "error",
    });
  });

  it("contains a synchronous updater failure without rejecting the user request", async () => {
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: {
        checkForUpdates: vi.fn(() => {
          throw new Error("SECRET_UPDATE_PATH");
        }),
      },
    });

    await coordinator.start();
    await expect(coordinator.requestCheck()).resolves.toBeUndefined();
    expect(JSON.stringify(coordinator.getSnapshot())).not.toContain(
      "SECRET_UPDATE_PATH",
    );
    expect(coordinator.getSnapshot().state).toMatchObject({
      error: { code: "check_failed" },
      kind: "error",
    });
  });

  it("exposes Linux manual guidance without invoking an in-app updater", async () => {
    const checkForUpdates = vi.fn();
    const save = vi.fn(async () => undefined);
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "linux",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      records: { load: vi.fn(async () => null), save },
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: { checkForUpdates },
    });

    await coordinator.start();
    await coordinator.requestCheck();

    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot()).toMatchObject({
      lastCheckAt: null,
      nextAutomaticCheckAt: null,
      policy: {
        message:
          "Download a newer package from GitHub Releases and install it manually.",
        mode: "manual",
        releasePageUrl:
          "https://github.com/oldwinter/skills-desktop/releases",
      },
      schemaVersion: 2,
      state: { kind: "manual" },
    });
  });

  it("returns only the versioned feed-free About snapshot", async () => {
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "arm64",
        isPackaged: true,
        platform: "darwin",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: { checkForUpdates: vi.fn() },
    });

    await coordinator.start();
    const snapshot = aboutUpdateSnapshotSchema.parse(
      coordinator.getSnapshot(),
    );

    expect(snapshot.application).toEqual({
      architecture: "arm64",
      platform: "darwin",
      version: "0.1.0",
    });
    expect(JSON.stringify(snapshot)).not.toContain("update.electronjs.org");
  });

  it("publishes snapshot transitions until the subscriber detaches", async () => {
    let receiveEvent: ((event: UpdateAdapterEvent) => void) | undefined;
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: {
        checkForUpdates: vi.fn(({ onEvent }) => {
          receiveEvent = onEvent;
        }),
      },
    });
    const states: string[] = [];
    const unsubscribe = coordinator.subscribe((snapshot) =>
      states.push(snapshot.state.kind),
    );

    await coordinator.start();
    await coordinator.requestCheck();
    receiveEvent?.({ type: "update-not-available" });
    unsubscribe();
    await coordinator.requestCheck();

    expect(states).toEqual(["checking", "up-to-date"]);
  });

  it("fails closed when the check attempt cannot be recorded", async () => {
    const checkForUpdates = vi.fn();
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => {
          throw new Error("SECRET_RECORD_PATH");
        }),
      },
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: { checkForUpdates },
    });

    await coordinator.start();
    await expect(coordinator.requestCheck()).resolves.toBeUndefined();

    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot().state).toMatchObject({
      error: { code: "check_failed" },
      kind: "error",
    });
    expect(JSON.stringify(coordinator.getSnapshot())).not.toContain(
      "SECRET_RECORD_PATH",
    );
  });

  it("keeps startup usable while unreadable eligibility state disables automatic checks", async () => {
    const after = vi.fn(() => () => undefined);
    const checkForUpdates = vi.fn();
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "arm64",
        isPackaged: true,
        platform: "darwin",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      records: {
        load: vi.fn(async () => {
          throw new Error("SECRET_CORRUPT_RECORD");
        }),
        save: vi.fn(async () => undefined),
      },
      scheduler: { after },
      updater: { checkForUpdates },
    });

    await expect(coordinator.start()).resolves.toBeUndefined();

    expect(after).not.toHaveBeenCalled();
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot().state).toMatchObject({
      error: { code: "check_failed" },
      kind: "error",
    });
  });
});

describe("UpdateCoordinator deferred restart and diagnostics", () => {
  const candidateId = "00000000-0000-4000-8000-000000000025";

  function releaseFixture(options?: {
    readonly loadError?: boolean;
    readonly recovered?: DeferredUpdateRecord | null;
  }) {
    let candidateEvent:
      | ((event: UpdateAdapterEvent) => void | Promise<void>)
      | undefined;
    let guards: RestartGuardReason[] = [];
    let prepareRestart: () => Promise<void> = async () => undefined;
    let record = options?.recovered ?? null;
    let exportedSource: string | undefined;
    const deferredRecords: DeferredUpdateRecords = {
      clear: vi.fn(async () => {
        record = null;
      }),
      load: vi.fn(async () => {
        if (options?.loadError) throw new Error("SECRET_DEFERRED_RECORD_PATH");
        return record;
      }),
      save: vi.fn(async (next) => {
        record = structuredClone(next);
      }),
    };
    const restartAndInstall = vi.fn();
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      deferredRecords,
      diagnosticsExporter: {
        async export(source) {
          exportedSource = source;
          return "saved";
        },
      },
      id: () => candidateId,
      prepareRestart: () => prepareRestart(),
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      restartSafety: () => ({ guardReasons: guards }),
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: {
        checkForUpdates: vi.fn(({ onEvent }) => {
          candidateEvent = onEvent;
        }),
        restartAndInstall,
      },
    });
    return {
      candidateEvent: () => candidateEvent,
      coordinator,
      deferredRecords,
      exportedSource: () => exportedSource,
      record: () => record,
      restartAndInstall,
      setGuards(next: RestartGuardReason[]) {
        guards = next;
      },
      setPrepareRestart(next: () => Promise<void>) {
        prepareRestart = next;
      },
    };
  }

  async function downloadCandidate(
    fixture: ReturnType<typeof releaseFixture>,
  ) {
    await fixture.coordinator.start();
    await fixture.coordinator.requestCheck();
    await fixture.candidateEvent()?.({
      candidateVersion: "0.2.0",
      type: "update-downloaded",
    });
  }

  it("durably defers a downloaded candidate without restarting", async () => {
    const fixture = releaseFixture();

    await downloadCandidate(fixture);

    expect(fixture.restartAndInstall).not.toHaveBeenCalled();
    expect(fixture.record()).toEqual({
      candidate: {
        architecture: "x64",
        id: candidateId,
        platform: "win32",
        version: "0.2.0",
      },
      downloadedAt: "2026-08-22T06:00:00.000Z",
      runningVersion: "0.1.0",
    });
    expect(fixture.coordinator.getSnapshot()).toMatchObject({
      candidate: { id: candidateId, version: "0.2.0" },
      restart: {
        guardReasons: [],
        immediateRestartAvailable: true,
        kind: "deferred",
      },
      schemaVersion: 2,
      state: { kind: "update-downloaded" },
    });
  });

  it("blocks normal quit while downloaded candidate persistence is pending", async () => {
    let finishSave: (() => void) | undefined;
    let candidateEvent:
      | ((event: UpdateAdapterEvent) => void | Promise<void>)
      | undefined;
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "win32",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      deferredRecords: {
        clear: vi.fn(async () => undefined),
        load: vi.fn(async () => null),
        save: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishSave = resolve;
            }),
        ),
      },
      id: () => candidateId,
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      restartSafety: () => ({ guardReasons: ["mutation-active"] }),
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: {
        checkForUpdates: vi.fn(({ onEvent }) => {
          candidateEvent = onEvent;
        }),
        restartAndInstall: vi.fn(),
      },
    });
    await coordinator.start();
    await coordinator.requestCheck();

    const download = candidateEvent?.({
      candidateVersion: "0.2.0",
      type: "update-downloaded",
    });

    expect(coordinator.prepareNormalQuit()).toBe(false);
    expect(coordinator.getSnapshot().restart.guardReasons).toEqual([
      "mutation-active",
      "recovery-uncertain",
    ]);
    finishSave?.();
    await download;
    expect(coordinator.prepareNormalQuit()).toBe(false);
  });

  it.each(["0.1.0", "0.0.9", "0.2.0-rc.1"])(
    "rejects non-forward stable candidate %s",
    async (candidateVersion) => {
      const fixture = releaseFixture();
      await fixture.coordinator.start();
      await fixture.coordinator.requestCheck();

      await fixture.candidateEvent()?.({
        candidateVersion,
        type: "update-downloaded",
      });

      expect(fixture.record()).toBeNull();
      expect(fixture.coordinator.getSnapshot()).toMatchObject({
        candidate: null,
        restart: {
          guardReasons: ["recovery-uncertain"],
          immediateRestartAvailable: false,
          kind: "blocked",
        },
        state: { error: { code: "check_failed" }, kind: "error" },
      });
      expect(fixture.coordinator.prepareNormalQuit()).toBe(false);
      expect(fixture.restartAndInstall).not.toHaveBeenCalled();
    },
  );

  it("restarts only for the current candidate after explicit approval", async () => {
    const fixture = releaseFixture();
    await downloadCandidate(fixture);

    await expect(
      fixture.coordinator.requestRestart(
        "00000000-0000-4000-8000-000000000099",
      ),
    ).resolves.toBe("stale");
    expect(fixture.restartAndInstall).not.toHaveBeenCalled();

    await expect(
      fixture.coordinator.requestRestart(candidateId),
    ).resolves.toBe("started");
    expect(fixture.restartAndInstall).toHaveBeenCalledTimes(1);
  });

  it("cancels an approved restart when the coordinator is disposed", async () => {
    const fixture = releaseFixture();
    await downloadCandidate(fixture);
    let releasePreparation: (() => void) | undefined;
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    fixture.setPrepareRestart(() => preparation);

    const restart = fixture.coordinator.requestRestart(candidateId);
    fixture.coordinator.dispose();
    releasePreparation?.();

    await expect(restart).resolves.toBe("cancelled");
    expect(fixture.restartAndInstall).not.toHaveBeenCalled();
  });

  it("re-evaluates guards immediately before installation", async () => {
    const fixture = releaseFixture();
    await downloadCandidate(fixture);
    fixture.setPrepareRestart(async () => {
      fixture.setGuards(["mutation-active", "trusted-review-active"]);
    });

    await expect(
      fixture.coordinator.requestRestart(candidateId),
    ).resolves.toBe("blocked");

    expect(fixture.restartAndInstall).not.toHaveBeenCalled();
    expect(fixture.coordinator.getSnapshot().restart).toEqual({
      guardReasons: ["mutation-active", "trusted-review-active"],
      immediateRestartAvailable: false,
      kind: "blocked",
    });
    expect(fixture.coordinator.prepareNormalQuit()).toBe(false);
  });

  it("restores deferred normal-restart state without reviving immediate authority", async () => {
    const recovered = {
      candidate: {
        architecture: "x64",
        id: candidateId,
        platform: "win32",
        version: "0.2.0",
      },
      downloadedAt: "2026-08-22T05:00:00.000Z",
      runningVersion: "0.1.0",
    } as const;
    const fixture = releaseFixture({ recovered });

    await fixture.coordinator.start();

    expect(fixture.coordinator.getSnapshot()).toMatchObject({
      candidate: recovered.candidate,
      restart: {
        immediateRestartAvailable: false,
        kind: "deferred",
      },
      state: { kind: "update-downloaded" },
    });
    await expect(
      fixture.coordinator.requestRestart(candidateId),
    ).resolves.toBe("stale");
    expect(fixture.coordinator.prepareNormalQuit()).toBe(true);
    expect(fixture.restartAndInstall).not.toHaveBeenCalled();
  });

  it("retains and blocks deferred authority bound to a different running version", async () => {
    const fixture = releaseFixture({
      recovered: {
        candidate: {
          architecture: "x64",
          id: candidateId,
          platform: "win32",
          version: "0.2.0",
        },
        downloadedAt: "2026-08-22T05:00:00.000Z",
        runningVersion: "0.0.9",
      },
    });

    await fixture.coordinator.start();

    expect(fixture.deferredRecords.clear).not.toHaveBeenCalled();
    expect(fixture.coordinator.getSnapshot()).toMatchObject({
      candidate: null,
      restart: {
        guardReasons: ["recovery-uncertain"],
        immediateRestartAvailable: false,
        kind: "blocked",
      },
      state: { error: { code: "check_failed" }, kind: "error" },
    });
    await expect(
      fixture.coordinator.requestRestart(candidateId),
    ).resolves.toBe("stale");
    expect(fixture.coordinator.prepareNormalQuit()).toBe(false);
    expect(fixture.restartAndInstall).not.toHaveBeenCalled();
  });

  it("clears recovery evidence after the candidate becomes the running version", async () => {
    const fixture = releaseFixture({
      recovered: {
        candidate: {
          architecture: "x64",
          id: candidateId,
          platform: "win32",
          version: "0.1.0",
        },
        downloadedAt: "2026-08-22T05:00:00.000Z",
        runningVersion: "0.0.9",
      },
    });

    await fixture.coordinator.start();

    expect(fixture.deferredRecords.clear).toHaveBeenCalledTimes(1);
    expect(fixture.coordinator.getSnapshot()).toMatchObject({
      candidate: null,
      restart: { immediateRestartAvailable: false, kind: "none" },
    });
    expect(fixture.coordinator.prepareNormalQuit()).toBe(true);
  });

  it.each(["0.1.0", "0.0.9"])(
    "clears recovered non-forward candidate %s",
    async (candidateVersion) => {
      const fixture = releaseFixture({
        recovered: {
          candidate: {
            architecture: "x64",
            id: candidateId,
            platform: "win32",
            version: candidateVersion,
          },
          downloadedAt: "2026-08-22T05:00:00.000Z",
          runningVersion: "0.1.0",
        },
      });

      await fixture.coordinator.start();

      expect(fixture.deferredRecords.clear).not.toHaveBeenCalled();
      expect(fixture.coordinator.getSnapshot()).toMatchObject({
        candidate: null,
        restart: {
          guardReasons: ["recovery-uncertain"],
          immediateRestartAvailable: false,
          kind: "blocked",
        },
        state: { error: { code: "check_failed" }, kind: "error" },
      });
      expect(fixture.coordinator.prepareNormalQuit()).toBe(false);
      expect(fixture.restartAndInstall).not.toHaveBeenCalled();
    },
  );

  it("blocks a potentially updating quit when deferred recovery is unreadable", async () => {
    const fixture = releaseFixture({ loadError: true });

    await fixture.coordinator.start();

    expect(fixture.coordinator.getSnapshot()).toMatchObject({
      candidate: null,
      restart: {
        guardReasons: ["recovery-uncertain"],
        immediateRestartAvailable: false,
        kind: "blocked",
      },
      state: { error: { code: "check_failed" }, kind: "error" },
    });
    expect(fixture.coordinator.prepareNormalQuit()).toBe(false);
    expect(JSON.stringify(fixture.coordinator.getSnapshot())).not.toContain(
      "SECRET_DEFERRED_RECORD_PATH",
    );
  });

  it("exports only bounded redacted release evidence through the main exporter", async () => {
    const fixture = releaseFixture();
    await fixture.coordinator.start();
    await fixture.coordinator.requestCheck();
    await fixture.candidateEvent()?.({
      error: new Error(
        "https://token@example.test /SECRET_PATH ssh raw --argv shell text",
      ),
      type: "error",
    });
    fixture.setGuards([
      "protected-process-active",
      "reconciliation-required",
    ]);

    await expect(fixture.coordinator.exportDiagnostics()).resolves.toBe(
      "saved",
    );

    const source = fixture.exportedSource();
    expect(source).toBeDefined();
    expect(source!.length).toBeLessThan(16_384);
    const diagnostics = aboutReleaseDiagnosticsSchema.parse(
      JSON.parse(source!),
    );
    expect(diagnostics).toMatchObject({
      application: { version: "0.1.0" },
      candidate: null,
      errors: [{ code: "check_failed" }],
      guardReasons: [
        "protected-process-active",
        "reconciliation-required",
      ],
      restartState: "blocked",
      schemaVersion: 1,
      updateState: "error",
    });
    expect(source).not.toMatch(
      /token|SECRET|ssh raw|update\.electronjs\.org|--argv|shell text/i,
    );
  });

  it("keeps Linux manual-only while including current guards in diagnostics", async () => {
    let exportedSource: string | undefined;
    const deferredRecords: DeferredUpdateRecords = {
      clear: vi.fn(async () => undefined),
      load: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
    };
    const restartAndInstall = vi.fn();
    const coordinator = createUpdateCoordinator({
      application: {
        architecture: "x64",
        isPackaged: true,
        platform: "linux",
        version: "0.1.0",
      },
      clock: { now: () => new Date("2026-08-22T06:00:00.000Z") },
      deferredRecords,
      diagnosticsExporter: {
        async export(source) {
          exportedSource = source;
          return "saved";
        },
      },
      records: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
      restartSafety: () => ({
        guardReasons: ["mutation-active", "reconciliation-required"],
      }),
      scheduler: { after: vi.fn(() => () => undefined) },
      updater: { checkForUpdates: vi.fn(), restartAndInstall },
    });

    await coordinator.start();

    expect(coordinator.getSnapshot()).toMatchObject({
      candidate: null,
      policy: { mode: "manual" },
      restart: { guardReasons: [], kind: "none" },
      state: { kind: "manual" },
    });
    expect(coordinator.prepareNormalQuit()).toBe(true);
    await expect(
      coordinator.requestRestart(
        "00000000-0000-4000-8000-000000000025",
      ),
    ).resolves.toBe("stale");
    await expect(coordinator.exportDiagnostics()).resolves.toBe("saved");
    expect(
      aboutReleaseDiagnosticsSchema.parse(JSON.parse(exportedSource!)),
    ).toMatchObject({
      guardReasons: ["mutation-active", "reconciliation-required"],
      restartState: "blocked",
    });
    expect(deferredRecords.load).not.toHaveBeenCalled();
    expect(deferredRecords.save).not.toHaveBeenCalled();
    expect(restartAndInstall).not.toHaveBeenCalled();
  });
});
