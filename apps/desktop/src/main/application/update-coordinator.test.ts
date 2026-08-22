import { describe, expect, it, vi } from "vitest";

import {
  aboutUpdateSnapshotSchema,
  type AboutUpdateSnapshot,
} from "../../contracts/about.js";
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
      event: { type: "update-downloaded" },
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
      receiveEvent?.(event);

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
      schemaVersion: 1,
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
