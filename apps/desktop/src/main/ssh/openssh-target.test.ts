import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryHostTrustStore,
  createOpenSshHostKeyProbe,
  createOpenSshTargetAccess,
  quoteOpenSshConfigValue,
  type OpenSshToolInvocation,
  type OpenSshToolRunner,
} from "./openssh-target.js";
import { createRecoveryHostTrustStore } from "../persistence/recovery-host-trust.js";
import { createJsonRecoveryRecords } from "../persistence/recovery-records.js";

const keyA = "ssh-ed25519 AQIDBA==";
const keyB = "ssh-ed25519 BQYHCA==";
const fingerprintA = `SHA256:${createHash("sha256")
  .update(Buffer.from("AQIDBA==", "base64"))
  .digest("base64")
  .replace(/=+$/, "")}`;
const target = {
  connectionReference: "build-host",
  generation: 1,
  harness: "Codex",
  id: "00000000-0000-4000-8000-000000000018",
  kind: "ssh" as const,
  label: "Build host",
  workspace: "/srv/skills",
  workspaceLabel: "skills",
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function scriptedTools(key = keyA): OpenSshToolRunner & {
  readonly invocations: OpenSshToolInvocation[];
} {
  const invocations: OpenSshToolInvocation[] = [];
  return {
    invocations,
    async run(invocation) {
      invocations.push(invocation);
      if (invocation.executable === "ssh") {
        return {
          exitCode: 0,
          stderrBytes: 0,
          stdout: [
            "host resolved.internal",
            "hostname resolved.internal",
            "user deploy",
            "port 2222",
            "hostkeyalias none",
            "hostkeyalgorithms ssh-ed25519,ecdsa-sha2-nistp256",
            "identityfile /SECRET/id_ed25519",
            "proxycommand ssh proxy-SECRET nc %h %p",
          ].join("\n"),
        };
      }
      return {
        exitCode: 0,
        stderrBytes: 0,
        stdout: `# scan metadata\nresolved.internal ${key}\n`,
      };
    },
  };
}

describe("OpenSSH Effective Target Binding and host trust", () => {
  it("captures a host key through hardened OpenSSH and removes its ephemeral store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills probe-"));
    temporaryDirectories.push(directory);
    let invocation: OpenSshToolInvocation | undefined;
    const capturePath = join(directory, "host-key-probe-probe-1");
    const probe = createOpenSshHostKeyProbe({
      directory,
      id: () => "probe-1",
      runner: {
        async run(candidate) {
          invocation = candidate;
          await writeFile(capturePath, `[resolved.internal]:2222 ${keyA}\n`);
          return { exitCode: 255, stderrBytes: 128, stdout: "" };
        },
      },
    });

    await expect(
      probe.scan({
        connectionConfig: "Host probe-target\n  HostName resolved.internal\n",
        connectionReference: "probe-target",
        hostKeyIdentity: "[resolved.internal]:2222",
        hostname: "resolved.internal",
        port: 2222,
        user: "deploy",
      }),
    ).resolves.toEqual({
      exitCode: 0,
      stderrBytes: 128,
      stdout: `[resolved.internal]:2222 ${keyA}\n`,
    });
    expect(invocation).toMatchObject({
      args: expect.arrayContaining([
        "BatchMode=yes",
        "ClearAllForwardings=yes",
        "StrictHostKeyChecking=accept-new",
        "PreferredAuthentications=none",
        `UserKnownHostsFile=${quoteOpenSshConfigValue(capturePath)}`,
        "probe-target",
      ]),
      executable: "ssh",
    });
    expect(invocation?.args).toContain("-N");
    expect(invocation?.args).not.toContain("exit");
    await expect(readFile(capturePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("resolves effective configuration and presents first use without retaining credentials", async () => {
    const runner = scriptedTools();
    const access = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => "challenge-1",
      runner,
      trustStore: createMemoryHostTrustStore(),
    });

    const inspected = await access.inspect(target);

    expect(inspected).toMatchObject({
      ok: true,
      value: {
        bindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        challenge: {
          algorithm: "ssh-ed25519",
          expiresAt: "2026-08-22T10:05:00.000Z",
          fingerprint: fingerprintA,
          identity: "[resolved.internal]:2222",
          kind: "first-use",
          targetId: target.id,
        },
        status: "trust-required",
      },
    });
    expect(JSON.stringify(inspected)).not.toMatch(
      /identityfile|proxycommand|proxy-SECRET|\/SECRET/,
    );
    expect(runner.invocations).toMatchObject([
      {
        args: ["-G", "--", "build-host"],
        executable: "ssh",
        maxOutputBytes: 262_144,
      },
      {
        args: ["-T", "5", "-p", "2222", "--", "resolved.internal"],
        executable: "ssh-keyscan",
      },
    ]);
  });

  it("preserves original-host and effective-user token semantics in the frozen binding", async () => {
    const runner = scriptedTools();
    const scans: unknown[] = [];
    const access = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      hostKeySource: {
        async scan(input) {
          scans.push(input);
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout: `[resolved.internal]:2222 ${keyA}\n`,
          };
        },
      },
      id: () => "token-challenge",
      runner,
      trustStore: createMemoryHostTrustStore(),
    });

    const first = await access.inspect(target);
    if (!first.ok || first.value.status !== "trust-required") throw new Error();
    await access.confirm(first.value.challenge.id, target);
    const ready = await access.inspect(target);

    expect(ready).toMatchObject({ ok: true, value: { status: "ready" } });
    if (!ready.ok || ready.value.status !== "ready") throw new Error();
    expect(ready.value.binding.connectionConfig).toContain("Host build-host\n");
    expect(ready.value.binding.connectionConfig).toContain(
      "proxycommand ssh proxy-SECRET nc %h %p",
    );
    expect(ready.value.binding.connectionConfig).not.toContain(
      "Host skills-desktop-frozen-target",
    );
    expect(scans).toHaveLength(3);
    expect(scans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectionReference: "build-host",
          user: "deploy",
        }),
      ]),
    );
  });

  it("stores only the reviewed OpenSSH key and fails closed on later key drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-trust-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "known_hosts");
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "trust-write",
    });
    const store = createRecoveryHostTrustStore({ path, records });
    const firstAccess = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => "challenge-1",
      runner: scriptedTools(keyA),
      trustStore: store,
    });
    const first = await firstAccess.inspect(target);
    expect(first).toMatchObject({
      ok: true,
      value: { status: "trust-required" },
    });
    if (!first.ok || first.value.status !== "trust-required") throw new Error();

    await expect(
      firstAccess.confirm(first.value.challenge.id, target),
    ).resolves.toMatchObject({ ok: true, value: { kind: "first-use" } });
    expect(await readFile(path, "utf8")).toBe(
      `[resolved.internal]:2222 ${keyA}\n`,
    );

    const changedAccess = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:01:00.000Z"),
      id: () => "challenge-2",
      runner: scriptedTools(keyB),
      trustStore: store,
    });
    const changed = await changedAccess.inspect({
      ...target,
      executionBindingDigest: first.value.bindingDigest,
      generation: 2,
    });
    expect(changed).toMatchObject({
      ok: true,
      value: {
        challenge: { kind: "rotation" },
        status: "trust-required",
      },
    });
    expect(await readFile(path, "utf8")).toBe(
      `[resolved.internal]:2222 ${keyA}\n`,
    );
  });

  it("returns repairable bounded errors for missing or invalid OpenSSH configuration", async () => {
    const sentinel = "SECRET_USER@SECRET_HOST /SECRET/key";
    const access = createOpenSshTargetAccess({
      clock: () => new Date(),
      id: () => "challenge",
      runner: {
        async run() {
          throw Object.assign(new Error(sentinel), { code: "ENOENT" });
        },
      },
      trustStore: createMemoryHostTrustStore(),
    });

    const missing = await access.inspect(target);
    expect(missing).toMatchObject({
      error: {
        code: "transport_unavailable",
        effects: "none",
        phase: "resolve",
        retryable: true,
      },
      ok: false,
    });
    expect(JSON.stringify(missing)).not.toContain(sentinel);
  });

  it.each(["build*", "build?", "!build"])(
    "rejects OpenSSH pattern Connection Reference %j before resolution",
    async (connectionReference) => {
      let resolutions = 0;
      const access = createOpenSshTargetAccess({
        clock: () => new Date(),
        id: () => "challenge",
        runner: {
          async run() {
            resolutions += 1;
            return { exitCode: 0, stderrBytes: 0, stdout: "" };
          },
        },
        trustStore: createMemoryHostTrustStore(),
      });

      await expect(
        access.inspect({ ...target, connectionReference }),
      ).resolves.toMatchObject({
        error: { code: "ssh_config_invalid", phase: "resolve" },
        ok: false,
      });
      expect(resolutions).toBe(0);
    },
  );
});
