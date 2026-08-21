import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch as watchFileSystem } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSshSkillsProcess,
  createSshTransportRunner,
} from "../apps/desktop/src/main/adapters/ssh-skills-process.js";
import {
  createOpenSshHostKeyProbe,
  createOpenSshTargetAccess,
  createOpenSshToolRunner,
} from "../apps/desktop/src/main/ssh/openssh-target.js";
import { createRecoveryHostTrustStore } from "../apps/desktop/src/main/persistence/recovery-host-trust.js";
import { createJsonRecoveryRecords } from "../apps/desktop/src/main/persistence/recovery-records.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

async function waitForFile(path: string) {
  await new Promise<void>((resolve, reject) => {
    const watcher = watchFileSystem(dirname(path));
    const timeout = setTimeout(() => {
      watcher.close();
      reject(new Error("Timed out waiting for the SSH cancellation barrier."));
    }, 10_000);
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

describe("disposable localhost OpenSSH integration", () => {
  it.skipIf(process.platform === "win32")(
    "resolves, reviews, trusts, frames, and atomically observes through system OpenSSH",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "skills-desktop-sshd-"));
      temporaryDirectories.push(root);
      const bin = join(root, "bin");
      const workspace = join(root, "workspace");
      const sshDirectory = join(root, "ssh");
      await Promise.all([
        mkdir(bin, { recursive: true }),
        mkdir(workspace, { recursive: true }),
        mkdir(sshDirectory, { recursive: true }),
      ]);
      const hostKey = join(sshDirectory, "host_ed25519");
      const clientKey = join(sshDirectory, "client_ed25519");
      await execFileAsync("ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        hostKey,
      ]);
      await execFileAsync("ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        clientKey,
      ]);
      const authorizedKeys = join(sshDirectory, "authorized_keys");
      await writeFile(
        authorizedKeys,
        await readFile(`${clientKey}.pub`, "utf8"),
        {
          mode: 0o600,
        },
      );

      const npx = join(bin, "npx");
      const pauseFile = join(root, "pause-observation");
      const observationStartedFile = join(root, "observation-started");
      await writeFile(
        npx,
        `#!/usr/bin/env node
const { existsSync, writeFileSync } = require("node:fs");
const operation = process.argv.slice(2).slice(2).join(" ");
if (operation === "list --json" && existsSync(${JSON.stringify(pauseFile)})) {
  writeFileSync(${JSON.stringify(observationStartedFile)}, "started");
  setTimeout(() => process.stdout.write(JSON.stringify([{ name: "late-project", path: "/private/late", scope: "project", agents: ["Codex"], source: null, sourceType: null, sourceUrl: null }])), 30_000);
}
else if (operation === "--version") process.stdout.write("1.5.23\\n");
else if (operation === "list --json") process.stdout.write(JSON.stringify([{ name: "remote-project", path: "/private/project", scope: "project", agents: ["Codex"], source: null, sourceType: null, sourceUrl: null }]));
else if (operation === "list --global --json") process.stdout.write(JSON.stringify([{ name: "remote-global", path: "/private/global", scope: "global", agents: ["Codex"], source: null, sourceType: null, sourceUrl: null }]));
else process.exitCode = 2;
`,
        { mode: 0o700 },
      );
      await chmod(npx, 0o700);
      const isolatedHome = join(root, "home");
      await mkdir(isolatedHome, { recursive: true });
      const forceCommand = join(bin, "run-fixed-command");
      await writeFile(
        forceCommand,
        `#!/bin/sh
export HOME='${isolatedHome}'
export PATH='${bin}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}'
exec /bin/sh -c "$SSH_ORIGINAL_COMMAND"
`,
        { mode: 0o700 },
      );
      await chmod(forceCommand, 0o700);

      const port = await availablePort();
      const sshdConfig = join(sshDirectory, "sshd_config");
      const pidFile = join(sshDirectory, "sshd.pid");
      await writeFile(
        sshdConfig,
        [
          `Port ${port}`,
          "ListenAddress 127.0.0.1",
          `HostKey ${hostKey}`,
          `PidFile ${pidFile}`,
          `AuthorizedKeysFile ${authorizedKeys}`,
          "PasswordAuthentication no",
          "KbdInteractiveAuthentication no",
          "PubkeyAuthentication yes",
          "StrictModes no",
          "UsePAM no",
          "PrintMotd no",
          "LogLevel ERROR",
          `ForceCommand ${forceCommand}`,
        ].join("\n"),
        "utf8",
      );
      await execFileAsync("/usr/sbin/sshd", ["-t", "-f", sshdConfig]);

      const clientConfig = join(sshDirectory, "config");
      await writeFile(
        clientConfig,
        [
          "Host skills-smoke",
          "  HostName 127.0.0.1",
          `  Port ${port}`,
          `  User ${process.env.USER ?? "cdd"}`,
          `  IdentityFile ${clientKey}`,
          "  IdentitiesOnly yes",
        ].join("\n"),
        { mode: 0o600 },
      );

      const daemon = await import("node:child_process").then(({ spawn }) =>
        spawn("/usr/sbin/sshd", ["-D", "-e", "-f", sshdConfig], {
          stdio: ["ignore", "ignore", "pipe"],
        }),
      );
      const daemonErrors: Buffer[] = [];
      daemon.stderr.on("data", (chunk: Buffer) => daemonErrors.push(chunk));
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(new Error("Disposable sshd did not become ready.")),
          10_000,
        );
        const poll = () => {
          void readFile(pidFile, "utf8").then(
            () => {
              clearTimeout(deadline);
              resolve();
            },
            () => setImmediate(poll),
          );
        };
        daemon.once("exit", (code) => {
          clearTimeout(deadline);
          reject(
            new Error(
              `Disposable sshd exited ${code}: ${Buffer.concat(daemonErrors).toString("utf8")}`,
            ),
          );
        });
        poll();
      });

      try {
        const environment = {
          ...process.env,
          PATH: process.env.PATH,
        };
        const toolRunner = createOpenSshToolRunner({
          environment,
          sshConfigPath: clientConfig,
        });
        const recoveryDirectory = join(sshDirectory, "recovery");
        const recoveryRecords = createJsonRecoveryRecords({
          directory: recoveryDirectory,
          id: randomUUID,
          platform: process.platform,
        });
        const trustStore = createRecoveryHostTrustStore({
          path: join(recoveryDirectory, "known_hosts"),
          records: recoveryRecords,
        });
        const access = createOpenSshTargetAccess({
          clock: () => new Date("2026-08-22T10:00:00.000Z"),
          hostKeySource: createOpenSshHostKeyProbe({
            directory: join(sshDirectory, "probes"),
            runner: toolRunner,
          }),
          id: () => "localhost-challenge",
          runner: toolRunner,
          trustStore,
        });
        const target = {
          connectionReference: "skills-smoke",
          executionBindingDigest: null,
          generation: 1,
          harness: "Codex",
          id: "00000000-0000-4000-8000-000000000018",
          kind: "ssh" as const,
          label: "Disposable localhost",
          workspace,
          workspaceLabel: "workspace",
        };
        const untrusted = await access.inspect(target);
        expect(untrusted).toMatchObject({
          ok: true,
          value: { challenge: { kind: "first-use" }, status: "trust-required" },
        });
        if (!untrusted.ok || untrusted.value.status !== "trust-required") {
          throw new Error("Expected first-use host trust.");
        }
        await expect(
          access.confirm(untrusted.value.challenge.id, target),
        ).resolves.toMatchObject({ ok: true });
        const trusted = await access.inspect(target);
        expect(trusted).toMatchObject({ ok: true, value: { status: "ready" } });
        if (!trusted.ok || trusted.value.status !== "ready") {
          throw new Error("Expected a trusted binding.");
        }

        const processAdapter = createSshSkillsProcess({
          binding: {
            generation: 2,
            harness: "Codex",
            kind: "ssh",
            ssh: trusted.value.binding,
            targetId: target.id,
            workspace,
          },
          clock: () => new Date("2026-08-22T10:00:00.000Z"),
          id: () => "localhost-observe",
          runner: createSshTransportRunner({
            environment,
            platform: process.platform,
          }),
        });
        const observed = await processAdapter.observeInventory({
          signal: new AbortController().signal,
        });
        expect(observed).toMatchObject({
          ok: true,
          value: {
            entries: [
              { name: "remote-project", scope: "project" },
              { name: "remote-global", scope: "global" },
            ],
          },
        });
        expect(JSON.stringify(observed)).not.toMatch(
          /client_ed25519|authorized_keys|known_hosts|localhost-challenge/,
        );

        await writeFile(pauseFile, "pause", "utf8");
        const controller = new AbortController();
        const cancelled = processAdapter.observeInventory({
          signal: controller.signal,
        });
        await waitForFile(observationStartedFile);
        controller.abort();
        await expect(cancelled).resolves.toMatchObject({
          error: { code: "cancelled", effects: "none" },
          ok: false,
        });

        const rotatedKey = (await readFile(`${clientKey}.pub`, "utf8"))
          .trim()
          .split(/\s+/);
        await trustStore.replace(trusted.value.binding.hostKeyIdentity, {
          algorithm: rotatedKey[0]!,
          key: rotatedKey[1]!,
        });
        await expect(access.inspect(target)).resolves.toMatchObject({
          ok: true,
          value: { challenge: { kind: "rotation" }, status: "trust-required" },
        });
      } finally {
        daemon.kill("SIGTERM");
        await new Promise<void>((resolve) =>
          daemon.once("close", () => resolve()),
        );
      }
    },
  );
});
