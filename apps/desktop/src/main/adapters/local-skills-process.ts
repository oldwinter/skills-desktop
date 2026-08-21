import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { win32 } from "node:path";

import {
  CLI_PACKAGE,
  CLI_VERSION,
  INVENTORY_SCHEMA_VERSION,
  MAX_CLI_OUTPUT_BYTES,
  parseCliInventory,
  type Inventory,
  type InventoryParseError,
  type PublicError,
  type Result,
} from "@skills-desktop/skills-runtime";

const OBSERVATION_TIMEOUT_MS = 60_000;

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

export type ObservationError =
  | InventoryParseError
  | PublicError<"cancelled" | "cli_incompatible" | "process_failed">;

export interface SkillsProcess {
  observeInventory(input: {
    readonly signal: AbortSignal;
  }): Promise<Result<Inventory, ObservationError>>;
}

export interface LocalSkillsProcessOptions {
  readonly clock: () => Date;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly runner: ProcessRunner;
  readonly windowsNpxCommand?: WindowsNpxCommand;
  readonly workspace: string;
}

export interface SpawnProcessRunnerOptions {
  readonly cancellationGraceMs?: number;
  readonly killWindowsTree?: (pid: number) => Promise<void>;
  readonly platform: NodeJS.Platform;
  readonly windowsTreeTerminationTimeoutMs?: number;
}

export interface WindowsNpxCommand {
  readonly executable: string;
  readonly npxCliPath: string;
}

function processBoundaryError(message: string) {
  const error = new Error(message);
  error.name = "ProcessBoundaryError";
  return error;
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
    ((pid: number) => {
      return new Promise<void>((resolve, reject) => {
        execFile(
          "taskkill.exe",
          ["/pid", String(pid), "/t", "/f"],
          {
            shell: false,
            timeout: windowsTreeTerminationTimeoutMs,
            windowsHide: true,
          },
          (error) => {
            if (error === null) resolve();
            else reject(error);
          },
        );
      });
    });
  const boundedWindowsTreeKill = (pid: number) =>
    new Promise<Error | undefined>((resolve) => {
      let finished = false;
      const finish = (error: Error | undefined) => {
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
          ),
        );
      }

      return new Promise((resolve, reject) => {
        const child = spawn(invocation.executable, invocation.args, {
          cwd: invocation.cwd,
          detached: options.platform !== "win32",
          env: invocation.env,
          shell: invocation.shell,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: invocation.windowsHide,
          windowsVerbatimArguments: false,
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let boundaryFailure: Error | undefined;
        let closeTimer: NodeJS.Timeout | undefined;
        let forceTimer: NodeJS.Timeout | undefined;
        let settled = false;
        let timeout: NodeJS.Timeout | undefined;
        let windowsTreeTermination: Promise<Error | undefined> | undefined;

        const cleanup = () => {
          if (timeout !== undefined) clearTimeout(timeout);
          if (forceTimer !== undefined) clearTimeout(forceTimer);
          if (closeTimer !== undefined) clearTimeout(closeTimer);
          invocation.signal.removeEventListener("abort", onAbort);
        };

        const rejectOnce = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const resolveOnce = (exitCode: number | null) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
            exitCode: exitCode ?? 1,
            stderr: Buffer.concat(stderr).toString("utf8"),
            stdout: Buffer.concat(stdout).toString("utf8"),
          });
        };

        const expectCloseWithin = (milliseconds: number) => {
          closeTimer ??= setTimeout(
            () =>
              rejectOnce(
                processBoundaryError(
                  "Process did not close after termination was requested.",
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
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
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
            signalTree("SIGKILL");
            expectCloseWithin(cancellationGraceMs);
          }
        };

        const terminateTree = () => {
          if (options.platform === "win32") {
            forceTree();
          } else {
            signalTree("SIGTERM");
            forceTimer ??= setTimeout(forceTree, cancellationGraceMs);
            forceTimer.unref();
          }
        };

        const onAbort = () => terminateTree();
        invocation.signal.addEventListener("abort", onAbort, { once: true });

        timeout = setTimeout(() => {
          boundaryFailure = processBoundaryError(
            "Process invocation exceeded its time limit.",
          );
          terminateTree();
        }, invocation.timeoutMs);
        timeout.unref();

        const collect = (
          destination: Buffer[],
          chunk: Buffer,
          stream: "stderr" | "stdout",
        ) => {
          if (stream === "stdout") stdoutBytes += chunk.byteLength;
          else stderrBytes += chunk.byteLength;
          if (
            stdoutBytes > invocation.maxOutputBytes ||
            stderrBytes > invocation.maxOutputBytes
          ) {
            boundaryFailure = processBoundaryError(
              "Process output exceeded its byte limit.",
            );
            terminateTree();
            return;
          }
          destination.push(chunk);
        };

        child.stdout.on("data", (chunk: Buffer) =>
          collect(stdout, chunk, "stdout"),
        );
        child.stderr.on("data", (chunk: Buffer) =>
          collect(stderr, chunk, "stderr"),
        );
        child.once("error", (error) => {
          boundaryFailure = processBoundaryError(
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? "Process executable is unavailable."
              : "Process invocation could not start.",
          );
        });
        child.once("close", (exitCode) => {
          void (async () => {
            const terminationFailure = await windowsTreeTermination;
            if (terminationFailure !== undefined) {
              rejectOnce(terminationFailure);
              return;
            }
            if (boundaryFailure !== undefined) {
              rejectOnce(boundaryFailure);
              return;
            }
            resolveOnce(exitCode);
          })();
        });
      });
    },
  };
}

function observationFailure(
  code: "cancelled" | "cli_incompatible" | "process_failed",
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

  const invoke = async (args: readonly string[], signal: AbortSignal) => {
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
      timeoutMs: OBSERVATION_TIMEOUT_MS,
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

  return {
    async observeInventory({ signal }) {
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
    },
  };
}
