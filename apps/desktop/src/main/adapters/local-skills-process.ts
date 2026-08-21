import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { win32 } from "node:path";

import {
  CLI_PACKAGE,
  CLI_VERSION,
  INVENTORY_SCHEMA_VERSION,
  MAX_CLI_OUTPUT_BYTES,
  mutationIntentSchema,
  parseCliInventory,
  type Inventory,
  type InventoryParseError,
  type MutationIntent,
  type PublicError,
  type Result,
} from "@skills-desktop/skills-runtime";

const OBSERVATION_TIMEOUT_MS = 60_000;
const PREPARED_MUTATION_TTL_MS = 10 * 60_000;
const REMOVE_TIMEOUT_MS = 2 * 60_000;
const WRITE_TIMEOUT_MS = 10 * 60_000;

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

export type ObservationError =
  | InventoryParseError
  | PublicError<
      | "cancelled"
      | "cli_incompatible"
      | "mutation_conflict"
      | "process_failed"
      | "remote_protocol_mismatch"
      | "remote_protocol_violation"
      | "remote_runtime_unavailable"
      | "transport_failed"
      | "transport_lost"
    >;

export interface CommandPlan {
  readonly harness: string;
  readonly names: readonly string[];
  readonly operation: "add" | "remove" | "update";
  readonly preview: string;
  readonly schemaVersion: 1;
  readonly scope: "global" | "project";
  readonly source: { readonly source: string; readonly sourceType: "github" } | null;
  readonly targetId: string;
  readonly timeoutMs: number;
}

export interface PreparedMutation {
  readonly commandPlan: CommandPlan;
  readonly digest: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly inventoryId: string;
  readonly targetGeneration: number;
  readonly targetId: string;
}

export type MutationPreparationError = PublicError<
  "invalid_intent" | "mutation_ineligible" | "stale_inventory"
>;

export interface PrepareMutationInput {
  readonly freshness: "fresh";
  readonly intent: MutationIntent;
  readonly inventory: Inventory;
  readonly inventoryId: string;
}

export interface ConfirmedMutation {
  readonly digest: string;
  readonly preparedMutationId: string;
}

export interface MutationOutcome {
  readonly effects: {
    readonly status:
      | "content-unverified"
      | "not-observed"
      | "possible"
      | "verified";
  };
  readonly inventory: Inventory | null;
  readonly preparedMutationId: string;
  readonly process: {
    readonly disposition: "cancelled" | "completed" | "failed" | "timed-out";
    readonly exitCode: number | null;
    readonly termination: "known" | "unknown";
  };
}

export type MutationExecutionError = PublicError<
  "confirmation_expired" | "confirmation_invalid" | "mutation_conflict"
>;

export interface SkillsProcess {
  executeConfirmed(input: {
    readonly confirmation: ConfirmedMutation;
    readonly signal: AbortSignal;
  }): Promise<Result<MutationOutcome, MutationExecutionError>>;
  observeInventory(input: {
    readonly signal: AbortSignal;
  }): Promise<Result<Inventory, ObservationError>>;
  prepareMutation(
    input: PrepareMutationInput,
  ): Promise<Result<PreparedMutation, MutationPreparationError>>;
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
  return new ProcessBoundaryError(
    message,
    disposition,
    started,
    termination,
  );
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
        let boundaryFailure: ProcessBoundaryError | undefined;
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
              "failed",
              true,
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
  code:
    | "cancelled"
    | "cli_incompatible"
    | "mutation_conflict"
    | "process_failed",
  message: string,
  phase: "observe" | "version",
  retryable: boolean,
): Result<never, ObservationError> {
  return {
    error: { code, effects: "none", message, phase, retryable },
    ok: false,
  };
}

function preparationFailure(
  code: MutationPreparationError["code"],
  message: string,
): Result<never, MutationPreparationError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "prepare",
      retryable: code === "stale_inventory",
    },
    ok: false,
  };
}

function executionFailure(
  code: MutationExecutionError["code"],
  message: string,
): Result<never, MutationExecutionError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "execute",
      retryable: code === "mutation_conflict",
    },
    ok: false,
  };
}

function operationFor(intent: MutationIntent): CommandPlan["operation"] {
  return intent.type === "update-all" ? "update" : intent.type;
}

function scopeFlag(
  scope: MutationIntent["scope"],
  operation: CommandPlan["operation"],
) {
  if (scope === "global") return "--global";
  return operation === "update" ? "--project" : undefined;
}

function executableArguments(
  intent: Exclude<MutationIntent, { readonly type: "update-all" }>,
  harness: string,
): readonly string[] {
  const flag = scopeFlag(intent.scope, intent.type);
  if (intent.type === "add") {
    return [
      "add",
      intent.source.source,
      "--skill",
      ...intent.names,
      "--agent",
      harness.toLowerCase(),
      ...(flag === undefined ? [] : [flag]),
      "--yes",
    ];
  }
  if (intent.type === "remove") {
    return [
      "remove",
      ...intent.names,
      "--agent",
      harness.toLowerCase(),
      ...(flag === undefined ? [] : [flag]),
      "--yes",
    ];
  }
  return [
    "update",
    ...intent.names,
    ...(flag === undefined ? [] : [flag]),
    "--yes",
  ];
}

