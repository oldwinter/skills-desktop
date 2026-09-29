import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runFactory } from "../scripts/factory/factory.mjs";
import { readLedger } from "../scripts/factory/run-store.mjs";

const execFileAsync = promisify(execFile);

// Every run() drives git plus one or more gate subprocesses; the default
// 5s test timeout is too tight under coverage instrumentation.
vi.setConfig({ testTimeout: 20_000 });

function backlogWith(gates: Record<string, string[]>, items: object[]) {
  return {
    defaults: { gates: Object.keys(gates) },
    gateCommands: Object.fromEntries(
      Object.entries(gates).map(([name, argv]) => [name, { argv, timeoutMs: 15_000 }]),
    ),
    items,
    schemaVersion: 1,
  };
}

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    acceptance: ["acceptance is met"],
    id,
    kind: "code-change",
    order: 10,
    state: "queued",
    title: `title for ${id}`,
    ...extra,
  };
}

describe("factory pipeline", () => {
  let root: string;
  let repoDir: string;
  let backlogPath: string;
  let env: NodeJS.ProcessEnv;

  async function writeBacklogFile(backlog: unknown) {
    await writeFile(backlogPath, `${JSON.stringify(backlog)}\n`, "utf8");
  }

  async function readBacklogFile() {
    return JSON.parse(await readFile(backlogPath, "utf8"));
  }

  async function run(...args: string[]) {
    return runFactory(args, env);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "factory-rt-"));
    repoDir = await mkdtemp(join(tmpdir(), "factory-repo-"));
    await execFileAsync("git", ["-C", repoDir, "init", "-q"]);
    await execFileAsync("git", [
      "-C", repoDir, "-c", "user.email=factory@test", "-c", "user.name=factory",
      "commit", "-q", "--allow-empty", "-m", "init",
    ]);
    backlogPath = join(root, "backlog.json");
    env = {
      ...process.env,
      SKILLS_DESKTOP_FACTORY_BACKLOG: backlogPath,
      SKILLS_DESKTOP_FACTORY_CWD: repoDir,
      SKILLS_DESKTOP_FACTORY_ROOT: join(root, "rt"),
    };
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
    await rm(repoDir, { force: true, recursive: true });
  });

  it("walks one item through the whole pipeline and records evidence", async () => {
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [item("SDF-001")]),
    );

    expect((await run("claim", "SDF-001")).code).toBe(0);
    expect((await run("implement", "SDF-001")).code).toBe(0);
    expect((await run("review", "SDF-001")).code).toBe(0);
    const verify = await run("verify", "SDF-001");
    expect(verify.code).toBe(0);
    expect(verify.lines.join("\n")).toContain("pass pass");
    const deliver = await run("deliver", "SDF-001");
    expect(deliver.code).toBe(0);
    expect(deliver.lines.join("\n")).toContain("verified -> delivered");

    const backlog = await readBacklogFile();
    expect(backlog.items[0].state).toBe("delivered");

    const ledger = await readLedger(join(root, "rt"), "SDF-001");
    expect(ledger?.attempts).toHaveLength(1);
    expect(ledger?.attempts[0].ok).toBe(true);
    expect(ledger?.deliveries).toHaveLength(1);
    const report = await readFile(ledger!.deliveries[0].report, "utf8");
    expect(report).toContain("SDF-001");
    expect(report).toContain("acceptance is met");

    const progress = await readFile(join(root, "rt", "progress.jsonl"), "utf8");
    const events = progress
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).event);
    expect(events).toEqual([
      "claim",
      "implement",
      "review",
      "review-evidence",
      "verify-start",
      "verify-end",
      "deliver",
    ]);
  });

  it("propagates a failed gate without recording success, then retries", async () => {
    await writeBacklogFile(
      backlogWith(
        { flaky: [process.execPath, "-e", "process.exit(3)"] },
        [item("SDF-002")],
      ),
    );
    await run("claim", "SDF-002");
    await run("review", "SDF-002");
    const verify = await run("verify", "SDF-002");
    expect(verify.code).toBe(1);
    expect((await readBacklogFile()).items[0].state).toBe("failed");

    const ledger = await readLedger(join(root, "rt"), "SDF-002");
    expect(ledger?.attempts[0].ok).toBe(false);
    expect(ledger?.attempts[0].results[0]).toMatchObject({
      exitCode: 3,
      ok: false,
    });
    expect(existsSync(join(root, "rt", "deliveries"))).toBe(false);
    await expect(run("deliver", "SDF-002")).resolves.toMatchObject({ code: 2 });

    // Operator fixes the cause, then retries: same item, second attempt.
    await writeBacklogFile(
      backlogWith({ flaky: [process.execPath, "-e", "process.exit(0)"] }, [
        item("SDF-002", { state: "failed" }),
      ]),
    );
    const retry = await run("verify", "SDF-002");
    expect(retry.code).toBe(0);
    expect((await readBacklogFile()).items[0].state).toBe("verified");
    const retried = await readLedger(join(root, "rt"), "SDF-002");
    expect(retried?.attempts).toHaveLength(2);
  });

  it("keeps verify and deliver idempotent for repeated calls", async () => {
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [item("SDF-003")]),
    );
    await run("claim", "SDF-003");
    await run("review", "SDF-003");
    expect((await run("verify", "SDF-003")).code).toBe(0);
    expect((await run("verify", "SDF-003")).code).toBe(0);
    expect((await run("deliver", "SDF-003")).code).toBe(0);
    const second = await run("deliver", "SDF-003");
    expect(second.code).toBe(0);
    expect(second.lines.join("\n")).toContain("already delivered");
    const ledger = await readLedger(join(root, "rt"), "SDF-003");
    expect(ledger?.attempts).toHaveLength(2);
    expect(ledger?.deliveries).toHaveLength(1);
  });

  it("refuses delivery when HEAD moved after the passing verify", async () => {
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [item("SDF-004")]),
    );
    await run("claim", "SDF-004");
    await run("review", "SDF-004");
    expect((await run("verify", "SDF-004")).code).toBe(0);
    await execFileAsync("git", [
      "-C", repoDir, "-c", "user.email=factory@test", "-c", "user.name=factory",
      "commit", "-q", "--allow-empty", "-m", "moved",
    ]);
    const deliver = await run("deliver", "SDF-004");
    expect(deliver.code).toBe(2);
    expect(deliver.lines.join("\n")).toContain("Re-run verify");
    expect((await readBacklogFile()).items[0].state).toBe("verified");
  });

  it("refuses delivery when tracked source changed after the passing verify", async () => {
    await writeFile(join(repoDir, "product.txt"), "verified bytes\n", "utf8");
    await execFileAsync("git", ["-C", repoDir, "add", "product.txt"]);
    await execFileAsync("git", [
      "-C", repoDir, "-c", "user.email=factory@test", "-c", "user.name=factory",
      "commit", "-qm", "add product",
    ]);
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [item("SDF-013")]),
    );
    await run("claim", "SDF-013");
    await run("review", "SDF-013");
    expect((await run("verify", "SDF-013")).code).toBe(0);

    // Reproduced probe: HEAD is unchanged, but the verified bytes moved.
    await writeFile(join(repoDir, "product.txt"), "tampered bytes\n", "utf8");
    const deliver = await run("deliver", "SDF-013");
    expect(deliver.code).toBe(2);
    expect(deliver.lines.join("\n")).toContain("source changed");
    expect((await readBacklogFile()).items[0].state).toBe("verified");

    // Committing the change also fails freshness; only re-verification binds.
    await execFileAsync("git", [
      "-C", repoDir, "-c", "user.email=factory@test", "-c", "user.name=factory",
      "commit", "-qam", "tamper",
    ]);
    expect((await run("deliver", "SDF-013")).code).toBe(2);
    expect((await run("verify", "SDF-013")).code).toBe(0);
    expect((await run("deliver", "SDF-013")).code).toBe(0);
  });

  it("refuses delivery when an untracked file appears after the passing verify", async () => {
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [item("SDF-014")]),
    );
    await run("claim", "SDF-014");
    await run("review", "SDF-014");
    expect((await run("verify", "SDF-014")).code).toBe(0);

    await writeFile(join(repoDir, "surprise.txt"), "unverified\n", "utf8");
    const deliver = await run("deliver", "SDF-014");
    expect(deliver.code).toBe(2);
    expect(deliver.lines.join("\n")).toContain("source changed");

    await execFileAsync("git", ["-C", repoDir, "clean", "-fq"]);
    expect((await run("deliver", "SDF-014")).code).toBe(0);
  });

  it("refuses delivery when the gate plan changed after the passing verify", async () => {
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [item("SDF-015")]),
    );
    await run("claim", "SDF-015");
    await run("review", "SDF-015");
    expect((await run("verify", "SDF-015")).code).toBe(0);

    // Reproduced probe: rewrite the gate argv to exit 1 while preserving the
    // verified state; the resolved plan digest must reject the delivery.
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(1)"] }, [
        item("SDF-015", { state: "verified" }),
      ]),
    );
    const deliver = await run("deliver", "SDF-015");
    expect(deliver.code).toBe(2);
    expect(deliver.lines.join("\n")).toContain("gate plan changed");

    // Restoring the verified plan restores delivery; verification is bound.
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [
        item("SDF-015", { state: "verified" }),
      ]),
    );
    expect((await run("deliver", "SDF-015")).code).toBe(0);
  });

  it("records honest partial coverage instead of verifying on a gate subset", async () => {
    await writeBacklogFile(
      backlogWith(
        {
          pass: [process.execPath, "-e", "process.exit(0)"],
          strict: [process.execPath, "-e", "process.exit(1)"],
        },
        [item("SDF-016", { gates: ["pass", "strict"] })],
      ),
    );
    await run("claim", "SDF-016");
    await run("review", "SDF-016");

    // Reproduced probe: --gates pass alone must not verify the item while the
    // required strict gate never ran.
    const partial = await run("verify", "SDF-016", "--gates", "pass");
    expect(partial.code).toBe(1);
    expect(partial.lines.join("\n")).toContain("partial");
    expect(partial.lines.join("\n")).toContain("strict");
    expect((await readBacklogFile()).items[0].state).toBe("failed");
    const ledger = await readLedger(join(root, "rt"), "SDF-016");
    expect(ledger?.attempts[0]).toMatchObject({
      complete: false,
      missing: ["strict"],
      ok: true,
      passed: false,
    });
    expect((await run("deliver", "SDF-016")).code).toBe(2);

    // A full run still fails honestly on the strict gate.
    const full = await run("verify", "SDF-016");
    expect(full.code).toBe(1);
    expect((await readBacklogFile()).items[0].state).toBe("failed");
    expect((await run("deliver", "SDF-016")).code).toBe(2);

    // Recovery: fixing the gate lets the full plan verify and deliver.
    await writeBacklogFile(
      backlogWith(
        {
          pass: [process.execPath, "-e", "process.exit(0)"],
          strict: [process.execPath, "-e", "process.exit(0)"],
        },
        [item("SDF-016", { gates: ["pass", "strict"], state: "failed" })],
      ),
    );
    expect((await run("verify", "SDF-016")).code).toBe(0);
    expect((await run("deliver", "SDF-016")).code).toBe(0);
  });

  it("delivers cleanly when the tracked backlog file lives inside the repository", async () => {
    // Real-repo topology: docs/factory/backlog.json is tracked, so every
    // state transition rewrites it between verify and deliver. The source
    // digest must exclude it; acceptance and gate-plan changes still bind.
    backlogPath = join(repoDir, "docs", "factory", "backlog.json");
    await mkdir(join(repoDir, "docs", "factory"), { recursive: true });
    env = { ...env, SKILLS_DESKTOP_FACTORY_BACKLOG: backlogPath };
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [item("SDF-017")]),
    );
    await execFileAsync("git", ["-C", repoDir, "add", "docs/factory/backlog.json"]);
    await execFileAsync("git", [
      "-C", repoDir, "-c", "user.email=factory@test", "-c", "user.name=factory",
      "commit", "-qm", "track backlog",
    ]);

    expect((await run("claim", "SDF-017")).code).toBe(0);
    expect((await run("implement", "SDF-017")).code).toBe(0);
    expect((await run("review", "SDF-017")).code).toBe(0);
    expect((await run("verify", "SDF-017")).code).toBe(0);
    expect((await run("deliver", "SDF-017")).code).toBe(0);
    expect((await readBacklogFile()).items[0].state).toBe("delivered");
  });

  it("stops the plan at the first failing gate", async () => {
    await writeBacklogFile(
      backlogWith(
        {
          bad: [process.execPath, "-e", "process.exit(1)"],
          never: [process.execPath, "-e", "process.exit(0)"],
        },
        [item("SDF-005", { gates: ["bad", "never"] })],
      ),
    );
    await run("claim", "SDF-005");
    await run("review", "SDF-005");
    const verify = await run("verify", "SDF-005");
    expect(verify.code).toBe(1);
    const ledger = await readLedger(join(root, "rt"), "SDF-005");
    expect(ledger?.attempts[0].results.map((r: { name: string }) => r.name)).toEqual([
      "bad",
    ]);
  });

  it("prints a dry-run plan without writing state or running gates", async () => {
    await writeBacklogFile(
      backlogWith({ noisy: [process.execPath, "-e", "process.exit(99)"] }, [
        item("SDF-006"),
      ]),
    );
    const dry = await run("run", "SDF-006", "--dry-run");
    expect(dry.code).toBe(0);
    const text = dry.lines.join("\n");
    expect(text).toContain("dry run for SDF-006");
    expect(text).toContain("no state was written");
    expect((await readBacklogFile()).items[0].state).toBe("queued");
    expect(existsSync(join(root, "rt", "runs", "SDF-006"))).toBe(false);
  });

  it("runs the local path end-to-end via run <id>", async () => {
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [
        item("SDF-007"),
        item("SDF-008", { order: 20 }),
      ]),
    );
    expect((await run("next")).lines[0]).toContain("SDF-007");
    const runAll = await run("run", "SDF-007");
    expect(runAll.code).toBe(0);
    expect(runAll.lines.join("\n")).toContain("delivered");
    expect((await readBacklogFile()).items[0].state).toBe("delivered");
    // The other queued item is untouched.
    expect((await readBacklogFile()).items[1].state).toBe("queued");
  });

  it("captures review evidence of the working tree diff", async () => {
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [item("SDF-009")]),
    );
    await run("claim", "SDF-009");
    await writeFile(join(repoDir, "change.txt"), "evidence\n", "utf8");
    const review = await run("review", "SDF-009");
    expect(review.code).toBe(0);
    const status = await readFile(
      join(root, "rt", "runs", "SDF-009", "review-1.status"),
      "utf8",
    );
    expect(status).toContain("change.txt");
    const untracked = await readFile(
      join(root, "rt", "runs", "SDF-009", "review-1.untracked"),
      "utf8",
    );
    expect(untracked).toContain("change.txt");
  });

  it("regenerates status.md summarizing queue and last verify", async () => {
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [item("SDF-010")]),
    );
    await run("claim", "SDF-010");
    await run("review", "SDF-010");
    await run("verify", "SDF-010");
    const status = await run("status");
    expect(status.code).toBe(0);
    const text = await readFile(join(root, "rt", "status.md"), "utf8");
    expect(text).toContain("SDF-010");
    expect(text).toContain("last verify attempt 1 passed");
  });

  it("resumes an item left in verifying after an interrupted run", async () => {
    await writeBacklogFile(
      backlogWith({ pass: [process.execPath, "-e", "process.exit(0)"] }, [
        item("SDF-011", { state: "verifying" }),
      ]),
    );
    const verify = await run("verify", "SDF-011");
    expect(verify.code).toBe(0);
    expect((await readBacklogFile()).items[0].state).toBe("verified");
  });

  it("returns a helpful error for unknown items and bad commands", async () => {
    await writeBacklogFile(backlogWith({ pass: [process.execPath, "-e", "true"] }, [item("SDF-012")]));
    expect((await run("claim", "SDF-999")).code).toBe(2);
    const bogus = await run("frobnicate");
    expect(bogus.code).toBe(2);
    expect(bogus.lines.join("\n")).toContain("unknown command");
  });

  // Drives the real CLI as a child process: the signal is delivered by the
  // OS to the factory PID, exercising the full parent-signal path.
  async function signalCase(signal: "SIGINT" | "SIGTERM", exitCode: number) {
    const marker = join(root, "MARKER");
    const pidFile = join(root, "descendant.pid");
    const gateStarted = join(root, "GATE_STARTED");
    const descendant =
      'const fs=require("fs");' +
      `fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));` +
      `setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},"late"),800);` +
      "setTimeout(()=>{},30000);";
    const gate =
      'const fs=require("fs");const{spawn}=require("child_process");' +
      `fs.writeFileSync(${JSON.stringify(gateStarted)},"1");` +
      `spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"}).unref();` +
      "setTimeout(()=>{},60000);";
    await writeBacklogFile(
      backlogWith({ lifecycle: [process.execPath, "-e", gate] }, [
        item("SDF-013", { state: "reviewing" }),
      ]),
    );
    const factoryPath = fileURLToPath(new URL("../scripts/factory/factory.mjs", import.meta.url));
    const child = spawn(process.execPath, [factoryPath, "verify", "SDF-013"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout!.on("data", (chunk) => (output += chunk));
    child.stderr!.on("data", (chunk) => (output += chunk));
    try {
      // The descendant publishes its own pid the moment it joins the gate's
      // process group; gateStarted alone races the spawn and would let the
      // group signal land before the descendant exists.
      await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), {
        interval: 25,
        timeout: 15_000,
      });
      child.kill(signal);
      const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
      expect(code).toBe(exitCode);
      expect(output).toContain(`interrupted by ${signal}`);
      expect((await readBacklogFile()).items[0].state).toBe("failed");
      const ledger = await readLedger(join(root, "rt"), "SDF-013");
      expect(ledger?.attempts.at(-1)).toMatchObject({
        interrupted: signal,
        ok: false,
        passed: false,
      });
      // The delayed marker is the leak witness: the descendant was scheduled
      // to write at +800ms, so absence past the deadline proves the group
      // died. A pid-liveness probe is racy (zombie reaping, pid reuse under
      // coverage load) and adds nothing beyond this behavioral contract.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }

  it.runIf(process.platform !== "win32")(
    "forwards SIGINT to the gate group and fails the item instead of leaking",
    async () => {
      await signalCase("SIGINT", 130);
    },
  );

  it.runIf(process.platform !== "win32")(
    "forwards SIGTERM to the gate group and fails the item instead of leaking",
    async () => {
      await signalCase("SIGTERM", 143);
    },
  );

  it.runIf(process.platform !== "win32")(
    "waits out the escalation window when a descendant ignores SIGTERM",
    async () => {
      const marker = join(root, "MARKER");
      const ready = join(root, "DESC_READY");
      // The descendant traps SIGTERM, proves readiness before cancellation,
      // then schedules a write past the 5s SIGKILL grace window — only a
      // completed escalation prevents it.
      const descendant =
        'const fs=require("fs");' +
        'process.on("SIGTERM",()=>{});' +
        `fs.writeFileSync(${JSON.stringify(ready)},"yes");` +
        `setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},"late"),9000);` +
        "setTimeout(()=>{},30000);";
      const gate =
        'const{spawn}=require("child_process");' +
        `spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"}).unref();` +
        "setTimeout(()=>{},60000);";
      // The 3s timeout sits past even a slow descendant boot under coverage
      // so the TERM trap is installed before cancellation fires.
      await writeFile(
        backlogPath,
        `${JSON.stringify({
          defaults: { gates: ["lifecycle"] },
          gateCommands: {
            lifecycle: {
              argv: [process.execPath, "-e", gate],
              timeoutMs: 3_000,
            },
          },
          items: [item("SDF-014", { state: "reviewing" })],
          schemaVersion: 1,
        })}\n`,
        "utf8",
      );
      const factoryPath = fileURLToPath(new URL("../scripts/factory/factory.mjs", import.meta.url));
      const startedAt = Date.now();
      const child = spawn(process.execPath, [factoryPath, "verify", "SDF-014"], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
        const elapsed = Date.now() - startedAt;
        expect(code).toBe(1);
        // SIGTERM lands ~3s after the gate starts; the CLI must not exit
        // before the 5s escalation window plus drain completes. A resolve at
        // leader close would return in well under 6s.
        expect(elapsed).toBeGreaterThan(7_000);
        expect(existsSync(ready)).toBe(true);
        expect((await readBacklogFile()).items[0].state).toBe("failed");
        const ledger = await readLedger(join(root, "rt"), "SDF-014");
        expect(ledger?.attempts.at(-1)).toMatchObject({ ok: false, passed: false });
        // Past the descendant's +9s deadline measured from its own
        // readiness rendezvous: the killed group wrote nothing.
        const deadline = statSync(ready).mtimeMs + 9_000 + 250;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, deadline - Date.now())),
        );
        expect(existsSync(marker)).toBe(false);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    },
    30_000,
  );
});
