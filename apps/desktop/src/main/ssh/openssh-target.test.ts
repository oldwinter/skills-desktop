import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryHostTrustStore,
  createOpenSshHostKeyProbe,
  createOpenSshToolRunner,
  createOpenSshTargetAccess,
  quoteOpenSshConfigValue,
  type HostPublicKey,
  type HostTrustStore,
  type OpenSshToolInvocation,
  type OpenSshToolOutcome,
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
  dialectId: "skills-1.5.23" as const,
  executionBindingDigest: null,
  generation: 1,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000018",
  kind: "ssh" as const,
  label: "Build host",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de" as const,
  registryVersion: 1 as const,
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

  it("quotes OpenSSH configuration values and rejects line breaks", () => {
    expect(quoteOpenSshConfigValue("plain path")).toBe('"plain path"');
    expect(quoteOpenSshConfigValue('a\\b"c')).toBe('"a\\\\b\\"c"');
    for (const bad of ["a\nb", "a\rb", "a\0b"]) {
      expect(() => quoteOpenSshConfigValue(bad)).toThrow(
        "cannot contain line breaks",
      );
    }
  });

  it("stores a defensive copy in the memory trust store", async () => {
    const store = createMemoryHostTrustStore();
    expect(store.path).toBe("/application/known_hosts");
    await expect(store.lookup("host")).resolves.toBeNull();
    const stored: HostPublicKey = {
      algorithm: "ssh-ed25519",
      key: "AQIDBA==",
    };
    await store.replace("host", stored);
    stored.key = "CwsNDQ==";
    await expect(store.lookup("host")).resolves.toEqual({
      algorithm: "ssh-ed25519",
      key: "AQIDBA==",
    });
  });

  it("removes probe files when the OpenSSH runner fails outright", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills probe-fail-"));
    temporaryDirectories.push(directory);
    const capturePath = join(directory, "host-key-probe-probe-fail");
    const probe = createOpenSshHostKeyProbe({
      directory,
      id: () => "probe-fail",
      runner: {
        async run() {
          throw Object.assign(new Error("client missing"), {
            code: "ENOENT",
          });
        },
      },
    });

    await expect(
      probe.scan({
        connectionConfig: "Host probe-target\n  HostName resolved.internal\n",
        connectionReference: "probe-target",
        hostKeyIdentity: "resolved.internal",
        hostname: "resolved.internal",
        port: 22,
        user: "deploy",
      }),
    ).rejects.toThrow("client missing");
    await expect(readFile(capturePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(`${capturePath}.config`, "utf8")).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });

  it("rejects non-SSH targets and blank Connection References before resolution", async () => {
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
      access.inspect({ ...target, connectionReference: null, kind: "local" }),
    ).resolves.toMatchObject({
      error: { code: "ssh_config_invalid" },
      ok: false,
    });
    await expect(
      access.inspect({ ...target, connectionReference: "-oProxyCommand=sh" }),
    ).resolves.toMatchObject({
      error: { code: "ssh_config_invalid" },
      ok: false,
    });
    expect(resolutions).toBe(0);
  });

  it("bounds -G resolution failures to ssh_config_invalid", async () => {
    const crashing = createOpenSshTargetAccess({
      clock: () => new Date(),
      id: () => "challenge",
      runner: {
        async run() {
          throw new Error("spawn failed without a code");
        },
      },
      trustStore: createMemoryHostTrustStore(),
    });
    await expect(crashing.inspect(target)).resolves.toMatchObject({
      error: { code: "ssh_config_invalid", phase: "resolve" },
      ok: false,
    });

    const nonzero = createOpenSshTargetAccess({
      clock: () => new Date(),
      id: () => "challenge",
      runner: {
        async run() {
          return { exitCode: 255, stderrBytes: 12, stdout: "" };
        },
      },
      trustStore: createMemoryHostTrustStore(),
    });
    await expect(nonzero.inspect(target)).resolves.toMatchObject({
      error: { code: "ssh_config_invalid", phase: "resolve" },
      ok: false,
    });
  });

  it.each([
    "hostname resolved.internal\nport 2222\n",
    "hostname resolved.internal\nuser deploy\nport not-a-port\n",
    "hostname resolved.internal\nuser deploy\nport 70000\n",
    "hostname resolved.internal\nuser deploy\nport 0\n",
    "hostname resolved.internal\nuser deploy\nport 2222\nhostkeyalias broken alias\n",
    "hostname resolved.internal\nuser with space\nport 2222\n",
  ])(
    "refuses incomplete effective configuration: %j",
    async (configuration) => {
      const access = createOpenSshTargetAccess({
        clock: () => new Date(),
        id: () => "challenge",
        runner: {
          async run() {
            return { exitCode: 0, stderrBytes: 0, stdout: configuration };
          },
        },
        trustStore: createMemoryHostTrustStore(),
      });

      await expect(access.inspect(target)).resolves.toMatchObject({
        error: { code: "ssh_config_invalid", phase: "resolve" },
        ok: false,
      });
    },
  );

  it("derives the trust identity from the hostname on port 22 and honors hostkeyalias", async () => {
    for (const [configuration, identity] of [
      [
        "hostname resolved.internal\nuser deploy\nport 22\n",
        "resolved.internal",
      ],
      [
        "hostname resolved.internal\nuser deploy\nport 22\nhostkeyalias review-pinned\n",
        "review-pinned",
      ],
      [
        "hostname resolved.internal\nuser deploy\nport 2222\n",
        "[resolved.internal]:2222",
      ],
    ] as const) {
      const access = createOpenSshTargetAccess({
        clock: () => new Date("2026-08-22T10:00:00.000Z"),
        id: () => "challenge",
        runner: {
          async run(invocation) {
            if (invocation.executable === "ssh") {
              return { exitCode: 0, stderrBytes: 0, stdout: configuration };
            }
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout: `resolved.internal ${keyA}\n`,
            };
          },
        },
        trustStore: createMemoryHostTrustStore(),
      });

      const inspected = await access.inspect(target);
      expect(inspected).toMatchObject({
        ok: true,
        value: { challenge: { identity }, status: "trust-required" },
      });
    }
  });

  it("prefers configured hostkeyalgorithms order over scan order", async () => {
    const ecdsaKey = "ecdsa-sha2-nistp256 CwoLDA==";
    const access = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => "challenge",
      runner: {
        async run(invocation) {
          if (invocation.executable === "ssh") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout: [
                "hostname resolved.internal",
                "user deploy",
                "port 22",
                "hostkeyalgorithms ecdsa-sha2-nistp256,ssh-ed25519",
              ].join("\n"),
            };
          }
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout: `resolved.internal ${keyA}\nresolved.internal ${ecdsaKey}\n`,
          };
        },
      },
      trustStore: createMemoryHostTrustStore(),
    });

    const inspected = await access.inspect(target);
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        challenge: { algorithm: "ecdsa-sha2-nistp256" },
        status: "trust-required",
      },
    });
  });

  it("classifies host-key scan failures by phase", async () => {
    const cases: Array<{
      readonly expected: string;
      readonly run: (invocation: OpenSshToolInvocation) => Promise<OpenSshToolOutcome>;
    }> = [
      {
        expected: "transport_unavailable",
        run: async (invocation) => {
          if (invocation.executable === "ssh") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout: "hostname resolved.internal\nuser deploy\nport 22\n",
            };
          }
          throw Object.assign(new Error("no keyscan"), { code: "ENOENT" });
        },
      },
      {
        expected: "transport_failed",
        run: async (invocation) => {
          if (invocation.executable === "ssh") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout: "hostname resolved.internal\nuser deploy\nport 22\n",
            };
          }
          throw new Error("socket reset");
        },
      },
      {
        expected: "transport_failed",
        run: async (invocation) => {
          if (invocation.executable === "ssh") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout: "hostname resolved.internal\nuser deploy\nport 22\n",
            };
          }
          return { exitCode: 1, stderrBytes: 4, stdout: "" };
        },
      },
      {
        expected: "transport_failed",
        run: async (invocation) => {
          if (invocation.executable === "ssh") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout: "hostname resolved.internal\nuser deploy\nport 22\n",
            };
          }
          return { exitCode: 0, stderrBytes: 0, stdout: "# comments only\n" };
        },
      },
    ];

    for (const { expected, run } of cases) {
      const access = createOpenSshTargetAccess({
        clock: () => new Date(),
        id: () => "challenge",
        runner: { run },
        trustStore: createMemoryHostTrustStore(),
      });
      await expect(access.inspect(target)).resolves.toMatchObject({
        error: { code: expected },
        ok: false,
      });
    }
  });

  it("fails closed when the trust store cannot be read", async () => {
    const brokenStore: HostTrustStore = {
      path: "/broken",
      async lookup() {
        throw new Error("store locked");
      },
      async replace() {},
    };
    const access = createOpenSshTargetAccess({
      clock: () => new Date(),
      id: () => "challenge",
      runner: scriptedTools(),
      trustStore: brokenStore,
    });

    await expect(access.inspect(target)).resolves.toMatchObject({
      error: { code: "host_trust_invalid", phase: "trust", retryable: false },
      ok: false,
    });
  });

  it("freezes proxy-jump chains, tolerates cycles, and refuses failing or unbounded jumps", async () => {
    const jumpConfig =
      "hostname jump.internal\nuser deploy\nport 22\nproxyjump none\n";
    const chainRunner: OpenSshToolRunner = {
      async run(invocation) {
        if (invocation.executable !== "ssh") {
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout: `resolved.internal ${keyA}\n`,
          };
        }
        const reference = invocation.args.at(-1);
        if (reference === "build-host") {
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout:
              "hostname resolved.internal\nuser deploy\nport 2222\nproxyjump jump.internal\n",
          };
        }
        // The jump host resolves once; its own proxyjump points back at the
        // primary, and the visited set must stop the loop.
        if (reference === "jump.internal") {
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout:
              "hostname jump.internal\nuser deploy\nport 22\nproxyjump build-host\n",
          };
        }
        return { exitCode: 0, stderrBytes: 0, stdout: jumpConfig };
      },
    };
    const access = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => "challenge",
      runner: chainRunner,
      trustStore: createMemoryHostTrustStore(),
    });

    const inspected = await access.inspect(target);
    if (!inspected.ok || inspected.value.status !== "trust-required") {
      throw new Error("expected a trust challenge");
    }
    const confirmed = await access.confirm(
      inspected.value.challenge.id,
      target,
    );
    expect(confirmed).toMatchObject({ ok: true });
    const ready = await access.inspect(target);
    if (!ready.ok || ready.value.status !== "ready") {
      throw new Error("expected a ready binding");
    }
    expect(ready.value.binding.connectionConfig).toContain("Host build-host");
    expect(ready.value.binding.connectionConfig).toContain(
      "Host jump.internal",
    );

    const failingJump = createOpenSshTargetAccess({
      clock: () => new Date(),
      id: () => "challenge",
      runner: {
        async run(invocation) {
          if (invocation.executable !== "ssh") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout: `resolved.internal ${keyA}\n`,
            };
          }
          const reference = invocation.args.at(-1);
          if (reference === "build-host") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout:
                "hostname resolved.internal\nuser deploy\nport 2222\nproxyjump jump.internal\n",
            };
          }
          throw new Error("jump resolution failed");
        },
      },
      trustStore: createMemoryHostTrustStore(),
    });
    await expect(failingJump.inspect(target)).resolves.toMatchObject({
      error: { code: "ssh_config_invalid", phase: "resolve" },
      ok: false,
    });

    let depth = 0;
    const unbounded = createOpenSshTargetAccess({
      clock: () => new Date(),
      id: () => "challenge",
      runner: {
        async run(invocation) {
          if (invocation.executable !== "ssh") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout: `resolved.internal ${keyA}\n`,
            };
          }
          const reference = invocation.args.at(-1);
          if (reference === "build-host") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout:
                "hostname resolved.internal\nuser deploy\nport 2222\nproxyjump jump-1\n",
            };
          }
          depth += 1;
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout: `hostname ${reference}\nuser deploy\nport 22\nproxyjump jump-${depth + 1}\n`,
          };
        },
      },
      trustStore: createMemoryHostTrustStore(),
    });
    await expect(unbounded.inspect(target)).resolves.toMatchObject({
      error: { code: "ssh_config_invalid", phase: "resolve" },
      ok: false,
    });
    expect(depth).toBe(8);
  });

  it("normalizes user, bracketed IPv6, and port decoration on jump references", async () => {
    const resolved: string[] = [];
    const runner: OpenSshToolRunner = {
      async run(invocation) {
        if (invocation.executable !== "ssh") {
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout: `resolved.internal ${keyA}\n`,
          };
        }
        const reference = invocation.args.at(-1) ?? "";
        resolved.push(reference);
        if (reference === "build-host") {
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout:
              "hostname resolved.internal\nuser deploy\nport 2222\nproxyjump deploy@[2001:db8::10]:2222,jump-2.internal:2200\n",
          };
        }
        return {
          exitCode: 0,
          stderrBytes: 0,
          stdout: `hostname ${reference}\nuser deploy\nport 22\nproxyjump none\n`,
        };
      },
    };
    const access = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => "challenge",
      runner,
      trustStore: createMemoryHostTrustStore(),
    });

    const inspected = await access.inspect(target);
    if (!inspected.ok || inspected.value.status !== "trust-required") {
      throw new Error("expected a trust challenge");
    }
    await access.confirm(inspected.value.challenge.id, target);
    const ready = await access.inspect(target);
    if (!ready.ok || ready.value.status !== "ready") {
      throw new Error("expected a ready binding");
    }
    // user@, brackets, and :port are stripped before each -G resolution;
    // the chain is re-resolved on inspect, confirm, and re-inspect.
    expect(resolved).toContain("2001:db8::10");
    expect(resolved).toContain("jump-2.internal");
    expect(
      resolved.every(
        (reference) => !reference.includes("@") && !reference.startsWith("["),
      ),
    ).toBe(true);
    expect(ready.value.binding.connectionConfig).toContain(
      "Host 2001:db8::10",
    );
    expect(ready.value.binding.connectionConfig).toContain(
      "Host jump-2.internal",
    );
  });

  it("exposes a bounded pending-challenge projection and confirms first-use trust", async () => {
    const trustStore = createMemoryHostTrustStore();
    const access = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => "challenge-9",
      runner: scriptedTools(),
      trustStore,
    });

    expect(access.pendingChallenge(target.id)).toBeUndefined();
    const inspected = await access.inspect(target);
    if (!inspected.ok || inspected.value.status !== "trust-required") {
      throw new Error("expected a trust challenge");
    }
    const pending = access.pendingChallenge(target.id);
    expect(pending).toMatchObject({
      algorithm: "ssh-ed25519",
      id: "challenge-9",
      identity: "[resolved.internal]:2222",
      kind: "first-use",
      targetId: target.id,
    });
    expect(JSON.stringify(pending)).not.toContain("bindingDigest");
    expect(JSON.stringify(pending)).not.toContain("AQIDBA==");

    await expect(
      access.confirm("challenge-9", { ...target, id: "other-target" }),
    ).resolves.toMatchObject({
      error: { code: "host_trust_invalid" },
      ok: false,
    });
    await expect(
      access.confirm("challenge-9", { ...target, generation: 2 }),
    ).resolves.toMatchObject({
      error: { code: "host_trust_invalid" },
      ok: false,
    });
    await expect(
      access.confirm("missing-challenge", target),
    ).resolves.toMatchObject({
      error: { code: "host_trust_invalid" },
      ok: false,
    });

    await expect(access.confirm("challenge-9", target)).resolves.toMatchObject(
      { ok: true, value: { kind: "first-use" } },
    );
    expect(access.pendingChallenge(target.id)).toBeUndefined();
    await expect(access.inspect(target)).resolves.toMatchObject({
      ok: true,
      value: { status: "ready" },
    });
  });

  it("expires challenges past their TTL and fails closed on mid-review key drift", async () => {
    let now = Date.parse("2026-08-22T10:00:00.000Z");
    const expiring = createOpenSshTargetAccess({
      clock: () => new Date(now),
      id: () => "challenge-1",
      runner: scriptedTools(),
      trustStore: createMemoryHostTrustStore(),
    });
    const inspected = await expiring.inspect(target);
    if (!inspected.ok || inspected.value.status !== "trust-required") {
      throw new Error("expected a trust challenge");
    }
    now = Date.parse("2026-08-22T10:06:00.000Z");
    await expect(
      expiring.confirm(inspected.value.challenge.id, target),
    ).resolves.toMatchObject({
      error: { code: "host_trust_invalid" },
      ok: false,
    });

    let scans = 0;
    const drifting = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => "challenge-1",
      runner: {
        async run(invocation) {
          if (invocation.executable === "ssh") {
            return {
              exitCode: 0,
              stderrBytes: 0,
              stdout:
                "hostname resolved.internal\nuser deploy\nport 2222\n",
            };
          }
          scans += 1;
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout: `resolved.internal ${scans === 1 ? keyA : keyB}\n`,
          };
        },
      },
      trustStore: createMemoryHostTrustStore(),
    });
    const driftedInspect = await drifting.inspect(target);
    if (
      !driftedInspect.ok ||
      driftedInspect.value.status !== "trust-required"
    ) {
      throw new Error("expected a trust challenge");
    }
    await expect(
      drifting.confirm(driftedInspect.value.challenge.id, target),
    ).resolves.toMatchObject({
      error: { code: "host_key_changed", phase: "trust", retryable: false },
      ok: false,
    });
    // The challenge was consumed; a second confirm cannot replay it.
    await expect(
      drifting.confirm(driftedInspect.value.challenge.id, target),
    ).resolves.toMatchObject({
      error: { code: "host_trust_invalid" },
      ok: false,
    });

    const writeBlocked = createOpenSshTargetAccess({
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => "challenge-1",
      runner: scriptedTools(),
      trustStore: {
        path: "/blocked",
        async lookup() {
          return null;
        },
        async replace() {
          throw new Error("store full");
        },
      },
    });
    const blockedInspect = await writeBlocked.inspect(target);
    if (
      !blockedInspect.ok ||
      blockedInspect.value.status !== "trust-required"
    ) {
      throw new Error("expected a trust challenge");
    }
    await expect(
      writeBlocked.confirm(blockedInspect.value.challenge.id, target),
    ).resolves.toMatchObject({
      error: { code: "host_trust_invalid" },
      ok: false,
    });
  });
});

