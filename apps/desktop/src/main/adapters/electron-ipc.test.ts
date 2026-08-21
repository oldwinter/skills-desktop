import { describe, expect, it, vi } from "vitest";

import { isAuthorizedSender, registerDesktopIpc } from "./electron-ipc.js";

describe("Electron IPC sender authorization", () => {
  const endpoint = {
    expectedUrl: "skills-desktop://workspace/index.html",
    role: "workspace" as const,
    webContentsId: 17,
  };
  const sender = {
    frameUrl: "skills-desktop://workspace/index.html",
    isMainFrame: true,
    role: "workspace" as const,
    webContentsId: 17,
  };

  it("accepts only the registered main frame at its exact role URL", () => {
    expect(isAuthorizedSender(endpoint, sender)).toBe(true);
    expect(isAuthorizedSender(endpoint, { ...sender, webContentsId: 18 })).toBe(false);
    expect(isAuthorizedSender(endpoint, { ...sender, role: "review" })).toBe(false);
    expect(isAuthorizedSender(endpoint, { ...sender, isMainFrame: false })).toBe(false);
    expect(
      isAuthorizedSender(endpoint, {
        ...sender,
        frameUrl: "skills-desktop://workspace/index.html?unexpected=true",
      }),
    ).toBe(false);
  });

  it("returns bounded errors for hostile frames and invalid main output", async () => {
    const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
    const ipcMain = {
      handle(channel: string, handler: (event: never, ...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const session = {
      request: vi.fn(async () => ({
        error: {
          code: "invalid_request" as const,
          effects: "none" as const,
          message: "The request is not supported.",
          phase: "validate",
          retryable: false,
        },
        ok: false as const,
      })),
      snapshot: vi.fn(async () => ({ rawSecret: "must-not-cross-ipc" })),
      teardown: vi.fn(),
    };
    const capabilities = {
      attach: vi.fn(() => session),
      initialize: vi.fn(async () => undefined),
    };
    const registration = registerDesktopIpc({
      capabilities: capabilities as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
    });
    const mainFrame = { url: "skills-desktop://workspace/index.html" };
    const webContents = {
      id: 17,
      isDestroyed: () => false,
      mainFrame,
      send: vi.fn(),
    };
    registration.attach(webContents as never, "workspace", mainFrame.url);
    const hostileEvent = {
      sender: webContents,
      senderFrame: { url: mainFrame.url },
    };
    const authorizedEvent = { sender: webContents, senderFrame: mainFrame };

    await expect(
      handlers.get("workspace:snapshot:get")!(hostileEvent as never),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("workspace:snapshot:get")!(authorizedEvent as never),
    ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
    await expect(
      handlers.get("workspace:inventory:refresh")!(authorizedEvent as never, {
        executable: "sh",
      }),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenCalledWith({
      targetId: { executable: "sh" },
      type: "inventory.refresh",
      version: 1,
    });

    const reviewMainFrame = { url: "skills-desktop://review/index.html" };
    const reviewContents = {
      id: 18,
      isDestroyed: () => false,
      mainFrame: reviewMainFrame,
      send: vi.fn(),
    };
    registration.attach(
      reviewContents as never,
      "review",
      reviewMainFrame.url,
      "review-1",
    );
    const reviewEvent = {
      sender: reviewContents,
      senderFrame: reviewMainFrame,
    };

    await expect(
      handlers.get("review:decision:approve")!(authorizedEvent as never),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("workspace:mutation:prepare")!(
        reviewEvent as never,
        "local-target",
        { names: ["tdd"], scope: "project", type: "remove" },
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("review:decision:reject")!(reviewEvent as never),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      decision: "reject",
      type: "review.decide",
      version: 1,
    });
  });
});
