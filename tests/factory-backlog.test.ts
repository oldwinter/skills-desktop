import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  gatePlanFor,
  nextQueuedItem,
  parseBacklog,
  readBacklog,
  transitionItem,
  validateBacklog,
  writeBacklog,
} from "../scripts/factory/backlog.mjs";

function validBacklog() {
  return {
    defaults: { gates: ["fast"] },
    gateCommands: {
      fast: { argv: ["node", "-e", "process.exit(0)"], timeoutMs: 5000 },
      slow: { argv: ["node", "-e", "setTimeout(()=>{},500)"] },
    },
    items: [
      {
        acceptance: ["it works"],
        id: "SDF-010",
        kind: "code-change",
        order: 20,
        state: "queued",
        title: "second",
      },
      {
        acceptance: ["it works"],
        id: "SDF-001",
        kind: "verification",
        order: 10,
        state: "queued",
        title: "first",
      },
    ],
    schemaVersion: 1,
  };
}

describe("factory backlog validation", () => {
  it("accepts a well-formed backlog", () => {
    expect(validateBacklog(validBacklog())).toEqual([]);
  });

  it("rejects items with unknown gates, bad states, or empty acceptance", () => {
    const backlog = validBacklog();
    backlog.items[0]!.gates = ["missing-gate"];
    backlog.items[1]!.state = "done";
    backlog.items[1]!.acceptance = [];
    const problems = validateBacklog(backlog);
    expect(problems.join("\n")).toContain('unknown gate "missing-gate"');
    expect(problems.join("\n")).toContain('state must be one of');
    expect(problems.join("\n")).toContain("acceptance must be a non-empty array");
  });

  it("rejects duplicate ids and non-string gate argv entries", () => {
    const backlog = validBacklog();
    backlog.items[1]!.id = "SDF-010";
    // @ts-expect-error exercising runtime validation
    backlog.gateCommands.fast.argv = ["node", 3];
    const problems = validateBacklog(backlog);
    expect(problems.join("\n")).toContain("duplicates id");
    expect(problems.join("\n")).toContain("argv entries must be non-empty strings");
  });
});

describe("factory backlog ordering and transitions", () => {
  it("orders the next item by explicit order", () => {
    expect(nextQueuedItem(validBacklog() as never)?.id).toBe("SDF-001");
  });

  it("walks the ordered pipeline states", () => {
    const item = { id: "SDF-001", state: "queued" };
    const walk = ["claim", "implement", "review", "verify", "deliver"];
    const states = walk.map((event) => {
      const to = transitionItem(item as never, event);
      item.state = to;
      return to;
    });
    expect(states).toEqual([
      "claimed",
      "implementing",
      "reviewing",
      "verified",
      "delivered",
    ]);
  });

  it("refuses out-of-order transitions", () => {
    expect(() =>
      transitionItem({ id: "SDF-001", state: "queued" } as never, "verify"),
    ).toThrow(/cannot verify SDF-001/);
    expect(() =>
      transitionItem({ id: "SDF-001", state: "delivered" } as never, "claim"),
    ).toThrow(/cannot claim SDF-001/);
  });

  it("allows verify retries from failed and re-checks from verified", () => {
    expect(transitionItem({ id: "SDF-001", state: "failed" } as never, "verify")).toBe(
      "verified",
    );
    expect(
      transitionItem({ id: "SDF-001", state: "verifying" } as never, "verify"),
    ).toBe("verified");
    expect(transitionItem({ id: "SDF-001", state: "failed" } as never, "requeue")).toBe(
      "queued",
    );
  });
});

describe("factory backlog persistence", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "factory-backlog-"));
  });
  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("round-trips a backlog file atomically", async () => {
    const path = join(directory, "backlog.json");
    const backlog = validBacklog();
    await writeFile(path, JSON.stringify(backlog), "utf8");
    const loaded = await readBacklog(path);
    loaded.items[0]!.state = "claimed";
    await writeBacklog(path, loaded);
    const reread = JSON.parse(await readFile(path, "utf8"));
    expect(reread.items[0].state).toBe("claimed");
  });

  it("fails to parse an invalid backlog with all problems listed", async () => {
    const path = join(directory, "backlog.json");
    await writeFile(path, '{"schemaVersion":2,"items":{}}', "utf8");
    await expect(readBacklog(path)).rejects.toThrow(/schemaVersion/);
  });

  it("resolves per-item gate plans over defaults", () => {
    const backlog = validBacklog();
    backlog.items[0]!.gates = ["slow"];
    const plan = gatePlanFor(backlog.items[0] as never, backlog as never);
    expect(plan.map((gate) => gate.name)).toEqual(["slow"]);
    const fallback = gatePlanFor(backlog.items[1] as never, backlog as never);
    expect(fallback.map((gate) => gate.name)).toEqual(["fast"]);
  });
});

describe("factory backlog parsing edge cases", () => {
  it("reports invalid JSON with the origin", () => {
    expect(() => parseBacklog("{oops", "docs/factory/backlog.json")).toThrow(
      /docs\/factory\/backlog\.json is not valid JSON/,
    );
  });
});
