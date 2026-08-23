import { afterEach, describe, expect, it, vi } from "vitest";

const execFile = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFile }));

import { createWindowsProcessTreeKiller } from "./windows-process-tree.js";

describe("Windows process-tree termination", () => {
  afterEach(() => {
    execFile.mockReset();
  });

  it("resolves after taskkill confirms the process tree was terminated", async () => {
    const killTree = createWindowsProcessTreeKiller(4_000);
    const result = killTree(812);

    expect(execFile).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/pid", "812", "/t", "/f"],
      {
        shell: false,
        timeout: 4_000,
        windowsHide: true,
      },
      expect.any(Function),
    );
    const callback = execFile.mock.calls[0]?.[3] as
      | ((error: Error | null) => void)
      | undefined;
    callback?.(null);
    await expect(result).resolves.toBeUndefined();
  });

  it("rejects when taskkill reports an error", async () => {
    const killTree = createWindowsProcessTreeKiller(250);
    const result = killTree(813);
    const error = new Error("taskkill failed");
    const callback = execFile.mock.calls[0]?.[3] as
      | ((error: Error | null) => void)
      | undefined;

    callback?.(error);
    await expect(result).rejects.toBe(error);
  });
});
