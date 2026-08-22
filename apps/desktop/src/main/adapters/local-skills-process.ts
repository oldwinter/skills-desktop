import { spawn } from "node:child_process";
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import {
  CLI_PACKAGE,
  CLI_VERSION,
  INVENTORY_SCHEMA_VERSION,
  MAX_CLI_OUTPUT_BYTES,
  parseCliInventory,
  type Inventory,
  type Result,
} from "@skills-desktop/skills-runtime";

import {
  mutationExecutionFailure,
  observedMutationEffects,
  prepareMutationPlan,
  type MutationOutcome,
  type ObservationError,
  type PreparedMutation,
  type SkillsProcess,
} from "./skills-process.js";
import { createWindowsProcessTreeKiller } from "./windows-process-tree.js";

const OBSERVATION_TIMEOUT_MS = 60_000;

export type {
  CommandPlan,
  ConfirmedMutation,
  MutationExecutionError,
  MutationOutcome,
  MutationPreparationError,
  ObservationError,
  PreparedMutation,
  PrepareMutationInput,
  SkillsProcess,
} from "./skills-process.js";

export interface ProcessInvocation {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly executable: string;
  readonly maxOutputBytes: number;
  readonly shell: false;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly windowsHide: true;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface ProcessRunner {
  run(invocation: ProcessInvocation): Promise<ProcessResult>;
}

export class ProcessBoundaryError extends Error {
  constructor(
    message: string,
    readonly disposition: "cancelled" | "failed" | "timed-out" = "failed",
    readonly started = false,
    readonly termination: "known" | "unknown" = "known",
  ) {
    super(message);
    this.name = "ProcessBoundaryError";
  }
}

export interface LocalSkillsProcessOptions {
  readonly binding?: {
    readonly generation: number;
    readonly harness: string;
    readonly targetId: string;
  };
  readonly clock: () => Date;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly id?: () => string;
  readonly platform: NodeJS.Platform;
  readonly runner: ProcessRunner;
  readonly windowsNpxCommand?: WindowsNpxCommand;
  readonly workspace: string;
}

export interface SpawnProcessRunnerOptions {
  readonly cancellationGraceMs?: number;
  readonly killWindowsTree?: (pid: number) => Promise<void>;
  readonly platform: NodeJS.Platform;
  readonly temporaryDirectory?: string;
  readonly windowsTreeTerminationTimeoutMs?: number;
}

export interface WindowsNpxCommand {
  readonly executable: string;
  readonly npxCliPath: string;
}

function processBoundaryError(
  message: string,
  disposition: ProcessBoundaryError["disposition"] = "failed",
  started = false,
  termination: ProcessBoundaryError["termination"] = "known",
) {
  return new ProcessBoundaryError(message, disposition, started, termination);
}

export async function resolveWindowsNpxCommand(
  environment: Readonly<Record<string, string>>,
  exists: (path: string) => Promise<boolean> = async (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
): Promise<WindowsNpxCommand> {
  const directories = (environment.PATH ?? "")
    .split(win32.delimiter)
    .map((directory) => directory.trim().replace(/^"|"$/g, ""))
    .filter((directory) => directory !== "");
  let executable: string | undefined;
  let npxCliPath: string | undefined;

  for (const directory of directories) {
    const nodeCandidate = win32.join(directory, "node.exe");
    const cliCandidate = win32.join(
      directory,
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js",
    );
    if (executable === undefined && (await exists(nodeCandidate)))
      executable = nodeCandidate;
    if (npxCliPath === undefined && (await exists(cliCandidate)))
      npxCliPath = cliCandidate;
    if (executable !== undefined && npxCliPath !== undefined) {
      return { executable, npxCliPath };
    }
  }

  throw processBoundaryError(
    "The Windows Node.js and npx entry points are unavailable.",
  );
}

export function createSpawnProcessRunner(
  options: SpawnProcessRunnerOptions,
): ProcessRunner {
  const cancellationGraceMs = options.cancellationGraceMs ?? 2_000;
  const windowsTreeTerminationTimeoutMs =
    options.windowsTreeTerminationTimeoutMs ?? 2_000;
  const killWindowsTree =
    options.killWindowsTree ??
    createWindowsProcessTreeKiller(windowsTreeTerminationTimeoutMs);
  const boundedWindowsTreeKill = (pid: number) =>
    new Promise<ProcessBoundaryError | undefined>((resolve) => {
      let finished = false;
      const finish = (error: ProcessBoundaryError | undefined) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(error);
      };
      const timer = setTimeout(
        () =>
          finish(
            processBoundaryError(
              "Process tree termination could not be confirmed.",
              "failed",
              true,
              "unknown",
            ),
          ),
        windowsTreeTerminationTimeoutMs,
      );
      void killWindowsTree(pid).then(
        () => finish(undefined),
        () =>
          finish(
            processBoundaryError(
              "Process tree termination could not be confirmed.",
              "failed",
              true,
              "unknown",
            ),
          ),
      );
    });

  return {
    run(invocation) {
      if (invocation.signal.aborted) {
        return Promise.reject(
          processBoundaryError(
            "Process invocation was cancelled before spawn.",
            "cancelled",
          ),
        );
      }

      let captureDirectory: string | undefined;
      let stdoutFile: number | undefined;
      try {
        captureDirectory = mkdtempSync(
          join(
            options.temporaryDirectory ?? tmpdir(),
            "skills-desktop-process-",
          ),
        );
        const stdoutPath = join(captureDirectory, "stdout");
        stdoutFile = openSync(stdoutPath, "wx+", 0o600);
        if (options.platform !== "win32") unlinkSync(stdoutPath);
      } catch {
        if (stdoutFile !== undefined) {
          try {
            closeSync(stdoutFile);
          } catch {
            // The descriptor may already be closed after a preparation failure.
          }
        }
        if (captureDirectory !== undefined) {
          try {
            rmSync(captureDirectory, { force: true, recursive: true });
          } catch {
            // The bounded public failure below intentionally hides filesystem details.
          }
        }
        return Promise.reject(
          processBoundaryError("Process output capture could not be prepared."),
        );
      }

      let processStarted = false;
      const pending = new Promise<ProcessResult>((resolve, reject) => {
        const child = spawn(invocation.executable, invocation.args, {
          cwd: invocation.cwd,
          detached: options.platform !== "win32",
          env: invocation.env,
          shell: invocation.shell,
          stdio: ["ignore", stdoutFile, "pipe"],
          windowsHide: invocation.windowsHide,
          windowsVerbatimArguments: false,
        });
        processStarted = child.pid !== undefined;
        const stderr: Buffer[] = [];
        let stderrBytes = 0;
        let boundaryFailure: ProcessBoundaryError | undefined;
        let closeTimer: NodeJS.Timeout | undefined;
        let forceTimer: NodeJS.Timeout | undefined;
        let outputTimer: NodeJS.Timeout | undefined;
        let settled = false;
        let timeout: NodeJS.Timeout | undefined;
        let windowsTreeTermination: Promise<Error | undefined> | undefined;

        const cleanup = () => {
          if (timeout !== undefined) clearTimeout(timeout);
          if (forceTimer !== undefined) clearTimeout(forceTimer);
          if (closeTimer !== undefined) clearTimeout(closeTimer);
          if (outputTimer !== undefined) clearInterval(outputTimer);
          invocation.signal.removeEventListener("abort", onAbort);
        };

        const rejectOnce = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const resolveOnce = (exitCode: number | null, stdout: Buffer) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
            exitCode: exitCode ?? 1,
            stderr: Buffer.concat(stderr).toString("utf8"),
            stdout: stdout.toString("utf8"),
          });
        };

        const expectCloseWithin = (milliseconds: number) => {
          closeTimer ??= setTimeout(
            () =>
              rejectOnce(
                processBoundaryError(
                  "Process did not close after termination was requested.",
                  invocation.signal.aborted
                    ? "cancelled"
                    : (boundaryFailure?.disposition ?? "failed"),
                  true,
                  "unknown",
                ),
              ),
            milliseconds,
          );
        };

        const signalTree = (signal: NodeJS.Signals) => {
          if (child.pid === undefined) return;
          try {
            if (options.platform === "win32") {
              child.kill(signal);
            } else {
              process.kill(-child.pid, signal);
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
              return processBoundaryError(
                "Process tree termination could not be confirmed.",
                invocation.signal.aborted
                  ? "cancelled"
                  : (boundaryFailure?.disposition ?? "failed"),
                true,
                "unknown",
              );
            }
          }
        };

        const forceTree = () => {
          if (child.pid === undefined) return;
          if (options.platform === "win32") {
            windowsTreeTermination ??= boundedWindowsTreeKill(child.pid);
            void windowsTreeTermination.then((terminationFailure) => {
              if (terminationFailure === undefined) {
                expectCloseWithin(windowsTreeTerminationTimeoutMs);
                return;
              }
              try {
                child.kill("SIGKILL");
              } catch {
                // The wrapper may have exited while tree termination was being checked.
              }
              rejectOnce(terminationFailure);
            });
          } else {
            const terminationFailure = signalTree("SIGKILL");
            if (terminationFailure !== undefined) {
              rejectOnce(terminationFailure);
              return;
            }
            expectCloseWithin(cancellationGraceMs);
          }
        };

        const terminateTree = () => {
          if (options.platform === "win32") {
            forceTree();
          } else {
            const terminationFailure = signalTree("SIGTERM");
            if (terminationFailure !== undefined) {
              forceTree();
              return;
            }
            forceTimer ??= setTimeout(forceTree, cancellationGraceMs);
            forceTimer.unref();
          }
        };

        const onAbort = () => terminateTree();
        invocation.signal.addEventListener("abort", onAbort, { once: true });

        timeout = setTimeout(() => {
          boundaryFailure = processBoundaryError(
            "Process invocation exceeded its time limit.",
            "timed-out",
            true,
          );
          terminateTree();
        }, invocation.timeoutMs);
        timeout.unref();

        const inspectOutputSize = () => {
          if (settled) return;
          try {
            if (
              fstatSync(stdoutFile).size > invocation.maxOutputBytes &&
              boundaryFailure === undefined
            ) {
              boundaryFailure = processBoundaryError(
                "Process output exceeded its byte limit.",
                "failed",
                true,
              );
              terminateTree();
            }
          } catch {
            if (boundaryFailure === undefined) {
              boundaryFailure = processBoundaryError(
                "Process output capture failed.",
                "failed",
                true,
              );
              terminateTree();
            }
          }
        };
        outputTimer = setInterval(inspectOutputSize, 10);
        outputTimer.unref();

        if (child.stderr === null) {
          boundaryFailure = processBoundaryError(
            "Process output capture failed.",
            "failed",
            true,
          );
          terminateTree();
        } else {
          child.stderr.on("data", (chunk: Buffer) => {
            stderrBytes += chunk.byteLength;
            if (stderrBytes > invocation.maxOutputBytes) {
              boundaryFailure = processBoundaryError(
                "Process output exceeded its byte limit.",
                "failed",
                true,
              );
              terminateTree();
              return;
            }
            stderr.push(chunk);
          });
        }
        child.once("error", (error) => {
          boundaryFailure = processBoundaryError(
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? "Process executable is unavailable."
              : "Process invocation could not start.",
            "failed",
            false,
          );
        });
        child.once("close", (exitCode) => {
          void (async () => {
            const terminationFailure = await windowsTreeTermination;
            if (terminationFailure !== undefined) {
              rejectOnce(terminationFailure);
              return;
            }
            let stdoutSize: number;
            try {
              stdoutSize = fstatSync(stdoutFile).size;
            } catch {
              rejectOnce(
                processBoundaryError(
                  "Process output capture failed.",
                  "failed",
                  true,
                ),
              );
              return;
            }
            if (stdoutSize > invocation.maxOutputBytes) {
              boundaryFailure ??= processBoundaryError(
                "Process output exceeded its byte limit.",
                "failed",
                true,
              );
            }
            if (boundaryFailure !== undefined) {
              rejectOnce(boundaryFailure);
              return;
            }
            const stdout = Buffer.alloc(stdoutSize);
            let offset = 0;
            while (offset < stdoutSize) {
              const bytesRead = readSync(
                stdoutFile,
                stdout,
                offset,
                stdoutSize - offset,
                offset,
              );
              if (bytesRead === 0) break;
              offset += bytesRead;
            }
            if (offset !== stdoutSize) {
              rejectOnce(
                processBoundaryError(
                  "Process output capture failed.",
                  "failed",
                  true,
                ),
              );
              return;
            }
            resolveOnce(exitCode, stdout);
          })().catch(() => {
            rejectOnce(
              processBoundaryError(
                "Process output capture failed.",
                "failed",
                true,
              ),
            );
          });
        });
      });

