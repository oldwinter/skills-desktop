import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeWireFrames,
  encodeWireFrame,
  WIRE_FRAME_ENCODER_SOURCE,
  WIRE_REQUEST_VALIDATOR_SOURCE,
  WIRE_SINGLE_FRAME_DECODER_SOURCE,
  WIRE_PROTOCOL_VERSION,
} from "@skills-desktop/skills-runtime";

import {
  describeRemoteBootstrap,
  REMOTE_BOOTSTRAP_COMMAND,
  REMOTE_BOOTSTRAP_PROGRAM,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function runBootstrap(
  input: Uint8Array,
  environment: NodeJS.ProcessEnv,
  options: { readonly keepInputOpen?: boolean } = {},
) {
  const child = spawn("sh", ["-c", REMOTE_BOOTSTRAP_COMMAND], {
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  if (options.keepInputOpen) child.stdin.write(input);
  else child.stdin.end(input);
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

async function waitForFile(path: string) {
  await new Promise<void>((resolve, reject) => {
    const watcher = watch(dirname(path));
    const timeout = setTimeout(() => {
      watcher.close();
      reject(new Error("Timed out waiting for the mutation child."));
    }, 1_000);
    const inspect = () => {
      void readFile(path, "utf8").then(
        () => {
          clearTimeout(timeout);
          watcher.close();
          resolve();
        },
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            clearTimeout(timeout);
            watcher.close();
            reject(error);
          }
        },
      );
    };
    watcher.on("change", inspect);
    watcher.on("error", reject);
    inspect();
  });
}

describe("fixed Remote Bootstrap", () => {
  it("embeds the shared Wire request validator and frame encoder", () => {
    expect(REMOTE_BOOTSTRAP_PROGRAM).toContain(WIRE_REQUEST_VALIDATOR_SOURCE);
    expect(REMOTE_BOOTSTRAP_PROGRAM).toContain(WIRE_FRAME_ENCODER_SOURCE);
    expect(REMOTE_BOOTSTRAP_PROGRAM).toContain(
      WIRE_SINGLE_FRAME_DECODER_SOURCE,
    );
  });

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
      const canonicalWorkspace = await realpath(workspace);

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
          cwd: canonicalWorkspace,
        },
        {
          args: ["--yes", "skills@1.5.23", "list", "--json"],
          cwd: canonicalWorkspace,
        },
        {
          args: ["--yes", "skills@1.5.23", "list", "--global", "--json"],
          cwd: canonicalWorkspace,
        },
      ]);
      expect(REMOTE_BOOTSTRAP_COMMAND).not.toContain(workspace);
      await expect(
        readFile(join(directory, "should-not-exist"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.skipIf(process.platform === "win32")(
    "constructs one pinned remove and atomic postflight from a normalized mutation",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-bootstrap-mutate-"),
      );
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
else if (operation === "remove project-skill --agent codex --yes") process.stdout.write("removed\\n");
else if (operation === "list --json") process.stdout.write("[]");
else if (operation === "list --global --json") process.stdout.write("[]");
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
          mutation: {
            names: ["project-skill"],
            scope: "project",
            type: "remove",
          },
          operation: "mutate",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "mutation-1",
          type: "request",
          workspace,
        }),
        {
          HOME: directory,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        },
        { keepInputOpen: true },
      );

      expect(outcome).toMatchObject({ exitCode: 0, stderr: "" });
      expect(decodeWireFrames(outcome.stdout)).toMatchObject({
        ok: true,
        value: [
          { type: "hello" },
          {
            cliVersion: "1.5.23",
            process: {
              cleanup: "confirmed",
              disposition: "completed",
              exitCode: 0,
            },
            requestId: "mutation-1",
            type: "mutation-result",
          },
        ],
      });
      expect(
        (await readFile(invocationLog, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).args),
      ).toEqual([
        ["--yes", "skills@1.5.23", "--version"],
        [
          "--yes",
          "skills@1.5.23",
          "remove",
          "project-skill",
          "--agent",
          "codex",
          "--yes",
        ],
        ["--yes", "skills@1.5.23", "list", "--json"],
        ["--yes", "skills@1.5.23", "list", "--global", "--json"],
      ]);
      expect(REMOTE_BOOTSTRAP_COMMAND).not.toContain("project-skill");
      await expect(
        readFile(join(directory, "should-not-exist"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.skipIf(process.platform === "win32")(
    "constructs only pinned add and update arguments from closed mutations",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-bootstrap-writes-"),
      );
      temporaryDirectories.push(directory);
      const executable = join(directory, "npx");
      const invocationLog = join(directory, "invocations.ndjson");
      await writeFile(
        executable,
        `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
appendFileSync(join(process.env.HOME, "invocations.ndjson"), JSON.stringify(process.argv.slice(2)) + "\\n");
const operation = process.argv.slice(2).slice(2).join(" ");
if (operation === "--version") process.stdout.write("1.5.23\\n");
else if (operation === "add https://github.com/example/skills/archive/0123456789abcdef0123456789abcdef01234567.tar.gz --skill new-skill --agent codex --global --yes") process.stdout.write("added\\n");
else if (operation === "update project-skill --project --yes") process.stdout.write("updated\\n");
else if (operation === "list --json" || operation === "list --global --json") process.stdout.write("[]");
else process.exitCode = 2;
`,
        "utf8",
      );
      await chmod(executable, 0o700);
      const environment = {
        HOME: directory,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
      };
      for (const mutation of [
        {
          names: ["new-skill"],
          scope: "global" as const,
          source: {
            revision: "0123456789abcdef0123456789abcdef01234567",
            source: "example/skills",
            sourceType: "github" as const,
          },
          type: "add" as const,
        },
        {
          names: ["project-skill"],
          scope: "project" as const,
          type: "update" as const,
        },
      ]) {
        const outcome = await runBootstrap(
          encodeWireFrame({
            harness: "Codex",
            mutation,
            operation: "mutate",
            protocolVersion: WIRE_PROTOCOL_VERSION,
            requestId: `mutation-${mutation.type}`,
            type: "request",
            workspace: directory,
          }),
          environment,
          { keepInputOpen: true },
        );
        expect(decodeWireFrames(outcome.stdout)).toMatchObject({
          ok: true,
          value: [
            { type: "hello" },
            {
              process: { cleanup: "confirmed", disposition: "completed" },
              requestId: `mutation-${mutation.type}`,
              type: "mutation-result",
            },
          ],
        });
      }

      expect(
        (await readFile(invocationLog, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual([
        ["--yes", "skills@1.5.23", "--version"],
        [
          "--yes",
          "skills@1.5.23",
          "add",
          "https://github.com/example/skills/archive/0123456789abcdef0123456789abcdef01234567.tar.gz",
          "--skill",
          "new-skill",
          "--agent",
          "codex",
          "--global",
          "--yes",
        ],
        ["--yes", "skills@1.5.23", "list", "--json"],
        ["--yes", "skills@1.5.23", "list", "--global", "--json"],
        ["--yes", "skills@1.5.23", "--version"],
        [
          "--yes",
          "skills@1.5.23",
          "update",
          "project-skill",
          "--project",
          "--yes",
        ],
        ["--yes", "skills@1.5.23", "list", "--json"],
        ["--yes", "skills@1.5.23", "list", "--global", "--json"],
      ]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "runs postflight after cleanup from an invalid in-flight cancellation",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-bootstrap-invalid-cancel-"),
      );
      temporaryDirectories.push(directory);
      const executable = join(directory, "npx");
      const invocationLog = join(directory, "invocations.ndjson");
      await writeFile(
        executable,
        `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
const operation = process.argv.slice(2).slice(2).join(" ");
appendFileSync(join(process.env.HOME, "invocations.ndjson"), JSON.stringify(operation) + "\\n");
if (operation === "--version") process.stdout.write("1.5.23\\n");
else if (operation === "remove project-skill --agent codex --yes") {
  process.on("SIGTERM", () => process.exit(143));
  setInterval(() => {}, 30_000);
}
else if (operation === "list --json" || operation === "list --global --json") process.stdout.write("[]");
else process.exitCode = 2;
`,
        "utf8",
      );
      await chmod(executable, 0o700);
      const mutation = encodeWireFrame({
        harness: "Codex",
        mutation: {
          names: ["project-skill"],
          scope: "project",
          type: "remove",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-invalid-cancel",
        type: "request",
        workspace: directory,
      });
      const mismatchedCancellation = encodeWireFrame({
        operation: "cancel",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "another-mutation",
        type: "request",
      });

      const outcome = await runBootstrap(
        new Uint8Array(
          Buffer.concat([
            Buffer.from(mutation),
            Buffer.from(mismatchedCancellation),
          ]),
        ),
        {
          HOME: directory,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        },
        { keepInputOpen: true },
      );

      expect(decodeWireFrames(outcome.stdout)).toMatchObject({
        ok: true,
        value: [
          { type: "hello" },
          {
            process: { cleanup: "confirmed", disposition: "failed" },
            requestId: "mutation-invalid-cancel",
            type: "mutation-result",
          },
        ],
      });
      expect(
        (await readFile(invocationLog, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual(["--version", "list --json", "list --global --json"]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "reports a bounded postflight phase after mutation cleanup",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-bootstrap-postflight-"),
      );
      temporaryDirectories.push(directory);
      const executable = join(directory, "npx");
      await writeFile(
        executable,
        `#!/usr/bin/env node
const operation = process.argv.slice(2).slice(2).join(" ");
if (operation === "--version") process.stdout.write("1.5.23\\n");
else if (operation === "remove project-skill --agent codex --yes") process.exitCode = 0;
else if (operation === "list --json") process.exitCode = 2;
else if (operation === "list --global --json") process.stdout.write("[]");
else process.exitCode = 2;
`,
        "utf8",
      );
      await chmod(executable, 0o700);

      const outcome = await runBootstrap(
        encodeWireFrame({
          harness: "Codex",
          mutation: {
            names: ["project-skill"],
            scope: "project",
            type: "remove",
          },
          operation: "mutate",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "mutation-postflight-failure",
          type: "request",
          workspace: directory,
        }),
        {
          HOME: directory,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        },
        { keepInputOpen: true },
      );

      expect(decodeWireFrames(outcome.stdout)).toMatchObject({
        ok: true,
        value: [
          { type: "hello" },
          {
            code: "remote_operation_failed",
            message: "Remote mutation postflight failed.",
            phase: "postflight",
            requestId: "mutation-postflight-failure",
            type: "failure",
          },
        ],
      });
      expect(JSON.stringify(decodeWireFrames(outcome.stdout))).not.toContain(
        directory,
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "cancels a running mutation and proves child cleanup before atomic postflight",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-bootstrap-cancel-"),
      );
      temporaryDirectories.push(directory);
      const executable = join(directory, "npx");
      const startedFile = join(directory, "mutation-started");
      const lateMutationFile = join(directory, "late-mutation");
      const descendantProgram = `
const { writeFileSync } = require("node:fs");
process.on("SIGTERM", () => undefined);
writeFileSync(${JSON.stringify(startedFile)}, String(process.pid));
setTimeout(() => writeFileSync(${JSON.stringify(lateMutationFile)}, "late"), 1500);
`;
      await writeFile(
        executable,
        `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const operation = process.argv.slice(2).slice(2).join(" ");
if (operation === "--version") process.stdout.write("1.5.23\\n");
else if (operation === "remove project-skill --agent codex --yes") {
  spawn(process.execPath, ["-e", ${JSON.stringify(descendantProgram)}], { stdio: "ignore" });
  process.on("SIGTERM", () => process.exit(143));
  setInterval(() => {}, 30_000);
}
else if (operation === "list --json") process.stdout.write("[]");
else if (operation === "list --global --json") process.stdout.write("[]");
else process.exitCode = 2;
`,
        "utf8",
      );
      await chmod(executable, 0o700);
      const child = spawn("sh", ["-c", REMOTE_BOOTSTRAP_COMMAND], {
        env: {
          HOME: directory,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stdin.write(
        encodeWireFrame({
          harness: "Codex",
          mutation: {
            names: ["project-skill"],
            scope: "project",
            type: "remove",
          },
          operation: "mutate",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "mutation-cancel",
          type: "request",
          workspace: directory,
        }),
      );

      await waitForFile(startedFile);
      const descendantPid = Number(await readFile(startedFile, "utf8"));
      child.stdin.end(
        encodeWireFrame({
          operation: "cancel",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "mutation-cancel",
          type: "request",
        }),
      );
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });

      expect(exitCode).toBe(0);
      expect(
        decodeWireFrames(new Uint8Array(Buffer.concat(stdout))),
      ).toMatchObject({
        ok: true,
        value: [
          { type: "hello" },
          {
            process: {
              cleanup: "confirmed",
              disposition: "cancelled",
              exitCode: null,
            },
            requestId: "mutation-cancel",
            type: "mutation-result",
          },
        ],
      });
      expect(() => process.kill(descendantPid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" }),
      );
      await expect(readFile(lateMutationFile, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "suppresses postflight after mutation-channel EOF cleanup",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-bootstrap-transport-loss-"),
      );
      temporaryDirectories.push(directory);
      const executable = join(directory, "npx");
      const invocationLog = join(directory, "invocations.ndjson");
      const mutationStarted = join(directory, "mutation-started");
      await writeFile(
        executable,
        `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
const operation = process.argv.slice(2).slice(2).join(" ");
appendFileSync(join(process.env.HOME, "invocations.ndjson"), JSON.stringify(operation) + "\\n");
if (operation === "--version") process.stdout.write("1.5.23\\n");
else if (operation === "remove project-skill --agent codex --yes") {
  appendFileSync(join(process.env.HOME, "mutation-started"), "started");
  process.on("SIGTERM", () => process.exit(143));
  setInterval(() => {}, 30_000);
}
else if (operation === "list --json" || operation === "list --global --json") process.stdout.write("[]");
else process.exitCode = 2;
`,
        "utf8",
      );
      await chmod(executable, 0o700);

      const child = spawn("sh", ["-c", REMOTE_BOOTSTRAP_COMMAND], {
        env: {
          HOME: directory,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      const closed = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      child.stdin.write(
        encodeWireFrame({
          harness: "Codex",
          mutation: {
            names: ["project-skill"],
            scope: "project",
            type: "remove",
          },
          operation: "mutate",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "mutation-transport-loss",
          type: "request",
          workspace: directory,
        }),
      );
      await waitForFile(mutationStarted);
      child.stdin.end();
      const outcome = {
        exitCode: await closed,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: new Uint8Array(Buffer.concat(stdout)),
      };

      expect(decodeWireFrames(outcome.stdout)).toMatchObject({
        ok: true,
        value: [
          { type: "hello" },
          {
            code: "remote_operation_failed",
            phase: "mutation",
            requestId: "mutation-transport-loss",
            type: "failure",
          },
        ],
      });
      expect(
        (await readFile(invocationLog, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual(["--version", "remove project-skill --agent codex --yes"]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a second frame for observation before invoking npx",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-bootstrap-observe-extra-"),
      );
      temporaryDirectories.push(directory);
      const executable = join(directory, "npx");
      const invocationLog = join(directory, "invoked");
      await writeFile(
        executable,
        `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(invocationLog)}, "invoked");
const operation = process.argv.slice(2).slice(2).join(" ");
if (operation === "--version") process.stdout.write("1.5.23\\n");
else if (operation === "list --json" || operation === "list --global --json") process.stdout.write("[]");
else process.exitCode = 2;
`,
        "utf8",
      );
      await chmod(executable, 0o700);
      const observation = encodeWireFrame({
        harness: "Codex",
        operation: "observe",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "observe-extra",
        type: "request",
        workspace: directory,
      });
      const extra = encodeWireFrame({
        operation: "cancel",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "observe-extra",
        type: "request",
      });

      const outcome = await runBootstrap(
        new Uint8Array(
          Buffer.concat([Buffer.from(observation), Buffer.from(extra)]),
        ),
        {
          HOME: directory,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(decodeWireFrames(outcome.stdout)).toMatchObject({
        ok: true,
        value: [
          { type: "hello" },
          {
            code: "remote_protocol_violation",
            phase: "wire",
            requestId: "observe-extra",
            type: "failure",
          },
        ],
      });
      await expect(readFile(invocationLog, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
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
            phase: "wire",
            requestId: null,
            type: "failure",
          },
        ],
      });
      expect(JSON.stringify(decoded)).not.toContain("Unexpected");
    },
  );

  it.skipIf(process.platform === "win32")(
    "replaces an expanded oversized Inventory frame with one bounded failure",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "skills-bootstrap-limit-"),
      );
      temporaryDirectories.push(directory);
      const executable = join(directory, "npx");
      await writeFile(
        executable,
        `#!/usr/bin/env node
const operation = process.argv.slice(2).slice(2).join(" ");
if (operation === "--version") process.stdout.write("1.5.23\\n");
else process.stdout.write(JSON.stringify([{ filler: "\\\\".repeat(4500000) }]));
`,
        "utf8",
      );
      await chmod(executable, 0o700);

      const outcome = await runBootstrap(
        encodeWireFrame({
          harness: "Codex",
          operation: "observe",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "observe-limit",
          type: "request",
          workspace: directory,
        }),
        {
          HOME: directory,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(decodeWireFrames(outcome.stdout)).toMatchObject({
        ok: true,
        value: [
          { type: "hello" },
          {
            code: "output_limit_exceeded",
            phase: "observe",
            requestId: "observe-limit",
            type: "failure",
          },
        ],
      });
    },
  );
});
