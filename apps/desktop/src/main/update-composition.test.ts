import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createElectronUpdateComposition } from "./update-composition.js";

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
        setFeedURL: ReturnType<typeof vi.fn>;
      };
      updater.checkForUpdates = vi.fn();
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
          platform,
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
        updater.emit("update-not-available");
        updates.dispose();
      } finally {
        await rm(userData, { force: true, recursive: true });
      }
    },
  );
});