// createOpenSshToolRunner execs a real `ssh` binary; OpenSSH is absent on the
// Windows runners, so these platform-contract cases stay POSIX-only.
describe.runIf(process.platform !== "win32")(
  "createOpenSshToolRunner",
  () => {
    it("maps a nonzero ssh exit to the outcome contract", async () => {
      const missingConfig = join(tmpdir(), "devin-factory-no-such-config");
      const runner = createOpenSshToolRunner({
        sshConfigPath: missingConfig,
      });
      const outcome = await runner.run({
        args: ["-G", "localhost"],
        executable: "ssh",
        maxOutputBytes: 1 << 20,
        timeoutMs: 10_000,
      });
      expect(outcome.exitCode).not.toBe(0);
      expect(outcome.stderrBytes).toBeGreaterThan(0);
    });

    it("does not inject -F when the invocation already carries one", async () => {
      const dir = await mkdtemp(join(tmpdir(), "openssh-runner-"));
      temporaryDirectories.push(dir);
      const config = join(dir, "ssh_config");
      await writeFile(config, "", "utf8");
      const runner = createOpenSshToolRunner({
        sshConfigPath: join(dir, "ignored-config"),
      });
      const outcome = await runner.run({
        args: ["-F", config, "-G", "localhost"],
        executable: "ssh",
        maxOutputBytes: 1 << 20,
        timeoutMs: 10_000,
      });
      expect(outcome.exitCode).toBe(0);
      expect(outcome.stdout).toContain("hostname localhost");
    });
  },
);
