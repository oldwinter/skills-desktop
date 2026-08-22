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
  it("exposes only bounded About status, restart intent, and diagnostic export capabilities", async () => {
    await import("./workspace.js");
    const bridge = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      readonly about: {
        exportDiagnostics(): Promise<unknown>;
        getSnapshot(): Promise<unknown>;
        requestCheck(): Promise<unknown>;
        requestRestart(candidateId: string): Promise<unknown>;
        subscribe(listener: (snapshot: unknown) => void): () => void;
      };
    };

    expect(Object.keys(bridge.about).sort()).toEqual([
      "exportDiagnostics",
      "getSnapshot",
      "requestCheck",
      "requestRestart",
      "subscribe",
    ]);
    await bridge.about.requestCheck();
    expect(electron.invoke).toHaveBeenCalledWith("about:update:check", {
      type: "update.check",
      version: 1,
    });
    await bridge.about.requestRestart(
      "00000000-0000-4000-8000-000000000025",
    );
    expect(electron.invoke).toHaveBeenCalledWith("about:update:restart", {
      candidateId: "00000000-0000-4000-8000-000000000025",
      type: "update.restart",
      version: 1,
    });
    await bridge.about.exportDiagnostics();
    expect(electron.invoke).toHaveBeenCalledWith(
      "about:release-diagnostics:export",
      { type: "release-diagnostics.export", version: 1 },
    );
  });
});
