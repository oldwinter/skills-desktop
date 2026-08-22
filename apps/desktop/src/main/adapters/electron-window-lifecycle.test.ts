import { describe, expect, it, vi } from "vitest";

import { onWindowClosed } from "./electron-window-lifecycle.js";

describe("Electron window lifecycle", () => {
  it("captures the WebContents id before Electron destroys it", () => {
    let closed: (() => void) | undefined;
    let destroyed = false;
    const window = {
      get webContents() {
        if (destroyed) throw new TypeError("Object has been destroyed");
        return { id: 42 };
      },
      once(event: "closed", listener: () => void) {
        expect(event).toBe("closed");
        closed = listener;
      },
    };
    const handleClosed = vi.fn();

    onWindowClosed(window, handleClosed);
    destroyed = true;

    expect(() => closed?.()).not.toThrow();
    expect(handleClosed).toHaveBeenCalledWith(42);
  });
});
