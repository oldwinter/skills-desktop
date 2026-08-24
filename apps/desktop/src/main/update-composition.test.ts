import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createElectronUpdateComposition } from "./update-composition.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("packaged Electron update composition", () => {
  it.each([
    ["darwin", "arm64"],
    ["win32", "x64"],
  ] as const)(
    "wires the packaged %s/%s runtime to persistence, scheduling, and Electron autoUpdater",
    async (platform, architecture) => {
      const userData = await mkdtemp(
        join(tmpdir(), "skills-update-composition-"),
      );
      const updater = new EventEmitter() as EventEmitter & {
        checkForUpdates: ReturnType<typeof vi.fn>;
        quitAndInstall: ReturnType<typeof vi.fn>;
        setFeedURL: ReturnType<typeof vi.fn>;
      };
      updater.checkForUpdates = vi.fn();
      updater.quitAndInstall = vi.fn();
      updater.setFeedURL = vi.fn();
      const getPath = vi.fn(() => userData);
      const getVersion = vi.fn(() => "0.1.0");
      const scheduled: Array<{
        action: () => void | Promise<void>;
        delayMs: number;
      }> = [];
      try {
        const updates = await createElectronUpdateComposition({
          app: {
            getPath,
            getVersion,
            isPackaged: true,
          },
          architecture,
          autoUpdater: updater as never,
          clock: () => new Date("2026-08-22T06:00:00.000Z"),
          diagnosticsExporter: {
            export: vi.fn(async () => "saved" as const),
          },
          id: () => "00000000-0000-4000-8000-000000000025",
          platform,
          releaseChannel: "stable",
          restartSafety: () => ({ guardReasons: [] }),
          schedule(delayMs, action) {
            scheduled.push({ action, delayMs });
            return () => undefined;
          },
        });

        expect(updates.getSnapshot()).toMatchObject({
          application: { architecture, platform, version: "0.1.0" },
          policy: { channel: "stable", mode: "automatic" },
        });
        expect(getPath).toHaveBeenCalledWith("userData");
        expect(getVersion).toHaveBeenCalledTimes(1);
        expect(scheduled[0]?.delayMs).toBe(30_000);
        await scheduled[0]?.action();
        expect(updater.setFeedURL).toHaveBeenCalledWith({
          url: `https://update.electronjs.org/oldwinter/skills-desktop/${platform}-${architecture}/0.1.0`,
        });
        expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
        await expect(
          readFile(join(userData, "updates", "check-record-v1.json"), "utf8"),
        ).resolves.toContain('"schemaVersion": 1');
        updater.emit(
          "update-downloaded",
          {},
          "notes",
          "v0.2.0",
          new Date("2026-08-22T06:00:00.000Z"),
          "https://token@example.test/update",
        );
        await vi.waitFor(() =>
          expect(updates.getSnapshot()).toMatchObject({
            candidate: {
              id: "00000000-0000-4000-8000-000000000025",
              version: "0.2.0",
            },
            state: { kind: "update-downloaded" },
          }),
        );
        await expect(
          readFile(
            join(userData, "updates", "deferred-restart-v1.json"),
            "utf8",
          ),
        ).resolves.not.toMatch(/token|example\.test|notes/i);
        expect(updater.quitAndInstall).not.toHaveBeenCalled();
        await expect(
          updates.requestRestart("00000000-0000-4000-8000-000000000099"),
        ).resolves.toBe("stale");
        expect(updater.quitAndInstall).not.toHaveBeenCalled();
        await expect(
          updates.requestRestart("00000000-0000-4000-8000-000000000025"),
        ).resolves.toBe("started");
        expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
        updates.dispose();
      } finally {
        await rm(userData, { force: true, recursive: true });
      }
    },
  );

  it.each([
    ["darwin", "arm64"],
    ["win32", "x64"],
  ] as const)(
    "keeps an unsigned %s/%s preview out of the automatic updater",
    async (platform, architecture) => {
      const userData = await mkdtemp(
        join(tmpdir(), "skills-update-preview-composition-"),
      );
      const updater = new EventEmitter() as EventEmitter & {
        checkForUpdates: ReturnType<typeof vi.fn>;
        quitAndInstall: ReturnType<typeof vi.fn>;
        setFeedURL: ReturnType<typeof vi.fn>;
      };
      updater.checkForUpdates = vi.fn();
      updater.quitAndInstall = vi.fn();
      updater.setFeedURL = vi.fn();

      try {
        const updates = await createElectronUpdateComposition({
          app: {
            getPath: () => userData,
            getVersion: () => "0.1.0",
            isPackaged: true,
          },
          architecture,
          autoUpdater: updater as never,
          platform,
          releaseChannel: "unsigned-preview",
          schedule: vi.fn(() => () => undefined),
        });

        expect(updates.getSnapshot()).toMatchObject({
          policy: { mode: "manual" },
          state: { kind: "manual" },
        });
        expect(updater.setFeedURL).not.toHaveBeenCalled();
        expect(updater.checkForUpdates).not.toHaveBeenCalled();
        updates.dispose();
      } finally {
        await rm(userData, { force: true, recursive: true });
      }
    },
  );

  it("uses the built-in scheduler and safe optional defaults", async () => {
    const userData = await mkdtemp(
      join(tmpdir(), "skills-update-defaults-composition-"),
    );
    const updater = new EventEmitter() as EventEmitter & {
      checkForUpdates: ReturnType<typeof vi.fn>;
      quitAndInstall: ReturnType<typeof vi.fn>;
      setFeedURL: ReturnType<typeof vi.fn>;
    };
    updater.checkForUpdates = vi.fn();
    updater.quitAndInstall = vi.fn();
    updater.setFeedURL = vi.fn();
    vi.useFakeTimers();

    try {
      const updates = await createElectronUpdateComposition({
        app: {
          getPath: () => userData,
          getVersion: () => "0.1.0",
          isPackaged: true,
        },
        architecture: "x64",
        autoUpdater: updater as never,
        platform: "darwin",
        releaseChannel: "stable",
      });

      expect(vi.getTimerCount()).toBe(1);
      expect(updates.getSnapshot()).toMatchObject({
        policy: { channel: "stable", mode: "automatic" },
        restart: { guardReasons: [] },
      });
      await expect(updates.exportDiagnostics()).resolves.toBe("cancelled");
      updates.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await rm(userData, { force: true, recursive: true });
    }
  });

  it("contains an unexpected scheduled-check rejection", async () => {
    const userData = await mkdtemp(
      join(tmpdir(), "skills-update-scheduler-error-"),
    );
    const updater = new EventEmitter() as EventEmitter & {
      checkForUpdates: ReturnType<typeof vi.fn>;
      quitAndInstall: ReturnType<typeof vi.fn>;
      setFeedURL: ReturnType<typeof vi.fn>;
    };
    updater.checkForUpdates = vi.fn();
    updater.quitAndInstall = vi.fn();
    updater.setFeedURL = vi.fn();
    let clockCalls = 0;
    const clock = () => {
      clockCalls += 1;
      if (clockCalls >= 3) throw new Error("clock failure");
      return new Date("2026-08-22T06:00:00.000Z");
    };
    vi.useFakeTimers();

    try {
      const updates = await createElectronUpdateComposition({
        app: {
          getPath: () => userData,
          getVersion: () => "0.1.0",
          isPackaged: true,
        },
        architecture: "x64",
        autoUpdater: updater as never,
        clock,
        platform: "darwin",
        releaseChannel: "stable",
      });

      await vi.advanceTimersByTimeAsync(30_000);
      expect(clockCalls).toBe(3);
      updates.dispose();
    } finally {
      await rm(userData, { force: true, recursive: true });
    }
  });
});
