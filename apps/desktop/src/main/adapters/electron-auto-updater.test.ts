import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { createElectronUpdateAdapter } from "./electron-auto-updater.js";

describe("Electron autoUpdater adapter", () => {
  it("maps one main-owned check lifecycle and installs only on an explicit adapter call", () => {
    const updater = new EventEmitter() as EventEmitter & {
      checkForUpdates: ReturnType<typeof vi.fn>;
      quitAndInstall: ReturnType<typeof vi.fn>;
      setFeedURL: ReturnType<typeof vi.fn>;
    };
    updater.checkForUpdates = vi.fn();
    updater.quitAndInstall = vi.fn();
    updater.setFeedURL = vi.fn();
    const adapter = createElectronUpdateAdapter(updater as never);
    const events: string[] = [];

    adapter.checkForUpdates({
      feedUrl:
        "https://update.electronjs.org/oldwinter/skills-desktop/win32-x64/0.1.0",
      onEvent: (event) => events.push(event.type),
    });
    updater.emit("checking-for-update");
    updater.emit("update-available");
    updater.emit("update-not-available");
    updater.emit("checking-for-update");

    expect(updater.setFeedURL).toHaveBeenCalledWith({
      url: "https://update.electronjs.org/oldwinter/skills-desktop/win32-x64/0.1.0",
    });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      "checking",
      "update-available",
      "update-not-available",
    ]);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    adapter.restartAndInstall();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.listenerCount("error")).toBe(0);
  });

  it.each([
    ["checking-for-update", "checking", false],
    ["update-available", "update-available", false],
    ["update-downloaded", "update-downloaded", true],
    ["update-not-available", "update-not-available", true],
    ["error", "error", true],
  ] as const)(
    "maps Electron %s to the closed %s event",
    (electronEvent, expectedEvent, terminal) => {
      const updater = new EventEmitter() as EventEmitter & {
        checkForUpdates: ReturnType<typeof vi.fn>;
        setFeedURL: ReturnType<typeof vi.fn>;
      };
      updater.checkForUpdates = vi.fn();
      updater.setFeedURL = vi.fn();
      const events: Array<{ candidateVersion?: string; type: string }> = [];

      createElectronUpdateAdapter(updater as never).checkForUpdates({
        feedUrl:
          "https://update.electronjs.org/oldwinter/skills-desktop/win32-x64/0.1.0",
        onEvent: (event) => events.push(event),
      });
      if (electronEvent === "update-downloaded") {
        updater.emit(
          electronEvent,
          {},
          "SECRET_RELEASE_NOTES",
          "v0.2.0",
          new Date("2026-08-22T06:00:00.000Z"),
          "https://token@example.test/update",
        );
      } else updater.emit(electronEvent, new Error("must-not-cross-adapter"));

      expect(events).toEqual([
        electronEvent === "update-downloaded"
          ? { candidateVersion: "0.2.0", type: expectedEvent }
          : { type: expectedEvent },
      ]);
      expect(JSON.stringify(events)).not.toMatch(/SECRET|token|example\.test/i);
      expect(updater.listenerCount("error")).toBe(terminal ? 0 : 1);
    },
  );

  it("fails closed on an unbounded release name", () => {
    const updater = new EventEmitter() as EventEmitter & {
      checkForUpdates: ReturnType<typeof vi.fn>;
      quitAndInstall: ReturnType<typeof vi.fn>;
      setFeedURL: ReturnType<typeof vi.fn>;
    };
    updater.checkForUpdates = vi.fn();
    updater.quitAndInstall = vi.fn();
    updater.setFeedURL = vi.fn();
    const events: string[] = [];

    createElectronUpdateAdapter(updater as never).checkForUpdates({
      feedUrl:
        "https://update.electronjs.org/oldwinter/skills-desktop/win32-x64/0.1.0",
      onEvent: (event) => events.push(event.type),
    });
    updater.emit(
      "update-downloaded",
      {},
      "notes",
      "0.2.0 /SECRET_PATH --shell",
      new Date(),
      "https://attacker.invalid",
    );

    expect(events).toEqual(["error"]);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
