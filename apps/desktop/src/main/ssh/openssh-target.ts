import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type PublicError,
  type Result,
  WIRE_PROTOCOL_VERSION,
} from "@skills-desktop/skills-runtime";
import { REMOTE_BOOTSTRAP_DIGEST } from "@skills-desktop/remote-bootstrap";

import type { TargetDefinition } from "../targets/skills-targets.js";
import {
  type HostPublicKey,
  parseOpenSshPublicKey,
} from "./host-public-key.js";

const CONFIG_OUTPUT_LIMIT = 256 * 1024;
const KEYSCAN_OUTPUT_LIMIT = 1024 * 1024;
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_JUMP_HOSTS = 8;
const quotedConfigurationNames = new Set([
  "certificatefile",
  "identityagent",
  "identityfile",
  "pkcs11provider",
  "revokedhostkeys",
  "securitykeyprovider",
  "xauthlocation",
]);

export function quoteOpenSshConfigValue(value: string) {
  if (/\0|\r|\n/.test(value)) {
    throw new Error("OpenSSH configuration values cannot contain line breaks.");
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export interface OpenSshToolInvocation {
  readonly args: readonly string[];
  readonly executable: "ssh" | "ssh-keyscan";
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

export interface OpenSshToolOutcome {
  readonly exitCode: number;
  readonly stderrBytes: number;
  readonly stdout: string;
}

export interface OpenSshToolRunner {
  run(invocation: OpenSshToolInvocation): Promise<OpenSshToolOutcome>;
}

export type { HostPublicKey } from "./host-public-key.js";

export interface HostTrustStore {
  readonly path: string;
  lookup(identity: string): Promise<HostPublicKey | null>;
  replace(identity: string, key: HostPublicKey): Promise<void>;
}

export interface OpenSshHostKeySource {
  scan(input: {
    readonly connectionConfig: string;
    readonly connectionReference: string;
    readonly hostKeyIdentity: string;
    readonly hostname: string;
    readonly port: number;
    readonly user: string;
  }): Promise<OpenSshToolOutcome>;
}

export interface HostTrustChallenge {
  readonly algorithm: string;
  readonly expiresAt: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly identity: string;
  readonly kind: "first-use" | "rotation";
  readonly targetGeneration: number;
  readonly targetId: string;
}

interface PrivateHostTrustChallenge extends HostTrustChallenge {
  readonly bindingDigest: string;
  readonly key: HostPublicKey;
  readonly lookupIdentity: string;
}

export interface OpenSshEffectiveBinding {
  readonly bindingDigest: string;
  readonly connectionReference: string;
  readonly connectionConfig: string;
  readonly hostKey: HostPublicKey;
  readonly hostKeyIdentity: string;
  readonly hostname: string;
  readonly port: number;
  readonly trustStorePath: string;
  readonly user: string;
  readonly wireDialect: {
    readonly bootstrapDigest: string;
    readonly protocolVersion: typeof WIRE_PROTOCOL_VERSION;
  };
}

export type OpenSshAccessError = PublicError<
  | "host_key_changed"
  | "host_trust_invalid"
  | "ssh_config_invalid"
  | "transport_failed"
  | "transport_unavailable"
>;

export type OpenSshInspection =
  | {
      readonly binding: OpenSshEffectiveBinding;
      readonly bindingDigest: string;
      readonly status: "ready";
    }
  | {
      readonly bindingDigest: string;
      readonly challenge: HostTrustChallenge;
      readonly status: "trust-required";
    };

export interface OpenSshTargetAccess {
  confirm(
    challengeId: string,
    target: TargetDefinition,
  ): Promise<
    Result<
      {
        readonly bindingDigest: string;
        readonly kind: HostTrustChallenge["kind"];
      },
      OpenSshAccessError
    >
  >;
  inspect(
    target: TargetDefinition,
  ): Promise<Result<OpenSshInspection, OpenSshAccessError>>;
  pendingChallenge(targetId: string): HostTrustChallenge | undefined;
}

function accessFailure(
  code: OpenSshAccessError["code"],
  message: string,
  phase: "resolve" | "scan" | "trust",
  retryable: boolean,
): Result<never, OpenSshAccessError> {
  return {
    error: { code, effects: "none", message, phase, retryable },
    ok: false,
  };
}

export function createOpenSshToolRunner(options?: {
  readonly environment?: NodeJS.ProcessEnv;
  readonly sshConfigPath?: string;
}): OpenSshToolRunner {
  return {
    run(invocation) {
      return new Promise((resolve, reject) => {
        execFile(
          invocation.executable,
          [
            ...(invocation.executable === "ssh" &&
            options?.sshConfigPath !== undefined &&
            !invocation.args.includes("-F")
              ? ["-F", options.sshConfigPath]
              : []),
            ...invocation.args,
          ],
          {
            encoding: "utf8",
            env: options?.environment,
            maxBuffer: invocation.maxOutputBytes,
            shell: false,
            timeout: invocation.timeoutMs,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            if (
              error !== null &&
              (error as NodeJS.ErrnoException).code === "ENOENT"
            ) {
              reject(error);
              return;
            }
            resolve({
              exitCode:
                error === null
                  ? 0
                  : typeof (error as { code?: unknown }).code === "number"
                    ? ((error as { code: number }).code ?? 1)
                    : 1,
              stderrBytes: Buffer.byteLength(stderr, "utf8"),
              stdout,
            });
          },
        );
      });
    },
  };
}

export function createMemoryHostTrustStore(): HostTrustStore {
  const records = new Map<string, HostPublicKey>();
  return {
    path: "/application/known_hosts",
    async lookup(identity) {
      return records.get(identity) ?? null;
    },
    async replace(identity, key) {
      records.set(identity, { ...key });
    },
  };
}

export function createOpenSshHostKeyProbe(options: {
  readonly directory: string;
  readonly id?: () => string;
  readonly runner: OpenSshToolRunner;
}): OpenSshHostKeySource {
  const id = options.id ?? randomUUID;
  return {
    async scan({
      connectionConfig,
      connectionReference,
      hostKeyIdentity,
      hostname,
      port,
      user,
    }) {
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      const capturePath = join(options.directory, `host-key-probe-${id()}`);
      const configurationPath = `${capturePath}.config`;
      const handle = await open(capturePath, "wx", 0o600);
      await handle.close();
      await writeFile(configurationPath, connectionConfig, {
        flag: "wx",
        mode: 0o600,
      });
      try {
        const outcome = await options.runner.run({
          args: [
            "-F",
            configurationPath,
            "-N",
            "-T",
            "-x",
            "-o",
            "BatchMode=yes",
            "-o",
            "ClearAllForwardings=yes",
            "-o",
            "ControlMaster=no",
            "-o",
            "ControlPath=none",
            "-o",
            "ForwardAgent=no",
            "-o",
            "PermitLocalCommand=no",
            "-o",
            "RequestTTY=no",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "KnownHostsCommand=none",
            "-o",
            "VerifyHostKeyDNS=no",
            "-o",
            "CanonicalizeHostname=no",
            "-o",
            "PreferredAuthentications=none",
            "-o",
            "PubkeyAuthentication=no",
            "-o",
            "PasswordAuthentication=no",
            "-o",
            "KbdInteractiveAuthentication=no",
            "-o",
            "GSSAPIAuthentication=no",
            "-o",
            "HostbasedAuthentication=no",
            "-o",
            `UserKnownHostsFile=${quoteOpenSshConfigValue(capturePath)}`,
            "-o",
            `GlobalKnownHostsFile=${quoteOpenSshConfigValue(capturePath)}`,
            "-o",
            "HashKnownHosts=no",
            "-o",
            "CheckHostIP=no",
            "-o",
            "UpdateHostKeys=no",
            "-o",
            `HostName=${hostname}`,
            "-o",
            `Port=${port}`,
            "-o",
            `User=${user}`,
            "-o",
            `HostKeyAlias=${hostKeyIdentity}`,
            "--",
            connectionReference,
          ],
          executable: "ssh",
          maxOutputBytes: CONFIG_OUTPUT_LIMIT,
          timeoutMs: 10_000,
        });
        const captured = await readFile(capturePath, "utf8");
        return {
          exitCode: captured.trim() === "" ? outcome.exitCode : 0,
          stderrBytes: outcome.stderrBytes,
          stdout: captured,
        };
      } finally {
        await Promise.all([
          unlink(capturePath).catch(() => undefined),
          unlink(configurationPath).catch(() => undefined),
        ]);
      }
    },
  };
}

interface ResolvedCandidate {
  readonly bindingDigest: string;
  readonly connectionReference: string;
  readonly connectionConfig: string;
  readonly hostKey: HostPublicKey;
  readonly hostKeyIdentity: string;
  readonly hostname: string;
  readonly port: number;
  readonly user: string;
}

function configValues(output: string) {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(" ");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).toLowerCase();
    if (!values.has(name)) values.set(name, line.slice(separator + 1).trim());
  }
  return values;
}

function safeConfigValue(value: string | undefined) {
  return (
    value !== undefined &&
    value.length > 0 &&
    value.length <= 2_048 &&
    !/[\s\0]/.test(value)
  );
}

const overriddenConfigurationNames = new Set([
  "batchmode",
  "canonicalizehostname",
  "checkhostip",
  "clearallforwardings",
  "controlmaster",
  "controlpath",
  "forwardagent",
  "globalknownhostsfile",
  "host",
  "hostkeyalias",
  "hostname",
  "knownhostscommand",
  "localcommand",
  "permitlocalcommand",
  "port",
  "remotecommand",
  "requesttty",
  "stricthostkeychecking",
  "updatehostkeys",
  "user",
  "userknownhostsfile",
  "verifyhostkeydns",
]);

function frozenConfigurationBlock(
  alias: string,
  output: string,
  targetBlock = false,
) {
  const lines = output.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(" ");
    if (separator <= 0) return [];
    const name = line.slice(0, separator).toLowerCase();
    if (
      !/^[a-z][a-z0-9]*$/.test(name) ||
      name === "host" ||
      (targetBlock && overriddenConfigurationNames.has(name))
    ) {
      return [];
    }
    const value = line.slice(separator + 1).trim();
    return [
      `  ${name} ${
        quotedConfigurationNames.has(name)
          ? quoteOpenSshConfigValue(value)
          : value
      }`,
    ];
  });
  return [`Host ${alias}`, ...lines].join("\n");
}