function explanatoryPreview(args: readonly string[]) {
  return [`npx skills@${CLI_VERSION}`, ...args].join(" ");
}

function observedEffects(
  intent: Exclude<MutationIntent, { readonly type: "update-all" }>,
  inventory: Inventory,
  harness: string,
): MutationOutcome["effects"] {
  const matches = (name: string) =>
    inventory.entries.find(
      (entry) => entry.name === name && entry.scope === intent.scope,
    );
  if (intent.type === "remove") {
    return {
      status: intent.names.every(
        (name) => !matches(name)?.agents.includes(harness),
      )
        ? "verified"
        : "not-observed",
    };
  }
  if (intent.type === "add") {
    return {
      status: intent.names.every((name) => {
        const entry = matches(name);
        return (
          entry?.agents.includes(harness) === true &&
          entry.declaredSource.sourceType === intent.source.sourceType &&
          entry.declaredSource.source === intent.source.source
        );
      })
        ? "verified"
        : "not-observed",
    };
  }
  if (
    intent.names.some((name) => !matches(name)?.agents.includes(harness))
  ) {
    return { status: "not-observed" };
  }
  return { status: "content-unverified" };
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
      readonly intent: Exclude<MutationIntent, { readonly type: "update-all" }>;
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
        return executionFailure(
          "confirmation_invalid",
          "The Prepared Mutation is unavailable or has already been used.",
        );
      }
      privatePlans.delete(confirmation.preparedMutationId);
      if (privatePlan.prepared.digest !== confirmation.digest) {
        return executionFailure(
          "confirmation_invalid",
          "The mutation confirmation does not match the Prepared Mutation.",
        );
      }
      if (options.clock().getTime() >= Date.parse(privatePlan.prepared.expiresAt)) {
        return executionFailure(
          "confirmation_expired",
          "The Prepared Mutation has expired.",
        );
      }
      if (activeOperation !== undefined) {
        return executionFailure(
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
              disposition:
                signal.aborted
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
            effects: observedEffects(
              privatePlan.intent,
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
      if (options.binding === undefined) {
        return preparationFailure(
          "mutation_ineligible",
          "This Skills Process is not bound to a Target.",
        );
      }
      if (
        input.freshness !== "fresh" ||
        typeof input.inventoryId !== "string" ||
        input.inventoryId.length === 0 ||
        input.inventoryId.length > 256
      ) {
        return preparationFailure(
          "stale_inventory",
          "A Fresh Inventory is required to prepare a mutation.",
        );
      }
      const parsedIntent = mutationIntentSchema.safeParse(input.intent);
      if (!parsedIntent.success) {
        return preparationFailure(
          "invalid_intent",
          "The mutation intent is not supported.",
        );
      }

      const matchingEntries = input.inventory.entries.filter(
        (entry) =>
          entry.scope === parsedIntent.data.scope &&
          entry.agents.includes(options.binding!.harness),
      );
      const expandedIntent: Exclude<
        MutationIntent,
        { readonly type: "update-all" }
      > =
        parsedIntent.data.type === "update-all"
          ? {
              names: matchingEntries.map(({ name }) => name),
              scope: parsedIntent.data.scope,
              type: "update",
            }
          : parsedIntent.data;
      if (expandedIntent.names.length === 0) {
        return preparationFailure(
          "mutation_ineligible",
          "No matching Skills are eligible for this mutation.",
        );
      }
      if (
        expandedIntent.type !== "add" &&
        expandedIntent.names.some(
          (name) => !matchingEntries.some((entry) => entry.name === name),
        )
      ) {
        return preparationFailure(
          "mutation_ineligible",
          "The selected Skills are not present in the Fresh Inventory.",
        );
      }

      const args = executableArguments(expandedIntent, options.binding.harness);
      const operation = operationFor(expandedIntent);
      const commandPlan: CommandPlan = {
        harness: options.binding.harness,
        names: [...expandedIntent.names],
        operation,
        preview: explanatoryPreview(args),
        schemaVersion: 1,
        scope: expandedIntent.scope,
        source:
          expandedIntent.type === "add"
            ? { ...expandedIntent.source }
            : null,
        targetId: options.binding.targetId,
        timeoutMs: operation === "remove" ? REMOVE_TIMEOUT_MS : WRITE_TIMEOUT_MS,
      };
      const id = options.id?.() ?? createHash("sha256")
        .update(`${options.clock().toISOString()}\0${input.inventoryId}\0${commandPlan.preview}`)
        .digest("hex");
      const expiresAt = new Date(
        options.clock().getTime() + PREPARED_MUTATION_TTL_MS,
      ).toISOString();
      const digest = createHash("sha256")
        .update(
          JSON.stringify({
            commandPlan,
            expiresAt,
            id,
            inventoryId: input.inventoryId,
            targetGeneration: options.binding.generation,
            targetId: options.binding.targetId,
          }),
        )
        .digest("hex");
      const prepared: PreparedMutation = {
        commandPlan,
        digest,
        expiresAt,
        id,
        inventoryId: input.inventoryId,
        targetGeneration: options.binding.generation,
        targetId: options.binding.targetId,
      };
      privatePlans.clear();
      privatePlans.set(id, { args, intent: expandedIntent, prepared });
      return { ok: true, value: structuredClone(prepared) };
    },
  };
}
