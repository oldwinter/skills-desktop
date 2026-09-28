import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runFactory } from "../scripts/factory/factory.mjs";
import { readLedger } from "../scripts/factory/run-store.mjs";

const execFileAsync = promisify(execFile);

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
});