      return pending.finally(() => {
        let cleanupFailed = false;
        try {
          closeSync(stdoutFile);
        } catch {
          cleanupFailed = true;
        }
        try {
          rmSync(captureDirectory, { force: true, recursive: true });
        } catch {
          cleanupFailed = true;
        }
        if (cleanupFailed) {
          throw processBoundaryError(
            "Temporary process output could not be removed.",
            "failed",
            processStarted,
          );
        }
      });
    },
  };
}

function observationFailure(
  code:
    "cancelled" | "cli_incompatible" | "mutation_conflict" | "process_failed",
  message: string,
  phase: "observe" | "version",
  retryable: boolean,
): Result<never, ObservationError> {
  return {
    error: { code, effects: "none", message, phase, retryable },
    ok: false,
  };
}

function allowedEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): Readonly<Record<string, string>> {
  const names = [
    "APPDATA",
    "ComSpec",
    "HOME",
    "LOCALAPPDATA",
    "NPM_CONFIG_CACHE",
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
  ];
  const sourceEntries = Object.entries(source);
  return Object.fromEntries(
    names.flatMap((name) => {
      const value =
        source[name] ??
        (platform === "win32"
          ? sourceEntries.find(
              ([candidate]) => candidate.toLowerCase() === name.toLowerCase(),
            )?.[1]
          : undefined);
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

export function createLocalSkillsProcess(
  options: LocalSkillsProcessOptions,
): SkillsProcess {
  const environment = allowedEnvironment(
    options.environment ?? process.env,
    options.platform,
  );
  const command =
    options.platform === "win32"
      ? Promise.resolve(
          options.windowsNpxCommand ?? resolveWindowsNpxCommand(environment),
        )
      : Promise.resolve({ executable: "npx", npxCliPath: undefined });
  let dialectVerification: Promise<Result<void, ObservationError>> | undefined;
  const privatePlans = new Map<
    string,
    {
      readonly args: readonly string[];
      readonly mutation: Parameters<typeof observedMutationEffects>[0];
      readonly prepared: PreparedMutation;
    }
  >();
  let activeOperation: "mutation" | "observation" | undefined;

  const invoke = async (
    args: readonly string[],
    signal: AbortSignal,
    timeoutMs = OBSERVATION_TIMEOUT_MS,
  ) => {
    const resolved = await command;
    return options.runner.run({
      args: [
        ...(resolved.npxCliPath === undefined ? [] : [resolved.npxCliPath]),
        "--yes",
        CLI_PACKAGE,
        ...args,
      ],
      cwd: options.workspace,
      env: environment,
      executable: resolved.executable,
      maxOutputBytes: MAX_CLI_OUTPUT_BYTES,
      shell: false,
      signal,
      timeoutMs,
      windowsHide: true,
    });
  };

  const verifyDialect = async (signal: AbortSignal) => {
    const verification =
      dialectVerification ??
      (async () => {
        if (signal.aborted) {
          return observationFailure(
            "cancelled",
            "Inventory observation was cancelled.",
            "version",
            true,
          );
        }

        try {
          const outcome = await invoke(["--version"], signal);
          if (signal.aborted) {
            return observationFailure(
              "cancelled",
              "Inventory observation was cancelled.",
              "version",
              true,
            );
          }
          if (outcome.exitCode !== 0) {
            return observationFailure(
              "process_failed",
              "The Skills CLI version check failed.",
              "version",
              true,
            );
          }
          if (outcome.stdout.trim() !== CLI_VERSION) {
            return observationFailure(
              "cli_incompatible",
              "The installed Skills CLI dialect is not supported.",
              "version",
              false,
            );
          }
          return { ok: true, value: undefined };
        } catch {
          return signal.aborted
            ? observationFailure(
                "cancelled",
                "Inventory observation was cancelled.",
                "version",
                true,
              )
            : observationFailure(
                "process_failed",
                "The Skills CLI version check failed.",
                "version",
                true,
              );
        }
      })();
    dialectVerification = verification;
    const result = await verification;
    if (
      !result.ok &&
      result.error.code === "cancelled" &&
      dialectVerification === verification
    ) {
      dialectVerification = undefined;
    }
    return result;
  };

  const observeInventory = async (
    { signal }: { readonly signal: AbortSignal },
    ownsCriticalSection = false,
  ): Promise<Result<Inventory, ObservationError>> => {
    if (!ownsCriticalSection) {
      if (activeOperation !== undefined) {
        return observationFailure(
          "mutation_conflict",
          "Another operation is active for this Target.",
          "observe",
          true,
        );
      }
      activeOperation = "observation";
    }
    try {
      if (signal.aborted) {
        return observationFailure(
          "cancelled",
          "Inventory observation was cancelled.",
          "observe",
          true,
        );
      }

      const verified = await verifyDialect(signal);
      if (!verified.ok) return verified;

      try {
        const [projectOutcome, globalOutcome] = await Promise.all([
          invoke(["list", "--json"], signal),
          invoke(["list", "--global", "--json"], signal),
        ]);

        if (signal.aborted) {
          return observationFailure(
            "cancelled",
            "Inventory observation was cancelled.",
            "observe",
            true,
          );
        }
        if (projectOutcome.exitCode !== 0 || globalOutcome.exitCode !== 0) {
          return observationFailure(
            "process_failed",
            "Inventory observation failed.",
            "observe",
            true,
          );
        }

        const project = parseCliInventory(projectOutcome.stdout, "project");
        if (!project.ok) return project;
        const global = parseCliInventory(globalOutcome.stdout, "global");
        if (!global.ok) return global;

        return {
          ok: true,
          value: {
            cliVersion: CLI_VERSION,
            entries: [...project.value, ...global.value],
            observedAt: options.clock().toISOString(),
            schemaVersion: INVENTORY_SCHEMA_VERSION,
          },
        };
      } catch {
        return signal.aborted
          ? observationFailure(
              "cancelled",
              "Inventory observation was cancelled.",
              "observe",
              true,
            )
          : observationFailure(
              "process_failed",
              "Inventory observation failed.",
              "observe",
              true,
            );
      }
    } finally {
      if (!ownsCriticalSection && activeOperation === "observation") {
        activeOperation = undefined;
      }
    }
  };

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
      if (activeOperation !== undefined) {
        return mutationExecutionFailure(
          "mutation_conflict",
          "Another operation is active for this Target.",
        );
      }
      activeOperation = "mutation";

      try {
        let processOutcome: MutationOutcome["process"];
        if (signal.aborted) {
          processOutcome = {
            disposition: "cancelled",
            exitCode: null,
            termination: "known",
          };
        } else {
          try {
            const outcome = await invoke(
              privatePlan.args,
              signal,
              privatePlan.prepared.commandPlan.timeoutMs,
            );
            processOutcome = {
              disposition: signal.aborted
                ? "cancelled"
                : outcome.exitCode === 0
                  ? "completed"
                  : "failed",
              exitCode: outcome.exitCode,
              termination: "known",
            };
          } catch (error) {
            const boundary =
              error instanceof ProcessBoundaryError ? error : undefined;
            processOutcome = {
              disposition: signal.aborted
                ? "cancelled"
                : (boundary?.disposition ?? "failed"),
              exitCode: null,
              termination: boundary?.termination ?? "unknown",
            };
            if (processOutcome.termination === "unknown") {
              return {
                ok: true,
                value: {
                  effects: {
                    status:
                      boundary?.started === false ? "not-observed" : "possible",
                  },
                  inventory: null,
                  preparedMutationId: privatePlan.prepared.id,
                  process: processOutcome,
                },
              };
            }
          }
        }

        const postflight = await observeInventory(
          { signal: new AbortController().signal },
          true,
        );
        if (!postflight.ok) {
          return {
            ok: true,
            value: {
              effects: { status: "possible" },
              inventory: null,
              preparedMutationId: privatePlan.prepared.id,
              process: processOutcome,
            },
          };
        }
        return {
          ok: true,
          value: {
            effects: observedMutationEffects(
              privatePlan.mutation,
              postflight.value,
              options.binding?.harness ?? "",
            ),
            inventory: postflight.value,
            preparedMutationId: privatePlan.prepared.id,
            process: processOutcome,
          },
        };
      } finally {
        if (activeOperation === "mutation") activeOperation = undefined;
      }
    },
    observeInventory,
    async prepareMutation(input) {
      const planned = prepareMutationPlan({
        binding: options.binding,
        clock: options.clock,
        id: options.id,
        input,
      });
      if (!planned.ok) return planned;

      privatePlans.clear();
      privatePlans.set(planned.value.prepared.id, planned.value);
      return { ok: true, value: structuredClone(planned.value.prepared) };
    },
  };
}
