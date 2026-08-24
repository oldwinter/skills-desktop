import { watch } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  decodeWireFrames,
  encodeWireFrame,
  WIRE_PROTOCOL_VERSION,
} from "@skills-desktop/skills-runtime";

import {
  createSshTransportRunner,
  SshTransportBoundaryError,
} from "./ssh-skills-process.js";

async function waitForFile(
  path: string,
  accepts: (contents: string) => boolean = () => true,
) {
  await new Promise<void>((resolve, reject) => {
    const watcher = watch(dirname(path));
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      watcher.close();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for fake SSH input.")));
    }, 5_000);
    const inspect = () => {
      void readFile(path, "utf8").then(
        (contents) => {
          if (accepts(contents)) finish(resolve);
        },
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            finish(() => reject(error));
          }
        },
      );
    };
    watcher.on("change", inspect);
    watcher.on("rename", inspect);
    watcher.on("error", (error) => finish(() => reject(error)));
    inspect();
  });
}

async function readOwnedHelperPid(path: string) {
  try {
    const pid = Number((await readFile(path, "utf8")).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function waitForOwnedHelperPid(path: string) {
  await waitForFile(path, (contents) => {
    const pid = Number(contents.trim());
    return Number.isInteger(pid) && pid > 0;
  });
  const pid = await readOwnedHelperPid(path);
  if (pid === undefined) {
    throw new Error("Detached helper PID disappeared after publication.");
  }
  return pid;
}

async function killOwnedHelper(path: string, knownPid?: number) {
  const pid = knownPid ?? (await readOwnedHelperPid(path));
  if (pid === undefined) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  // SIGKILL cannot be caught or ignored. The PID may remain observable while
  // the kernel is waiting to reap a zombie, so kill(pid, 0) is not a useful
  // postcondition here and would add up to a second per retained-stream case.
}

const detachedHelperScript = `
const { spawn } = require("node:child_process");
const { renameSync, writeFileSync } = require("node:fs");
const helper = spawn(
  process.env.TEST_NODE_EXECUTABLE,
  ["-e", "setTimeout(() => process.exit(0), 4000)"],
  { detached: true, stdio: ["ignore", "inherit", "inherit"] },
);
helper.unref();
const pendingPidFile = process.env.TEST_HELPER_PID_FILE + ".pending";
writeFileSync(pendingPidFile, String(helper.pid));
renameSync(pendingPidFile, process.env.TEST_HELPER_PID_FILE);
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
      observeRunnerResult(pending),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function observeRunnerResult(pending: Promise<unknown>) {
  return pending.then(
    () => ({ kind: "resolved" as const }),
    (error: unknown) => ({ error, kind: "rejected" as const }),
  );
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

describe.skipIf(process.platform === "win32")(
  "retained POSIX transport streams",
  () => {
    it.each([
      { disposition: "cancelled" as const, outputStream: undefined },
      { disposition: "timed-out" as const, outputStream: undefined },
      { disposition: "failed" as const, outputStream: "stdout" as const },
      { disposition: "failed" as const, outputStream: "stderr" as const },
    ])(
      "settles $disposition termination with $outputStream retained",
      async (scenario) => {
      const directory = await mkdtemp(join(tmpdir(), "skills-ssh-runner-"));
      const helperPidFile = join(directory, "helper.pid");
      const useControlledTimeout = scenario.disposition === "timed-out";
      const controller = new AbortController();
      let helperPid: number | undefined;
      let pending: Promise<unknown> | undefined;
      if (useControlledTimeout) vi.useFakeTimers();
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
          timeoutMs: 30_000,
        });
        const settled = useControlledTimeout
          ? observeRunnerResult(pending)
          : boundedRunnerResult(pending, 2_000);
        helperPid = await waitForOwnedHelperPid(helperPidFile);
        if (scenario.disposition === "cancelled") controller.abort();
        if (useControlledTimeout) {
          await vi.advanceTimersByTimeAsync(30_100);
        }

        const result = await settled;
        expect(result).toMatchObject({
          error: {
            disposition: scenario.disposition,
            termination: "unknown",
          },
          kind: "rejected",
        });
      } finally {
        controller.abort();
        if (useControlledTimeout) {
          await vi.advanceTimersByTimeAsync(100);
        }
        await killOwnedHelper(helperPidFile, helperPid);
        await pending?.catch(() => undefined);
        await rm(directory, { force: true, recursive: true });
        if (useControlledTimeout) vi.useRealTimers();
      }
      },
    );
  },
);
