import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  interruptActiveGate,
  runGate,
} from "../scripts/factory/gates.mjs";

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

        // Past the descendant's scheduled write: nothing landed late. The
        // marker deadline is the leak witness; probing the published pid is
        // racy (zombie reaping, pid reuse under coverage load).
        await sleep(1_400);
        expect(existsSync(marker)).toBe(false);
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "escalates to SIGKILL when a descendant ignores SIGTERM",
    async () => {
      const dir = tempDir();
      const marker = join(dir, "MARKER");
      const ready = join(dir, "DESC_READY");
      // The descendant traps SIGTERM, proves readiness BEFORE any signal can
      // land, then schedules a late write only SIGKILL can prevent.
      const descendant =
        'const fs=require("fs");' +
        'process.on("SIGTERM",()=>{});' +
        `fs.writeFileSync(${JSON.stringify(ready)},"yes");` +
        `setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},"late"),2000);` +
        "setTimeout(()=>{},30000);";
      const gate =
        'const{spawn}=require("child_process");' +
        `spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"}).unref();` +
        "setTimeout(()=>{},60000);";
      try {
        const result = await runGate(
          { argv: [process.execPath, "-e", gate], name: "resistant" },
          {
            cwd: dir,
            escalationMs: 400,
            logPath: join(dir, "gate.log"),
            timeoutMs: 1_500,
          },
        );
        // The leader's close lands right after the SIGTERM (~1.5s); the
        // resolved duration must reflect the group drain, not the close.
        expect(result.durationMs).toBeGreaterThanOrEqual(1_800);
        expect(result).toMatchObject({
          drained: true,
          ok: false,
          timedOut: true,
        });
        // The descendant installed its trap and published readiness before
        // the timeout fired — this is not a startup race.
        expect(existsSync(ready)).toBe(true);
        // Past the descendant's +2s write deadline: nothing landed.
        await sleep(1_000);
        expect(existsSync(marker)).toBe(false);
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    },
  );

  // interruptActiveGate is process-lifetime (a signaled parent exits); keep
  // this last so the flag cannot leak into the other cases.
  it.runIf(process.platform !== "win32")(
    "forwards an external signal to the gate's process group",
    async () => {
      const dir = tempDir();
      const marker = join(dir, "MARKER");
      const pidFile = join(dir, "descendant.pid");
      const descendant =
        'const fs=require("fs");' +
        `fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));` +
        `setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},"late"),800);` +
        "setTimeout(()=>{},30000);";
      const gate =
        'const{spawn}=require("child_process");' +
        `const d=spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"});` +
        "d.unref();" +
        "setTimeout(()=>{},60000);";
      try {
        const pending = runGate(
          { argv: [process.execPath, "-e", gate], name: "forward" },
          { cwd: dir, logPath: join(dir, "gate.log"), timeoutMs: 30_000 },
        );
        try {
          await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), {
            interval: 25,
            timeout: 15_000,
          });
          expect(interruptActiveGate("SIGTERM")).toBe(true);
          const result = await pending;
          expect(result).toMatchObject({
            interrupted: "SIGTERM",
            ok: false,
            timedOut: false,
          });
          await sleep(1_200);
          expect(existsSync(marker)).toBe(false);
        } finally {
          // Reap the gate group if an assertion fired before the interrupt.
          if (interruptActiveGate("SIGKILL")) await pending;
        }
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    },
  );
});
