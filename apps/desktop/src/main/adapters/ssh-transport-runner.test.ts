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
    }, 2_000);
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
    watcher.on("error", reject);
    inspect();
  });
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
