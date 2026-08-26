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
  resolveLegacyHarnessAlias,
  type Inventory,
  type PublicError,
  type Result,
} from "@skills-desktop/skills-runtime";
import { REMOTE_BOOTSTRAP_COMMAND } from "@skills-desktop/remote-bootstrap";

import {
  mutationExecutionFailure,
  observedMutationEffects,
  prepareMutationPlan,
  type NormalizedMutation,
  type MutationExecutionError,
  type MutationOutcome,
  type ObservationError,
  type PreparedMutation,
  type SkillsProcess,
} from "./skills-process.js";
import { createWindowsProcessTreeKiller } from "./windows-process-tree.js";
import {
  quoteOpenSshConfigValue,
  type OpenSshEffectiveBinding,
} from "../ssh/openssh-target.js";

const SSH_TIMEOUT_MS = 60_000;
const MAX_SSH_STDOUT_BYTES = MAX_WIRE_FRAME_BYTES + 4 + 1_024;
const MAX_SSH_STDERR_BYTES = 64 * 1024;

export interface SshTransportInvocation {
  readonly args: readonly string[];
  readonly cancellationGraceMs?: number;
  readonly cancellationInput?: Uint8Array;
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
  readonly interruption?: "cancelled" | "timed-out";
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
    readonly termination: "known" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "SshTransportBoundaryError";
  }
}

