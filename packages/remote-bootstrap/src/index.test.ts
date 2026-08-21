import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeWireFrames,
  encodeWireFrame,
  WIRE_PROTOCOL_VERSION,
} from "@skills-desktop/skills-runtime";

import {
  describeRemoteBootstrap,
  REMOTE_BOOTSTRAP_COMMAND,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function runBootstrap(input: Uint8Array, environment: NodeJS.ProcessEnv) {
  const child = spawn("sh", ["-c", REMOTE_BOOTSTRAP_COMMAND], {
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(input);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return {
    exitCode,
    stderr: Buffer.concat(stderr).toString("utf8"),
    stdout: new Uint8Array(Buffer.concat(stdout)),
  };
}

describe("fixed Remote Bootstrap", () => {
  it.skipIf(process.platform === "win32")(
    "validates one observation and constructs only pinned npx argument arrays",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "skills-bootstrap-"));
      temporaryDirectories.push(directory);
      const executable = join(directory, "npx");
      const invocationLog = join(directory, "invocations.ndjson");
      await writeFile(
        executable,
        `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
appendFileSync(join(process.env.HOME, "invocations.ndjson"), JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
const operation = process.argv.slice(2).slice(2).join(" ");
if (operation === "--version") process.stdout.write("1.5.23\\n");
else if (operation === "list --json") process.stdout.write(JSON.stringify([{ name: "project-skill", path: "/private/project", scope: "project", agents: ["Codex"], source: null, sourceType: null, sourceUrl: null }]));
else if (operation === "list --global --json") process.stdout.write(JSON.stringify([{ name: "global-skill", path: "/private/global", scope: "global", agents: ["Codex"], source: null, sourceType: null, sourceUrl: null }]));
else process.exitCode = 2;
`,
        "utf8",
      );
      await chmod(executable, 0o700);
      const workspace = join(directory, "workspace; touch should-not-exist");
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(workspace, { recursive: true }),
      );

      const outcome = await runBootstrap(
        encodeWireFrame({
          harness: "Codex",
          operation: "observe",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "observe-1",
          type: "request",
          workspace,
        }),
        {
          HOME: directory,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(outcome).toMatchObject({ exitCode: 0, stderr: "" });
      const decoded = decodeWireFrames(outcome.stdout);
      expect(decoded).toMatchObject({
        ok: true,
        value: [
          {
            bootstrapDigest: describeRemoteBootstrap().digest,
            type: "hello",
          },
          {
            cliVersion: "1.5.23",
            requestId: "observe-1",
            type: "inventory",
          },
        ],
      });
      expect(
        (await readFile(invocationLog, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual([
        {
          args: ["--yes", "skills@1.5.23", "--version"],
          cwd: workspace,
        },
        {
          args: ["--yes", "skills@1.5.23", "list", "--json"],
          cwd: workspace,
        },
        {
          args: [
            "--yes",
            "skills@1.5.23",
            "list",
            "--global",
            "--json",
          ],
          cwd: workspace,
        },
      ]);
      expect(REMOTE_BOOTSTRAP_COMMAND).not.toContain(workspace);
      await expect(
        readFile(join(directory, "should-not-exist"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.skipIf(process.platform === "win32")(
    "returns a bounded protocol failure without invoking npx",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "skills-bootstrap-bad-"));
      temporaryDirectories.push(directory);
      const outcome = await runBootstrap(new Uint8Array([0, 0, 0, 1, 123]), {
        HOME: directory,
        PATH: process.env.PATH,
      });

      const decoded = decodeWireFrames(outcome.stdout);
      expect(decoded).toMatchObject({
        ok: true,
        value: [
          { type: "hello" },
          {
            code: "remote_protocol_violation",
            requestId: null,
            type: "failure",
          },
        ],
      });
      expect(JSON.stringify(decoded)).not.toContain("Unexpected");
    },
  );
});
