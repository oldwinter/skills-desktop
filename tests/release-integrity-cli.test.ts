import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitReleaseOutputs,
  parseReleaseIntegrityOptions,
  readReleaseJson,
  releaseContext,
  releaseIntegrityUsage,
  runReleaseIntegrityCommand,
} from "../scripts/release/release-integrity-cli.mjs";

let dir: string;

async function makeTempDir() {
  dir = await mkdtemp(join(tmpdir(), "release-cli-"));
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (dir !== undefined) await rm(dir, { force: true, recursive: true });
});

describe("parseReleaseIntegrityOptions", () => {
  const allowed = ["--alpha", "--beta"];

  it("maps fixed option pairs to their values", () => {
    expect(
      parseReleaseIntegrityOptions(["--alpha", "1", "--beta", "2"], allowed),
    ).toEqual({ "--alpha": "1", "--beta": "2" });
  });

  it("rejects an unknown argument", () => {
    expect(() =>
      parseReleaseIntegrityOptions(["--alpha", "1", "--beta", "2", "--gamma", "3"], allowed),
    ).toThrow("Unknown release integrity argument: --gamma");
  });

  it("rejects a missing value and a flag-shaped value", () => {
    expect(() => parseReleaseIntegrityOptions(["--alpha"], allowed)).toThrow(
      "Invalid release integrity argument: --alpha",
    );
    expect(() =>
      parseReleaseIntegrityOptions(["--alpha", "--beta", "--beta", "2"], allowed),
    ).toThrow("Invalid release integrity argument: --alpha");
  });

  it.each(["a\0b", "a\rb", "a\nb"])("rejects control characters in %j", (value) => {
    expect(() =>
      parseReleaseIntegrityOptions(["--alpha", value, "--beta", "2"], allowed),
    ).toThrow("Invalid release integrity argument: --alpha");
  });

  it("rejects a duplicated argument", () => {
    expect(() =>
      parseReleaseIntegrityOptions(["--alpha", "1", "--alpha", "2"], allowed),
    ).toThrow("Duplicate release integrity argument: --alpha");
  });

  it("rejects a missing required argument", () => {
    expect(() => parseReleaseIntegrityOptions(["--alpha", "1"], allowed)).toThrow(
      "Missing release integrity argument: --beta",
    );
  });
});

describe("releaseContext", () => {
  it("maps CI options to the release context fields", () => {
    expect(
      releaseContext({
        "--repository": "owner/repo",
        "--source-commit": "abc123",
        "--workflow-event": "push",
        "--workflow-name": "Verify",
        "--workflow-run-attempt": "2",
        "--workflow-run-id": "42",
      }),
    ).toEqual({
      repository: "owner/repo",
      sourceCommit: "abc123",
      workflowEvent: "push",
      workflowName: "Verify",
      workflowRunAttempt: "2",
      workflowRunId: "42",
    });
  });
});

describe("emitReleaseOutputs", () => {
  it("writes nothing when GITHUB_OUTPUT is unset", async () => {
    const append = vi.fn();
    await emitReleaseOutputs({ one: "1" }, { append, outputPath: undefined });
    expect(append).not.toHaveBeenCalled();
  });

  it("appends single-line values and multiline heredocs", async () => {
    const chunks: string[] = [];
    await emitReleaseOutputs(
      { "release-tag": "v1.2.3", notes: "line1\nline2" },
      { append: async (_path, text) => chunks.push(text), outputPath: "/tmp/out" },
    );
    expect(chunks).toEqual([
      "release-tag=v1.2.3\nnotes<<SKILLS_DESKTOP_NOTES_EOF\nline1\nline2\nSKILLS_DESKTOP_NOTES_EOF\n",
    ]);
  });

  it("rejects carriage returns and delimiter collisions", async () => {
    await expect(
      emitReleaseOutputs({ bad: "a\rb" }, { outputPath: "/tmp/out" }),
    ).rejects.toThrow("unsupported carriage return");
    await expect(
      emitReleaseOutputs(
        { notes: "x\nSKILLS_DESKTOP_NOTES_EOF\ny" },
        { outputPath: "/tmp/out" },
      ),
    ).rejects.toThrow("delimiter collision");
  });
});

describe("readReleaseJson", () => {
  it("parses valid JSON and wraps failures with the message", async () => {
    const root = await makeTempDir();
    const good = join(root, "good.json");
    const bad = join(root, "bad.json");
    await writeFile(good, '{"a":1}\n', "utf8");
    await writeFile(bad, "not json", "utf8");
    await expect(readReleaseJson(good, "nope")).resolves.toEqual({ a: 1 });
    await expect(readReleaseJson(bad, "nope")).rejects.toThrow("nope");
    await expect(readReleaseJson(join(root, "missing.json"), "nope")).rejects.toThrow(
      "nope",
    );
  });
});

