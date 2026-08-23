import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  once: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke, once: electron.once },
}));

const requestError = {
  error: {
    code: "internal_error",
    effects: "none",
    message: "The review request could not be completed.",
    phase: "review",
    retryable: true,
  },
  ok: false,
} as const;

async function loadBridge() {
  vi.resetModules();
  await import("./review.js");
  return electron.exposeInMainWorld.mock.calls.at(-1)?.[1] as {
    approve(): Promise<unknown>;
    getReview(): Promise<unknown>;
    reject(): Promise<unknown>;
  };
}

describe("review preload authority", () => {
  beforeEach(() => {
    electron.exposeInMainWorld.mockClear();
    electron.invoke.mockReset();
    electron.invoke.mockResolvedValue(requestError);
    electron.once.mockReset();
    electron.once.mockImplementation(
      (_channel: string, listener: (event: unknown, value: unknown) => void) =>
        listener({}, "review-attachment-epoch"),
    );
  });

  it("exposes only approve, review snapshot, and reject capabilities", async () => {
    const bridge = await loadBridge();

    expect(Object.keys(bridge).sort()).toEqual([
      "approve",
      "getReview",
      "reject",
    ]);
    await bridge.approve();
    await bridge.getReview();
    await bridge.reject();

    expect(electron.invoke.mock.calls).toEqual([
      ["review:decision:approve", "review-attachment-epoch"],
      ["review:snapshot:get", "review-attachment-epoch"],
      ["review:decision:reject", "review-attachment-epoch"],
    ]);
  });

  it("keeps the attachment epoch private and rejects an invalid delivery", async () => {
    electron.once.mockImplementationOnce(
      (_channel: string, listener: (event: unknown, value: unknown) => void) =>
        listener({}, ""),
    );
    const bridge = await loadBridge();

    expect(Object.keys(bridge)).not.toContain("attachmentEpoch");
    await expect(bridge.approve()).rejects.toThrow(
      "Invalid desktop attachment epoch.",
    );
    expect(electron.invoke).not.toHaveBeenCalled();
  });

  it("rejects malformed decisions and snapshots at the preload boundary", async () => {
    const bridge = await loadBridge();
    electron.invoke.mockResolvedValue({ ok: true });

    await expect(bridge.approve()).rejects.toThrow();
    await expect(bridge.getReview()).rejects.toThrow();
    await expect(bridge.reject()).rejects.toThrow();
  });
});
