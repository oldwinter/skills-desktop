import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CLI_VERSION,
  decodeWireFrames,
  encodeWireFrame,
  INVENTORY_SCHEMA_VERSION,
  MAX_WIRE_FRAME_BYTES,
  parseCliInventory,
  type Inventory,
  type PublicError,
  type Result,
} from "@skills-desktop/skills-runtime";
import { REMOTE_BOOTSTRAP_COMMAND } from "@skills-desktop/remote-bootstrap";

import type {
  MutationExecutionError,
  MutationPreparationError,
  ObservationError,
  SkillsProcess,
} from "./local-skills-process.js";
import {
  quoteOpenSshConfigValue,
  type OpenSshEffectiveBinding,
} from "../ssh/openssh-target.js";

const SSH_TIMEOUT_MS = 60_000;
const MAX_SSH_STDOUT_BYTES = MAX_WIRE_FRAME_BYTES + 4 + 1_024;
const MAX_SSH_STDERR_BYTES = 64 * 1024;

export interface SshTransportInvocation {
  readonly args: readonly string[];
  readonly configuration: string;
  readonly executable: "ssh";
  readonly input: Uint8Array;
  readonly maxStderrBytes: number;
  readonly maxStdoutBytes: number;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export interface SshTransportOutcome {
  readonly exitCode: number;
  readonly stderrBytes: number;
  readonly stdout: Uint8Array;
}

export interface SshTransportRunner {
  run(invocation: SshTransportInvocation): Promise<SshTransportOutcome>;
}

export class SshTransportBoundaryError extends Error {
  constructor(
    message: string,
    readonly disposition: "cancelled" | "failed" | "timed-out",
  ) {
    super(message);
    this.name = "SshTransportBoundaryError";
  }
}

export function createSshTransportRunner(options?: {
  readonly cancellationGraceMs?: number;
  readonly environment?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}): SshTransportRunner {
  const platform = options?.platform ?? process.platform;
  const cancellationGraceMs = options?.cancellationGraceMs ?? 2_000;
  return {
    async run(invocation) {
      if (invocation.signal.aborted) {
        throw new SshTransportBoundaryError(
          "SSH transport was cancelled before spawn.",
          "cancelled",
        );
      }
      const directory = await mkdtemp(join(tmpdir(), "skills-desktop-ssh-"));
      const configurationPath = join(directory, "config");
      try {
        await writeFile(configurationPath, invocation.configuration, {
          flag: "wx",
          mode: 0o600,
        });
        if (invocation.signal.aborted) {
          throw new SshTransportBoundaryError(
            "SSH transport was cancelled before spawn.",
            "cancelled",
          );
        }
        return await new Promise((resolve, reject) => {
          const child = spawn(
            invocation.executable,
            ["-F", configurationPath, ...invocation.args],
            {
              detached: platform !== "win32",
              env: options?.environment,
              shell: false,
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
            },
          );
          const stdout: Buffer[] = [];
          let stdoutBytes = 0;
          let stderrBytes = 0;
          let settled = false;
          let boundaryError: SshTransportBoundaryError | undefined;
          let forceTimer: NodeJS.Timeout | undefined;

          const signalProcess = (signal: NodeJS.Signals) => {
            if (child.pid === undefined) return;
            try {
              if (platform === "win32") child.kill(signal);
              else process.kill(-child.pid, signal);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
                boundaryError ??= new SshTransportBoundaryError(
                  "SSH transport termination failed.",
                  "failed",
                );
              }
            }
          };
          const terminate = (error: SshTransportBoundaryError) => {
            boundaryError ??= error;
            signalProcess("SIGTERM");
            forceTimer ??= setTimeout(
              () => signalProcess("SIGKILL"),
              cancellationGraceMs,
            );
          };
          const onAbort = () =>
            terminate(
              new SshTransportBoundaryError(
                "SSH transport was cancelled.",
                "cancelled",
              ),
            );
          const timeout = setTimeout(
            () =>
              terminate(
                new SshTransportBoundaryError(
                  "SSH transport timed out.",
                  "timed-out",
                ),
              ),
            invocation.timeoutMs,
          );
          const cleanup = () => {
            clearTimeout(timeout);
            if (forceTimer !== undefined) clearTimeout(forceTimer);
            invocation.signal.removeEventListener("abort", onAbort);
          };
          const rejectOnce = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };
          child.stdout.on("data", (chunk: Buffer) => {
            stdoutBytes += chunk.length;
            if (stdoutBytes > invocation.maxStdoutBytes) {
              terminate(
                new SshTransportBoundaryError(
                  "SSH stdout exceeded its byte limit.",
                  "failed",
                ),
              );
              return;
            }
            stdout.push(chunk);
          });
          child.stderr.on("data", (chunk: Buffer) => {
            stderrBytes += chunk.length;
            if (stderrBytes > invocation.maxStderrBytes) {
              terminate(
                new SshTransportBoundaryError(
                  "SSH stderr exceeded its byte limit.",
                  "failed",
                ),
              );
            }
          });
          child.once("error", (error) => {
            boundaryError = new SshTransportBoundaryError(
              (error as NodeJS.ErrnoException).code === "ENOENT"
                ? "SSH executable is unavailable."
                : "SSH transport could not start.",
              "failed",
            );
          });
          child.once("close", (exitCode) => {
            if (settled) return;
            if (boundaryError !== undefined) {
              rejectOnce(boundaryError);
              return;
            }
            settled = true;
            cleanup();
            resolve({
              exitCode: exitCode ?? 1,
              stderrBytes,
              stdout: new Uint8Array(Buffer.concat(stdout)),
            });
          });
          invocation.signal.addEventListener("abort", onAbort, { once: true });
          child.stdin.once("error", () => undefined);
          child.stdin.end(Buffer.from(invocation.input));
        });
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  };
}

export interface SshSkillsProcessBinding {
  readonly generation: number;
  readonly harness: string;
  readonly kind: "ssh";
  readonly ssh: OpenSshEffectiveBinding;
  readonly targetId: string;
  readonly workspace: string;
}

type SshObservationCode = Extract<
  ObservationError,
  PublicError<string>
>["code"];

function observationFailure(
  code: SshObservationCode,
  message: string,
  retryable: boolean,
): Result<never, ObservationError> {
  return {
    error: { code, effects: "none", message, phase: "observe", retryable },
    ok: false,
  };
}

function sshArguments(binding: SshSkillsProcessBinding) {
  const trustStore = binding.ssh.trustStorePath;
  return [
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
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${quoteOpenSshConfigValue(trustStore)}`,
    "-o",
    `GlobalKnownHostsFile=${quoteOpenSshConfigValue(trustStore)}`,
    "-o",
    "CheckHostIP=no",
    "-o",
    "UpdateHostKeys=no",
    "-o",
    "KnownHostsCommand=none",
    "-o",
    "VerifyHostKeyDNS=no",
    "-o",
    "CanonicalizeHostname=no",
    "-o",
    `HostName=${binding.ssh.hostname}`,
    "-o",
    `User=${binding.ssh.user}`,
    "-o",
    `Port=${binding.ssh.port}`,
    "-o",
    `HostKeyAlias=${binding.ssh.hostKeyIdentity}`,
    "--",
    binding.ssh.connectionReference,
    REMOTE_BOOTSTRAP_COMMAND,
  ] as const;
}

export function createSshSkillsProcess(options: {
  readonly binding: SshSkillsProcessBinding;
  readonly clock: () => Date;
  readonly id: () => string;
  readonly runner: SshTransportRunner;
}): SkillsProcess {
  let observing = false;
  return {
    async executeConfirmed() {
      const error: MutationExecutionError = {
        code: "confirmation_invalid",
        effects: "none",
        message: "SSH mutation is not available in this build.",
        phase: "execute",
        retryable: false,
      };
      return { error, ok: false };
    },
    async observeInventory({ signal }) {
      if (observing) {
        return observationFailure(
          "mutation_conflict",
          "Another operation is active for this Target.",
          true,
        );
      }
      if (signal.aborted) {
        return observationFailure(
          "cancelled",
          "Inventory observation was cancelled.",
          true,
        );
      }
      observing = true;
      const requestId = options.id();
      try {
        let transport: SshTransportOutcome;
        try {
          transport = await options.runner.run({
            args: sshArguments(options.binding),
            configuration: options.binding.ssh.connectionConfig,
            executable: "ssh",
            input: encodeWireFrame({
              harness: options.binding.harness,
              operation: "observe",
              protocolVersion: options.binding.ssh.wireDialect.protocolVersion,
              requestId,
              type: "request",
              workspace: options.binding.workspace,
            }),
            maxStderrBytes: MAX_SSH_STDERR_BYTES,
            maxStdoutBytes: MAX_SSH_STDOUT_BYTES,
            signal,
            timeoutMs: SSH_TIMEOUT_MS,
          });
        } catch (error) {
          return signal.aborted ||
            (error instanceof SshTransportBoundaryError &&
              error.disposition === "cancelled")
            ? observationFailure(
                "cancelled",
                "Inventory observation was cancelled.",
                true,
              )
            : observationFailure(
                "transport_failed",
                "The SSH transport could not complete the observation.",
                true,
              );
        }
        if (signal.aborted) {
          return observationFailure(
            "cancelled",
            "Inventory observation was cancelled.",
            true,
          );
        }
        const decoded = decodeWireFrames(transport.stdout);
        if (!decoded.ok) {
          return observationFailure(
            "remote_protocol_violation",
            "The remote response did not match the Wire Protocol.",
            false,
          );
        }
        if (transport.exitCode !== 0 && decoded.value.length === 0) {
          return observationFailure(
            transport.exitCode === 127
              ? "remote_runtime_unavailable"
              : "transport_lost",
            transport.exitCode === 127
              ? "The remote runtime is unavailable."
              : "The SSH transport ended before a complete remote result.",
            true,
          );
        }
        if (decoded.value.length !== 2) {
          return observationFailure(
            "remote_protocol_violation",
            "The remote response did not contain one complete result.",
            false,
          );
        }
        const [hello, response] = decoded.value;
        if (
          hello?.type !== "hello" ||
          hello.bootstrapDigest !==
            options.binding.ssh.wireDialect.bootstrapDigest
        ) {
          return observationFailure(
            "remote_protocol_mismatch",
            "The Remote Bootstrap build does not match this application.",
            false,
          );
        }
        if (response?.type === "failure") {
          if (response.requestId !== requestId) {
            return observationFailure(
              "remote_protocol_violation",
              "The remote failure did not match the active observation.",
              false,
            );
          }
          return observationFailure(
            response.code === "remote_runtime_unavailable"
              ? "remote_runtime_unavailable"
              : response.code === "remote_protocol_violation"
                ? "remote_protocol_violation"
                : response.code === "output_limit_exceeded"
                  ? "inventory_too_large"
                  : "process_failed",
            response.code === "remote_runtime_unavailable"
              ? "The remote runtime is unavailable."
              : response.code === "remote_protocol_violation"
                ? "The Remote Bootstrap rejected the Wire request."
                : response.code === "output_limit_exceeded"
                  ? "Remote Inventory output exceeded its byte limit."
                  : "Remote Inventory observation failed.",
            response.code === "remote_operation_failed",
          );
        }
        if (
          response?.type !== "inventory" ||
          response.requestId !== requestId ||
          response.cliVersion !== CLI_VERSION
        ) {
          return observationFailure(
            "remote_protocol_violation",
            "The remote response did not match the active observation.",
            false,
          );
        }
        if (transport.exitCode !== 0) {
          return observationFailure(
            "transport_lost",
            "The SSH transport ended before a complete remote result.",
            true,
          );
        }
        const project = parseCliInventory(response.projectJson, "project");
        if (!project.ok) return project;
        const global = parseCliInventory(response.globalJson, "global");
        if (!global.ok) return global;
        const inventory: Inventory = {
          cliVersion: CLI_VERSION,
          entries: [...project.value, ...global.value],
          observedAt: options.clock().toISOString(),
          schemaVersion: INVENTORY_SCHEMA_VERSION,
        };
        return { ok: true, value: inventory };
      } finally {
        observing = false;
      }
    },
    async prepareMutation() {
      const error: MutationPreparationError = {
        code: "mutation_ineligible",
        effects: "none",
        message: "SSH mutation is not available in this build.",
        phase: "prepare",
        retryable: false,
      };
      return { error, ok: false };
    },
  };
}