describe("runReleaseIntegrityCommand", () => {
  it("prints usage for help flags and no command", async () => {
    for (const argv of [[], ["--help"], ["-h"], ["help"]]) {
      const written: string[] = [];
      const result = await runReleaseIntegrityCommand(argv, {
        writeOutput: (value) => written.push(value),
      });
      expect(result).toBeUndefined();
      expect(written.join("")).toContain("Usage: node scripts/release/release-integrity-cli.mjs");
    }
  });

  it("rejects an unknown command", async () => {
    await expect(
      runReleaseIntegrityCommand(["frobnicate"], { writeOutput: () => {} }),
    ).rejects.toThrow("Unknown release integrity command: frobnicate");
  });

  it("dispatches the named command and prints its JSON result", async () => {
    const written: string[] = [];
    const handlers = new Map([["echo", async (argv: string[]) => ({ argv })]]);
    const result = await runReleaseIntegrityCommand(["echo", "--a", "1"], {
      commandHandlers: handlers,
      writeOutput: (value) => written.push(value),
    });
    expect(result).toEqual({ argv: ["--a", "1"] });
    expect(written).toEqual(['{"argv":["--a","1"]}\n']);
  });
});

describe("releaseIntegrityUsage", () => {
  it("lists the registered commands sorted", () => {
    const usage = releaseIntegrityUsage(new Map([["b", async () => {}], ["a", async () => {}]]));
    expect(usage.indexOf("  a")).toBeLessThan(usage.indexOf("  b"));
    expect(usage).toContain("--option value");
  });
});

describe("validate-tag", () => {
  async function writePackageFiles(version: string, lockVersion = version) {
    const root = await makeTempDir();
    const paths: Record<string, string> = {};
    for (const name of ["root", "desktop", "remote", "runtime"]) {
      const path = join(root, `${name}.json`);
      await writeFile(path, `${JSON.stringify({ name, version })}\n`, "utf8");
      paths[name] = path;
    }
    const lock = join(root, "package-lock.json");
    await writeFile(
      lock,
      `${JSON.stringify({
        version: lockVersion,
        packages: {
          "apps/desktop": { version: lockVersion },
          "packages/remote-bootstrap": { version: lockVersion },
          "packages/skills-runtime": { version: lockVersion },
        },
      })}\n`,
      "utf8",
    );
    paths.lock = lock;
    return paths;
  }

  function tagArgv(paths: Record<string, string>, sourceRef: string) {
    return [
      "--desktop-package", paths.desktop,
      "--package-lock", paths.lock,
      "--remote-bootstrap-package", paths.remote,
      "--root-package", paths.root,
      "--skills-runtime-package", paths.runtime,
      "--source-ref", sourceRef,
    ];
  }

  it("verifies matching package versions and emits the tag", async () => {
    const paths = await writePackageFiles("9.9.9");
    const outputPath = join(dir, "github-output");
    vi.stubEnv("GITHUB_OUTPUT", outputPath);
    const written: string[] = [];
    const result = await runReleaseIntegrityCommand(
      ["validate-tag", ...tagArgv(paths, "refs/tags/v9.9.9")],
      { writeOutput: (value) => written.push(value) },
    );
    expect(result).toEqual({ tag: "v9.9.9", version: "9.9.9" });
    const { readFile } = await import("node:fs/promises");
    await expect(readFile(outputPath, "utf8")).resolves.toContain("release-tag=v9.9.9");
  });

  it("fails closed when a package version diverges from the tag", async () => {
    const paths = await writePackageFiles("9.9.9", "9.9.8");
    await expect(
      runReleaseIntegrityCommand(
        ["validate-tag", ...tagArgv(paths, "refs/tags/v9.9.9")],
        { writeOutput: () => {} },
      ),
    ).rejects.toThrow("Unsigned preview tag must match every package version");
  });

  it("fails closed on an unreadable package file", async () => {
    const paths = await writePackageFiles("9.9.9");
    await expect(
      runReleaseIntegrityCommand(
        ["validate-tag", ...tagArgv({ ...paths, desktop: join(dir, "missing.json") }, "refs/tags/v9.9.9")],
        { writeOutput: () => {} },
      ),
    ).rejects.toThrow("Desktop package metadata is invalid.");
  });
});
