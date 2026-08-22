import { describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => ({
    error: {
      code: "internal_error",
      message: "The update request could not be completed.",
      retryable: true,
    },
    ok: false,
  })),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
  },
}));

describe("workspace preload authority", () => {
  it("exposes only read, check, and subscribe About capabilities", async () => {
    await import("./workspace.js");
    const bridge = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      readonly about: {
        getSnapshot(): Promise<unknown>;
        requestCheck(): Promise<unknown>;
        subscribe(listener: (snapshot: unknown) => void): () => void;
      };
    };

    expect(Object.keys(bridge.about).sort()).toEqual([
      "getSnapshot",
      "requestCheck",
      "subscribe",
    ]);
    await bridge.about.requestCheck();
    expect(electron.invoke).toHaveBeenCalledWith("about:update:check", {
      type: "update.check",
      version: 1,
    });
  });
});
