import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runGate } from "../scripts/factory/gates.mjs";

// Gates spawn real child processes with real timers; keep the default 5s
// ceiling from masking the 400ms probe timeouts under coverage load.
vi.setConfig({ testTimeout: 15_000 });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "factory-gates-"));
}

describe("runGate cancellation semantics", () => {
  it("passes a clean exit-0 gate", async () => {
    const dir = tempDir();
    try {
      const result = await runGate(
        { argv: [process.execPath, "-e", "process.exit(0)"], name: "positive" },
        { cwd: dir, logPath: join(dir, "gate.log"), timeoutMs: 5_000 },
      );
      expect(result).toMatchObject({ exitCode: 0, ok: true, timedOut: false });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("fails a timed-out gate even when the child traps SIGTERM to exit 0", async () => {
    const dir = tempDir();
    try {
      const result = await runGate(
        {
          argv: [
            process.execPath,
            "-e",
            'process.on("SIGTERM",()=>process.exit(0));setTimeout(()=>{},60000);',
          ],
          name: "term-trap",
        },
        // 1.5s leaves room for the trap to install under coverage load; the
        // timedOut latch — not the child's exit code — decides the verdict.
        { cwd: dir, logPath: join(dir, "gate.log"), timeoutMs: 1_500 },
      );
      expect(result).toMatchObject({ ok: false, timedOut: true });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  // POSIX group kill; Windows lacks process-group signalling (child.kill only).
  it.runIf(process.platform !== "win32")(
    "terminates a gate's descendants on timeout so no late writes land",
    async () => {
      const dir = tempDir();
      const marker = join(dir, "MARKER");
      const started = join(dir, "DESC_STARTED");
      const pidFile = join(dir, "descendant.pid");
      const descendant =
        'const fs=require("fs");' +
        `fs.writeFileSync(${JSON.stringify(started)},"yes");` +
        `fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));` +
        `setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},"late"),800);` +
        "setTimeout(()=>{},30000);";
      const gate =
        'const{spawn}=require("child_process");' +
        `const d=spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"});` +
        "d.unref();" +
        "setTimeout(()=>{},60000);";
      try {
        const result = await runGate(
          { argv: [process.execPath, "-e", gate], name: "descendant" },
          { cwd: dir, logPath: join(dir, "gate.log"), timeoutMs: 400 },
        );
        expect(result).toMatchObject({ ok: false, timedOut: true });

        // Past the descendant's scheduled write: nothing landed late.
        await sleep(1_400);
        expect(existsSync(marker)).toBe(false);

        // When the descendant got far enough to publish its PID, the exact
        // PID is dead — killed with the gate's process group.
        if (existsSync(pidFile)) {
          const pid = Number(readFileSync(pidFile, "utf8"));
          expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
        }
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    },
  );
});