function jumpReferences(output: string) {
  const proxyJump = configValues(output).get("proxyjump");
  if (proxyJump === undefined || proxyJump === "none") return [];
  return proxyJump.split(",").flatMap((raw) => {
    let reference = raw.trim();
    const at = reference.lastIndexOf("@");
    if (at >= 0) reference = reference.slice(at + 1);
    if (reference.startsWith("[")) {
      const closing = reference.indexOf("]");
      if (closing > 1) reference = reference.slice(1, closing);
    } else {
      reference = reference.replace(/:\d+$/, "");
    }
    return reference.length > 0 &&
      reference.length <= 256 &&
      !reference.startsWith("-") &&
      !/[\s\0*?!]/.test(reference)
      ? [reference]
      : [];
  });
}

function fingerprint(key: HostPublicKey) {
  return `SHA256:${createHash("sha256")
    .update(Buffer.from(key.key, "base64"))
    .digest("base64")
    .replace(/=+$/, "")}`;
}

export function createOpenSshTargetAccess(options: {
  readonly clock: () => Date;
  readonly hostKeySource?: OpenSshHostKeySource;
  readonly id: () => string;
  readonly runner: OpenSshToolRunner;
  readonly trustStore: HostTrustStore;
}): OpenSshTargetAccess {
  const challenges = new Map<string, PrivateHostTrustChallenge>();
  const challengeByTarget = new Map<string, string>();

  const freezeConnectionConfig = async (
    connectionReference: string,
    initialOutput: string,
  ) => {
    const blocks = [
      frozenConfigurationBlock(connectionReference, initialOutput, true),
    ];
    const pending = [...jumpReferences(initialOutput)];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const reference = pending.shift()!;
      if (visited.has(reference)) continue;
      if (visited.size >= MAX_JUMP_HOSTS) return undefined;
      visited.add(reference);
      let configured: OpenSshToolOutcome;
      try {
        configured = await options.runner.run({
          args: ["-G", "--", reference],
          executable: "ssh",
          maxOutputBytes: CONFIG_OUTPUT_LIMIT,
          timeoutMs: 10_000,
        });
      } catch {
        return undefined;
      }
      if (configured.exitCode !== 0) return undefined;
      blocks.push(frozenConfigurationBlock(reference, configured.stdout));
      pending.push(...jumpReferences(configured.stdout));
    }
    return `${blocks.join("\n")}\n`;
  };

  const resolveCandidate = async (
    target: TargetDefinition,
  ): Promise<Result<ResolvedCandidate, OpenSshAccessError>> => {
    const connectionReference = target.connectionReference;
    if (
      target.kind !== "ssh" ||
      connectionReference === null ||
      connectionReference === undefined ||
      connectionReference.startsWith("-") ||
      /[\s\0*?!]/.test(connectionReference)
    ) {
      return accessFailure(
        "ssh_config_invalid",
        "The OpenSSH Connection Reference is not valid.",
        "resolve",
        true,
      );
    }
    let configured: OpenSshToolOutcome;
    try {
      configured = await options.runner.run({
        args: ["-G", "--", connectionReference],
        executable: "ssh",
        maxOutputBytes: CONFIG_OUTPUT_LIMIT,
        timeoutMs: 10_000,
      });
    } catch (error) {
      return accessFailure(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "transport_unavailable"
          : "ssh_config_invalid",
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "The system OpenSSH client is unavailable."
          : "The OpenSSH configuration could not be resolved.",
        "resolve",
        true,
      );
    }
    if (configured.exitCode !== 0) {
      return accessFailure(
        "ssh_config_invalid",
        "The OpenSSH configuration could not be resolved.",
        "resolve",
        true,
      );
    }
    const values = configValues(configured.stdout);
    const hostname = values.get("hostname");
    const user = values.get("user");
    const portText = values.get("port");
    const port = Number(portText);
    const hostKeyAlias = values.get("hostkeyalias");
    if (
      !safeConfigValue(hostname) ||
      !safeConfigValue(user) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      (hostKeyAlias !== undefined &&
        hostKeyAlias !== "none" &&
        (!safeConfigValue(hostKeyAlias) || /\s/.test(hostKeyAlias)))
    ) {
      return accessFailure(
        "ssh_config_invalid",
        "The resolved OpenSSH configuration is incomplete.",
        "resolve",
        true,
      );
    }
    const resolvedHostname = hostname!;
    const resolvedUser = user!;
    const hostKeyIdentity =
      hostKeyAlias !== undefined && hostKeyAlias !== "none"
        ? hostKeyAlias
        : port === 22
          ? resolvedHostname
          : `[${resolvedHostname}]:${port}`;
    const connectionConfig = await freezeConnectionConfig(
      connectionReference,
      configured.stdout,
    );
    if (connectionConfig === undefined) {
      return accessFailure(
        "ssh_config_invalid",
        "The resolved OpenSSH configuration could not be frozen.",
        "resolve",
        true,
      );
    }

    let scanned: OpenSshToolOutcome;
    try {
      scanned =
        options.hostKeySource === undefined
          ? await options.runner.run({
              args: ["-T", "5", "-p", String(port), "--", resolvedHostname],
              executable: "ssh-keyscan",
              maxOutputBytes: KEYSCAN_OUTPUT_LIMIT,
              timeoutMs: 10_000,
            })
          : await options.hostKeySource.scan({
              connectionConfig,
              connectionReference,
              hostKeyIdentity,
              hostname: resolvedHostname,
              port,
              user: resolvedUser,
            });
    } catch (error) {
      return accessFailure(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "transport_unavailable"
          : "transport_failed",
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "The system OpenSSH host-key tool is unavailable."
          : "The SSH host key could not be inspected.",
        "scan",
        true,
      );
    }
    if (scanned.exitCode !== 0) {
      return accessFailure(
        "transport_failed",
        "The SSH host key could not be inspected.",
        "scan",
        true,
      );
    }
    const scannedKeys = scanned.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "" && !line.startsWith("#"))
      .flatMap((line) => {
        const fields = line.trim().split(/\s+/);
        const key = parseOpenSshPublicKey(fields.slice(1).join(" "));
        return key === undefined ? [] : [key];
      });
    const preferredAlgorithms = (values.get("hostkeyalgorithms") ?? "")
      .split(",")
      .filter((algorithm) => !algorithm.includes("-cert-"));
    const selected =
      preferredAlgorithms.flatMap((algorithm) =>
        scannedKeys.filter((key) => key.algorithm === algorithm),
      )[0] ?? scannedKeys[0];
    if (selected === undefined) {
      return accessFailure(
        "transport_failed",
        "The SSH host did not present a supported public host key.",
        "scan",
        true,
      );
    }
    return {
      ok: true,
      value: {
        bindingDigest: createHash("sha256")
          .update(
            JSON.stringify({
              bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
              effectiveConfigDigest: createHash("sha256")
                .update(connectionConfig)
                .digest("hex"),
              harness: target.harness,
              hostKeyIdentity,
              protocolVersion: WIRE_PROTOCOL_VERSION,
              workspace: target.workspace,
            }),
          )
          .digest("hex"),
        connectionReference,
        connectionConfig,
        hostKey: selected,
        hostKeyIdentity,
        hostname: resolvedHostname,
        port,
        user: resolvedUser,
      },
    };
  };

  const inspect = async (
    target: TargetDefinition,
  ): Promise<Result<OpenSshInspection, OpenSshAccessError>> => {
    const resolved = await resolveCandidate(target);
    if (!resolved.ok) return resolved;
    let trusted: HostPublicKey | null;
    try {
      trusted = await options.trustStore.lookup(resolved.value.hostKeyIdentity);
    } catch {
      return accessFailure(
        "host_trust_invalid",
        "The application host-trust store is unavailable.",
        "trust",
        false,
      );
    }
    if (
      trusted !== null &&
      trusted.algorithm === resolved.value.hostKey.algorithm &&
      trusted.key === resolved.value.hostKey.key
    ) {
      return {
        ok: true,
        value: {
          binding: {
            bindingDigest: resolved.value.bindingDigest,
            connectionReference: resolved.value.connectionReference,
            connectionConfig: resolved.value.connectionConfig,
            hostKey: resolved.value.hostKey,
            hostKeyIdentity: resolved.value.hostKeyIdentity,
            hostname: resolved.value.hostname,
            port: resolved.value.port,
            trustStorePath: options.trustStore.path,
            user: resolved.value.user,
            wireDialect: {
              bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
              protocolVersion: WIRE_PROTOCOL_VERSION,
            },
          },
          bindingDigest: resolved.value.bindingDigest,
          status: "ready",
        },
      };
    }
    const priorChallengeId = challengeByTarget.get(target.id);
    if (priorChallengeId !== undefined) challenges.delete(priorChallengeId);
    const challenge: PrivateHostTrustChallenge = {
      algorithm: resolved.value.hostKey.algorithm,
      bindingDigest: resolved.value.bindingDigest,
      expiresAt: new Date(
        options.clock().getTime() + CHALLENGE_TTL_MS,
      ).toISOString(),
      fingerprint: fingerprint(resolved.value.hostKey),
      id: options.id(),
      identity: resolved.value.hostKeyIdentity,
      key: resolved.value.hostKey,
      kind: trusted === null ? "first-use" : "rotation",
      lookupIdentity: resolved.value.hostKeyIdentity,
      targetGeneration: target.generation,
      targetId: target.id,
    };
    challenges.set(challenge.id, challenge);
    challengeByTarget.set(target.id, challenge.id);
    const {
      bindingDigest: _privateDigest,
      key: _key,
      lookupIdentity: _identity,
      ...projection
    } = challenge;
    return {
      ok: true,
      value: {
        bindingDigest: resolved.value.bindingDigest,
        challenge: projection,
        status: "trust-required",
      },
    };
  };

  return {
    async confirm(challengeId, target) {
      const challenge = challenges.get(challengeId);
      if (
        challenge === undefined ||
        challenge.targetId !== target.id ||
        challenge.targetGeneration !== target.generation ||
        options.clock().getTime() >= Date.parse(challenge.expiresAt)
      ) {
        return accessFailure(
          "host_trust_invalid",
          "The host-trust review is unavailable or expired.",
          "trust",
          false,
        );
      }
      const current = await resolveCandidate(target);
      if (
        !current.ok ||
        current.value.bindingDigest !== challenge.bindingDigest ||
        current.value.hostKeyIdentity !== challenge.lookupIdentity ||
        current.value.hostKey.algorithm !== challenge.key.algorithm ||
        current.value.hostKey.key !== challenge.key.key
      ) {
        challenges.delete(challenge.id);
        challengeByTarget.delete(target.id);
        return current.ok
          ? accessFailure(
              "host_key_changed",
              "The SSH host key changed during review.",
              "trust",
              false,
            )
          : current;
      }
      try {
        await options.trustStore.replace(
          challenge.lookupIdentity,
          challenge.key,
        );
      } catch {
        return accessFailure(
          "host_trust_invalid",
          "The reviewed host key could not be stored.",
          "trust",
          false,
        );
      }
      challenges.delete(challenge.id);
      challengeByTarget.delete(target.id);
      return {
        ok: true,
        value: {
          bindingDigest: challenge.bindingDigest,
          kind: challenge.kind,
        },
      };
    },
    inspect,
    pendingChallenge(targetId) {
      const challengeId = challengeByTarget.get(targetId);
      const challenge =
        challengeId === undefined ? undefined : challenges.get(challengeId);
      if (challenge === undefined) return undefined;
      const {
        bindingDigest: _digest,
        key: _key,
        lookupIdentity: _identity,
        ...projection
      } = challenge;
      return projection;
    },
  };
}
