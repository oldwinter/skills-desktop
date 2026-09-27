import { describe, expect, it } from "vitest";

import { createSpawnGitRunner } from "./node-git-tools.js";

describe("createSpawnGitRunner", () => {
  it("returns the failed outcome when the child exits before reading large stdin", async () => {
    const runner = createSpawnGitRunner({ gitExecutable: process.execPath });

    await expect(
      runner.run({
        args: [
          "-e",
          'process.stderr.write("early exit"); process.exitCode = 23;',
        ],
        cwd: process.cwd(),
        env: {},
        stdin: new Uint8Array(8 * 1_024 * 1_024),
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({
      exitCode: 23,
      stderr: "early exit",
      stdout: "",
    });
  });
});
