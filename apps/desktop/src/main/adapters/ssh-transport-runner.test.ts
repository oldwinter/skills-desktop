import { watch } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { expect, it } from "vitest";

import {
  decodeWireFrames,
  encodeWireFrame,
  WIRE_PROTOCOL_VERSION,
} from "@skills-desktop/skills-runtime";

import {
  createSshTransportRunner,
  SshTransportBoundaryError,
} from "./ssh-skills-process.js";

async function waitForFile(path: string) {
  await new Promise<void>((resolve, reject) => {
    const watcher = watch(dirname(path));
    const timeout = setTimeout(() => {
      watcher.close();
      reject(new Error("Timed out waiting for fake SSH input."));
    }, 5_000);
    const inspect = () => {
      void readFile(path).then(
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
    watcher.on("rename", inspect);
    watcher.on("error", reject);
    inspect();
  });
}

async function killOwnedHelper(path: string) {
  let pid: number;
  try {
    pid = Number(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Detached helper PID was invalid.");
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Detached helper did not terminate.");
}

const detachedHelperScript = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const helper = spawn(
  process.env.TEST_NODE_EXECUTABLE,
  ["-e", "setInterval(() => undefined, 1000)"],
  { detached: true, stdio: ["ignore", "inherit", "inherit"] },
);
helper.unref();
writeFileSync(process.env.TEST_HELPER_PID_FILE, String(helper.pid));
if (process.env.TEST_OUTPUT_STREAM === "stdout") process.stdout.write("overflow");
if (process.env.TEST_OUTPUT_STREAM === "stderr") process.stderr.write("overflow");
process.stdin.resume();
`;

async function boundedRunnerResult(
  pending: Promise<unknown>,
  timeoutMs: number,
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ error, kind: "rejected" as const }),
      ),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

it.skipIf(process.platform === "win32")(
  "sends cancellation and waits boundedly for a terminal SSH response",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-ssh-runner-"));
    try {
      const executable = join(directory, "ssh");
      const inputLog = join(directory, "input.bin");
      const startedFile = join(directory, "started");
      const responseFile = join(directory, "response.bin");
      const initialInput = encodeWireFrame({
        harness: "Codex",
        mutation: {
          names: ["project-skill"],
          scope: "project",
          type: "remove",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-transport",
        type: "request",
        workspace: "/srv/workspace",
      });
      const cancellationInput = encodeWireFrame({
        operation: "cancel",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-transport",
        type: "request",
      });
      const response = encodeWireFrame({
        code: "remote_operation_failed",
        message: "Terminal fixture response.",
        phase: "mutation",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-transport",
        type: "failure",
      });
      await writeFile(responseFile, response);
      await writeFile(
        executable,
        `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
let chunks = 0;
process.stdin.on("data", (chunk) => {
  appendFileSync(process.env.TEST_INPUT_LOG, chunk);
  chunks += 1;
  if (chunks === 1) writeFileSync(process.env.TEST_STARTED_FILE, "started");
  if (chunks === 2) {
    process.stdout.write(readFileSync(process.env.TEST_RESPONSE_FILE));
    process.exit(0);
  }
});
`,
        "utf8",
      );
      await chmod(executable, 0o700);
      const runner = createSshTransportRunner({
        cancellationGraceMs: 2_000,
        environment: {
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
          TEST_INPUT_LOG: inputLog,
          TEST_RESPONSE_FILE: responseFile,
          TEST_STARTED_FILE: startedFile,
        },
        platform: "linux",
      });
      const controller = new AbortController();
      const pending = runner.run({
        args: ["fixed-command"],
        cancellationGraceMs: 2_000,
        cancellationInput,
        configuration: "Host fixed-command\n  HostName example.invalid\n",
        executable: "ssh",
        input: initialInput,
        maxStderrBytes: 1_024,
        maxStdoutBytes: 1_024,
        signal: controller.signal,
        timeoutMs: 30_000,
      });
      await waitForFile(startedFile);

      controller.abort();

      await expect(pending).resolves.toMatchObject({
        exitCode: 0,
        interruption: "cancelled",
        stdout: response,
      });
      expect(
        decodeWireFrames(new Uint8Array(await readFile(inputLog))),
      ).toEqual({
        ok: true,
        value: [
          expect.objectContaining({ operation: "mutate" }),
          expect.objectContaining({ operation: "cancel" }),
        ],
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "uses bounded Windows tree termination in the simulated Windows runner path",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-ssh-runner-win-"));
    try {
      const executable = join(directory, "ssh");
      const startedFile = join(directory, "started");
      await writeFile(
        executable,
        `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.TEST_STARTED_FILE, "started");
process.stdin.resume();
`,
        "utf8",
      );
      await chmod(executable, 0o700);
      let terminatedPid: number | undefined;
      const runner = createSshTransportRunner({
        cancellationGraceMs: 25,
        environment: {
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
          TEST_STARTED_FILE: startedFile,
        },
        async killWindowsTree(pid) {
          terminatedPid = pid;
          process.kill(pid, "SIGKILL");
        },
        platform: "win32",
        windowsTreeTerminationTimeoutMs: 100,
      });
      const controller = new AbortController();
      const pending = runner.run({
        args: ["fixed-command"],
        cancellationGraceMs: 25,
        cancellationInput: encodeWireFrame({
          operation: "cancel",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "windows-tree-mutation",
          type: "request",
        }),
        configuration: "Host fixed-command\n  HostName example.invalid\n",
        executable: "ssh",
        input: encodeWireFrame({
          harness: "Codex",
          mutation: {
            names: ["project-skill"],
            scope: "project",
            type: "remove",
          },
          operation: "mutate",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "windows-tree-mutation",
          type: "request",
          workspace: "/srv/workspace",
        }),
        maxStderrBytes: 1_024,
        maxStdoutBytes: 1_024,
        signal: controller.signal,
        timeoutMs: 30_000,
      });
      await waitForFile(startedFile);

      controller.abort();

      await expect(pending).rejects.toMatchObject({
        disposition: "cancelled",
        termination: "unknown",
      } satisfies Partial<SshTransportBoundaryError>);
      expect(terminatedPid).toBeTypeOf("number");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "terminates SSH with an uncertain outcome when cleanup proof misses the grace period",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-ssh-runner-"));
    try {
      const executable = join(directory, "ssh");
      const startedFile = join(directory, "started");
      await writeFile(
        executable,
        `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.TEST_STARTED_FILE, "started");
process.stdin.resume();
`,
        "utf8",
      );
      await chmod(executable, 0o700);
      const runner = createSshTransportRunner({
        cancellationGraceMs: 25,
        environment: {
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
          TEST_STARTED_FILE: startedFile,
        },
        platform: "linux",
      });
      const controller = new AbortController();
      const pending = runner.run({
        args: ["fixed-command"],
        cancellationGraceMs: 25,
        cancellationInput: encodeWireFrame({
          operation: "cancel",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "mutation-without-proof",
          type: "request",
        }),
        configuration: "Host fixed-command\n  HostName example.invalid\n",
        executable: "ssh",
        input: encodeWireFrame({
          harness: "Codex",
          mutation: {
            names: ["project-skill"],
            scope: "project",
            type: "remove",
          },
          operation: "mutate",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "mutation-without-proof",
          type: "request",
          workspace: "/srv/workspace",
        }),
        maxStderrBytes: 1_024,
        maxStdoutBytes: 1_024,
        signal: controller.signal,
        timeoutMs: 30_000,
      });
      await waitForFile(startedFile);

      controller.abort();

      await expect(pending).rejects.toMatchObject({
        disposition: "cancelled",
        termination: "unknown",
      } satisfies Partial<SshTransportBoundaryError>);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "settles POSIX cancellation, timeout, and output-limit termination when an owned helper retains the streams",
  async () => {
    for (const scenario of [
      { disposition: "cancelled" as const, outputStream: undefined },
      { disposition: "timed-out" as const, outputStream: undefined },
      { disposition: "failed" as const, outputStream: "stdout" as const },
      { disposition: "failed" as const, outputStream: "stderr" as const },
    ]) {
      const directory = await mkdtemp(join(tmpdir(), "skills-ssh-runner-"));
      const helperPidFile = join(directory, "helper.pid");
      let pending: Promise<unknown> | undefined;
      try {
        const executable = join(directory, "ssh");
        await writeFile(executable, `#!/usr/bin/env node\n${detachedHelperScript}`, {
          mode: 0o700,
        });
        await chmod(executable, 0o700);
        const runner = createSshTransportRunner({
          cancellationGraceMs: 20,
          environment: {
            PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
            TEST_HELPER_PID_FILE: helperPidFile,
            TEST_NODE_EXECUTABLE: process.execPath,
            ...(scenario.outputStream === undefined
              ? {}
              : { TEST_OUTPUT_STREAM: scenario.outputStream }),
          },
          platform: "linux",
        });
        const controller = new AbortController();
        pending = runner.run({
          args: ["fixed-command"],
          cancellationGraceMs: 20,
          cancellationInput: encodeWireFrame({
            operation: "cancel",
            protocolVersion: WIRE_PROTOCOL_VERSION,
            requestId: `retained-stream-${scenario.disposition}`,
            type: "request",
          }),
          configuration: "Host fixed-command\n  HostName example.invalid\n",
          executable: "ssh",
          input: encodeWireFrame({
            harness: "Codex",
            mutation: {
              names: ["project-skill"],
              scope: "project",
              type: "remove",
            },
            operation: "mutate",
            protocolVersion: WIRE_PROTOCOL_VERSION,
            requestId: `retained-stream-${scenario.disposition}`,
            type: "request",
            workspace: "/srv/workspace",
          }),
          maxStderrBytes: 1,
          maxStdoutBytes: 1,
          signal: controller.signal,
          timeoutMs: scenario.disposition === "timed-out" ? 20 : 30_000,
        });
        await waitForFile(helperPidFile);
        if (scenario.disposition === "cancelled") controller.abort();

        const result = await boundedRunnerResult(pending, 500);
        expect(result).toMatchObject({
          error: {
            disposition: scenario.disposition,
            termination: "unknown",
          },
          kind: "rejected",
        });
      } finally {
        await killOwnedHelper(helperPidFile);
        await pending?.catch(() => undefined);
        await rm(directory, { force: true, recursive: true });
      }
    }
  },
);