export function createSshTransportRunner(options?: {
  readonly cancellationGraceMs?: number;
  readonly environment?: NodeJS.ProcessEnv;
  readonly killWindowsTree?: (pid: number) => Promise<void>;
  readonly platform?: NodeJS.Platform;
  readonly windowsTreeTerminationTimeoutMs?: number;
}): SshTransportRunner {
  const platform = options?.platform ?? process.platform;
  const cancellationGraceMs = options?.cancellationGraceMs ?? 2_000;
  const windowsTreeTerminationTimeoutMs =
    options?.windowsTreeTerminationTimeoutMs ?? 2_000;
  const killWindowsTree =
    options?.killWindowsTree ??
    createWindowsProcessTreeKiller(windowsTreeTerminationTimeoutMs);
  const boundedWindowsTreeKill = (pid: number) =>
    new Promise<Error | undefined>((resolve) => {
      let settled = false;
      const finish = (error: Error | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(error);
      };
      const timer = setTimeout(
        () =>
          finish(
            new SshTransportBoundaryError(
              "SSH process tree termination could not be confirmed.",
              "failed",
            ),
          ),
        windowsTreeTerminationTimeoutMs,
      );
      void killWindowsTree(pid).then(
        () => finish(undefined),
        () =>
          finish(
            new SshTransportBoundaryError(
              "SSH process tree termination could not be confirmed.",
              "failed",
            ),
          ),
      );
    });
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
          let closeTimer: NodeJS.Timeout | undefined;
          let forceTimer: NodeJS.Timeout | undefined;
          let remoteCleanupTimer: NodeJS.Timeout | undefined;
          let interruption: SshTransportOutcome["interruption"];
          let windowsTreeTermination: Promise<Error | undefined> | undefined;

          const signalProcess = (
            signal: NodeJS.Signals,
          ): SshTransportBoundaryError | undefined => {
            if (child.pid === undefined) return undefined;
            try {
              if (platform === "win32") child.kill(signal);
              else process.kill(-child.pid, signal);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
                return new SshTransportBoundaryError(
                  "SSH transport termination failed.",
                  "failed",
                );
              }
            }
            return undefined;
          };
          const expectCloseWithin = (
            milliseconds: number,
            disposition: SshTransportBoundaryError["disposition"],
          ) => {
            closeTimer ??= setTimeout(
              () =>
                rejectOnce(
                  new SshTransportBoundaryError(
                    "SSH process did not close after termination was requested.",
                    disposition,
                  ),
                ),
              milliseconds,
            );
          };
          const terminate = (error: SshTransportBoundaryError) => {
            boundaryError ??= error;
            if (platform === "win32" && child.pid !== undefined) {
              windowsTreeTermination ??= boundedWindowsTreeKill(child.pid);
              void windowsTreeTermination.then((terminationFailure) => {
                if (terminationFailure !== undefined) {
                  try {
                    child.kill("SIGKILL");
                  } catch {
                    // The SSH wrapper may already have exited.
                  }
                  rejectOnce(
                    new SshTransportBoundaryError(
                      terminationFailure.message,
                      error.disposition,
                    ),
                  );
                  return;
                }
                expectCloseWithin(
                  windowsTreeTerminationTimeoutMs,
                  error.disposition,
                );
              });
              return;
            }
            const terminationFailure = signalProcess("SIGTERM");
            if (terminationFailure !== undefined) {
              const forceFailure = signalProcess("SIGKILL");
              if (forceFailure !== undefined) {
                rejectOnce(
                  new SshTransportBoundaryError(
                    forceFailure.message,
                    error.disposition,
                  ),
                );
                return;
              }
              expectCloseWithin(cancellationGraceMs, error.disposition);
              return;
            }
            forceTimer ??= setTimeout(() => {
              const forceFailure = signalProcess("SIGKILL");
              if (forceFailure !== undefined) {
                rejectOnce(
                  new SshTransportBoundaryError(
                    forceFailure.message,
                    error.disposition,
                  ),
                );
                return;
              }
              expectCloseWithin(cancellationGraceMs, error.disposition);
            }, cancellationGraceMs);
            forceTimer.unref();
          };
          const requestRemoteCleanup = (
            disposition: "cancelled" | "timed-out",
          ) => {
            if (invocation.cancellationInput === undefined) {
              terminate(
                new SshTransportBoundaryError(
                  disposition === "cancelled"
                    ? "SSH transport was cancelled."
                    : "SSH transport timed out.",
                  disposition,
                ),
              );
              return;
            }
            if (interruption !== undefined) return;
            interruption = disposition;
            try {
              child.stdin.write(
                Buffer.from(invocation.cancellationInput),
                (error) => {
                  if (error === null || error === undefined) return;
                  terminate(
                    new SshTransportBoundaryError(
                      "SSH transport ended without remote cleanup proof.",
                      disposition,
                    ),
                  );
                },
              );
            } catch {
              terminate(
                new SshTransportBoundaryError(
                  "SSH transport ended without remote cleanup proof.",
                  disposition,
                ),
              );
              return;
            }
            remoteCleanupTimer ??= setTimeout(
              () =>
                terminate(
                  new SshTransportBoundaryError(
                    "SSH transport ended without remote cleanup proof.",
                    disposition,
                  ),
                ),
              invocation.cancellationGraceMs ?? cancellationGraceMs,
            );
          };
          const onAbort = () => requestRemoteCleanup("cancelled");
          const timeout = setTimeout(
            () => requestRemoteCleanup("timed-out"),
            invocation.timeoutMs,
          );
          const cleanup = () => {
            clearTimeout(timeout);
            if (closeTimer !== undefined) clearTimeout(closeTimer);
            if (forceTimer !== undefined) clearTimeout(forceTimer);
            if (remoteCleanupTimer !== undefined)
              clearTimeout(remoteCleanupTimer);
            invocation.signal.removeEventListener("abort", onAbort);
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
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
            void (async () => {
              if (settled) return;
              const terminationFailure = await windowsTreeTermination;
              if (terminationFailure !== undefined) {
                rejectOnce(terminationFailure);
                return;
              }
              if (boundaryError !== undefined) {
                rejectOnce(boundaryError);
                return;
              }
              settled = true;
              cleanup();
              resolve({
                exitCode: exitCode ?? 1,
                interruption,
                stderrBytes,
                stdout: new Uint8Array(Buffer.concat(stdout)),
              });
            })();
          });
          invocation.signal.addEventListener("abort", onAbort, { once: true });
          child.stdin.once("error", () => undefined);
          if (invocation.cancellationInput === undefined) {
            child.stdin.end(Buffer.from(invocation.input));
          } else {
            child.stdin.write(Buffer.from(invocation.input));
          }
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
  phase: "observe" | "version" | "wire" = "observe",
): Result<never, ObservationError> {
  return {
    error: { code, effects: "none", message, phase, retryable },
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
  const wireHarnessId = resolveLegacyHarnessAlias(options.binding.harness);
  let observing = false;
  let mutating = false;
  const privatePlans = new Map<
    string,
    {
      readonly mutation: NormalizedMutation;
      readonly prepared: PreparedMutation;
    }
  >();
  return {
    async executeConfirmed({ confirmation, signal }) {
      const privatePlan = privatePlans.get(confirmation.preparedMutationId);
      if (privatePlan === undefined) {
        return mutationExecutionFailure(
          "confirmation_invalid",
          "The Prepared Mutation is unavailable or has already been used.",
        );
      }
      privatePlans.delete(confirmation.preparedMutationId);
      if (privatePlan.prepared.digest !== confirmation.digest) {
        return mutationExecutionFailure(
          "confirmation_invalid",
          "The mutation confirmation does not match the Prepared Mutation.",
        );
      }
      if (
        options.clock().getTime() >= Date.parse(privatePlan.prepared.expiresAt)
      ) {
        return mutationExecutionFailure(
          "confirmation_expired",
          "The Prepared Mutation has expired.",
        );
      }
      if (observing || mutating) {
        return mutationExecutionFailure(
          "mutation_conflict",
          "Another operation is active for this Target.",
        );
      }
      if (signal.aborted) {
        return {
          ok: true,
          value: {
            effects: { status: "not-observed" },
            inventory: null,
            preparedMutationId: privatePlan.prepared.id,
            process: {
              disposition: "cancelled",
              exitCode: null,
              termination: "known",
            },
          },
        };
      }
      if (!wireHarnessId.ok) {
        return mutationExecutionFailure(
          "confirmation_invalid",
          "The Target harness is not supported by the pinned Skills dialect.",
        );
      }
      mutating = true;
      const requestId = options.id();
      const uncertainOutcome = (
        disposition: MutationOutcome["process"]["disposition"],
      ): Result<MutationOutcome, MutationExecutionError> => ({
        ok: true,
        value: {
          effects: { status: "possible" },
          inventory: null,
          preparedMutationId: privatePlan.prepared.id,
          process: { disposition, exitCode: null, termination: "unknown" },
        },
      });
      try {
        let transport: SshTransportOutcome;
        try {
          transport = await options.runner.run({
            args: sshArguments(options.binding),
            cancellationGraceMs: 2_000,
            cancellationInput: encodeWireFrame({
              operation: "cancel",
              protocolVersion: options.binding.ssh.wireDialect.protocolVersion,
              requestId,
              type: "request",
            }),
            configuration: options.binding.ssh.connectionConfig,
            executable: "ssh",
            input: encodeWireFrame({
              harness: wireHarnessId.value,
              mutation: privatePlan.mutation,
              operation: "mutate",
              protocolVersion: options.binding.ssh.wireDialect.protocolVersion,
              requestId,
              type: "request",
              workspace: options.binding.workspace,
            }),
            maxStderrBytes: MAX_SSH_STDERR_BYTES,
            maxStdoutBytes: MAX_SSH_STDOUT_BYTES,
            signal,
            timeoutMs:
              privatePlan.prepared.commandPlan.timeoutMs + 3 * SSH_TIMEOUT_MS,
          });
        } catch (error) {
          return uncertainOutcome(
            signal.aborted ||
              (error instanceof SshTransportBoundaryError &&
                error.disposition === "cancelled")
              ? "cancelled"
              : error instanceof SshTransportBoundaryError &&
                  error.disposition === "timed-out"
                ? "timed-out"
                : "failed",
          );
        }
        const decoded = decodeWireFrames(transport.stdout);
        if (!decoded.ok || decoded.value.length !== 2) {
          return uncertainOutcome(signal.aborted ? "cancelled" : "failed");
        }
        const [hello, response] = decoded.value;
        if (
          hello?.type !== "hello" ||
          hello.bootstrapDigest !==
            options.binding.ssh.wireDialect.bootstrapDigest ||
          response?.type !== "mutation-result" ||
          response.requestId !== requestId ||
          response.cliVersion !== CLI_VERSION ||
          response.process.cleanup !== "confirmed" ||
          transport.exitCode !== 0
        ) {
          return uncertainOutcome(signal.aborted ? "cancelled" : "failed");
        }
        const project = parseCliInventory(response.projectJson, "project");
        const global = parseCliInventory(response.globalJson, "global");
        if (!project.ok || !global.ok) {
          return {
            ok: true,
            value: {
              effects: { status: "possible" },
              inventory: null,
              preparedMutationId: privatePlan.prepared.id,
              process: {
                disposition: response.process.disposition,
                exitCode: response.process.exitCode,
                termination: "known",
              },
            },
          };
        }
        const inventory: Inventory = {
          cliVersion: CLI_VERSION,
          entries: [...project.value, ...global.value],
          observedAt: options.clock().toISOString(),
          schemaVersion: INVENTORY_SCHEMA_VERSION,
        };
        return {
          ok: true,
          value: {
            effects: observedMutationEffects(
              privatePlan.mutation,
              inventory,
              options.binding.harness,
            ),
            inventory,
            preparedMutationId: privatePlan.prepared.id,
            process: {
              disposition: response.process.disposition,
              exitCode: response.process.exitCode,
              termination: "known",
            },
          },
        };
      } finally {
        mutating = false;
      }
    },
    async observeInventory({ signal }) {
      if (!wireHarnessId.ok) {
        return observationFailure(
          "remote_protocol_violation",
          "The Target harness is not supported by the pinned Skills dialect.",
          false,
          "wire",
        );
      }
      if (observing || mutating) {
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
              harness: wireHarnessId.value,
              operation: "observe",
              protocolVersion: options.binding.ssh.wireDialect.protocolVersion,
              requestId,
              type: "request",
              workspace: options.binding.workspace,
            }),
            cancellationInput: encodeWireFrame({
              operation: "cancel",
              protocolVersion: options.binding.ssh.wireDialect.protocolVersion,
              requestId,
              type: "request",
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
          if (
            response.requestId !== requestId ||
            (response.phase !== "observe" && response.phase !== "version")
          ) {
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
                  ? response.phase === "version"
                    ? "process_failed"
                    : "inventory_too_large"
                  : "process_failed",
            response.code === "remote_runtime_unavailable"
              ? "The remote runtime is unavailable."
              : response.code === "remote_protocol_violation"
                ? "The Remote Bootstrap rejected the Wire request."
                : response.code === "output_limit_exceeded"
                  ? response.phase === "version"
                    ? "Remote runtime verification output exceeded its byte limit."
                    : "Remote Inventory output exceeded its byte limit."
                  : response.phase === "version"
                    ? "Remote runtime verification failed."
                    : "Remote Inventory observation failed.",
            response.code === "remote_operation_failed",
            response.phase,
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
    async prepareMutation(input) {
      const planned = prepareMutationPlan({
        binding: options.binding,
        clock: options.clock,
        id: options.id,
        input,
      });
      if (!planned.ok) return planned;

      privatePlans.clear();
      privatePlans.set(planned.value.prepared.id, {
        mutation: planned.value.mutation,
        prepared: planned.value.prepared,
      });
      return { ok: true, value: structuredClone(planned.value.prepared) };
    },
  };
}
