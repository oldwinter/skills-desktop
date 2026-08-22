import { randomUUID } from "node:crypto";

import {
  aboutReleaseDiagnosticsSchema,
  releaseCandidateIdentitySchema,
  type AboutUpdateSnapshot,
  type ReleaseCandidateIdentity,
  type RestartGuardReason,
} from "../../contracts/about.js";
import type {
  DeferredUpdateRecord,
  DeferredUpdateRecords,
} from "../persistence/deferred-update-records.js";
import {
  selectUpdatePlatformPolicy,
  type UpdateApplicationIdentity,
} from "./update-platform-policy.js";

const STARTUP_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_DIAGNOSTIC_BYTES = 16_384;

const RESTART_GUARD_ORDER: readonly RestartGuardReason[] = [
  "mutation-active",
  "protected-process-active",
  "trusted-review-active",
  "reconciliation-required",
  "recovery-uncertain",
];

type AboutUpdateSnapshotV2 = Extract<
  AboutUpdateSnapshot,
  { readonly schemaVersion: 2 }
>;

interface UpdateClock {
  now(): Date;
}

interface UpdateCheckRecords {
  load(): Promise<string | null>;
  save(checkedAt: string): Promise<void>;
}

interface UpdateScheduler {
  after(
    delayMs: number,
    action: () => void | Promise<void>,
  ): () => void;
}

interface UpdateAdapter {
  checkForUpdates(input: {
    readonly feedUrl: string;
    readonly onEvent: (
      event: UpdateAdapterEvent,
    ) => void | Promise<void>;
  }): void;
  restartAndInstall?(): void;
}

interface ReleaseDiagnosticsExporter {
  export(source: string): Promise<"cancelled" | "saved">;
}

export type UpdateAdapterEvent =
  | { readonly type: "checking" }
  | { readonly error?: unknown; readonly type: "error" }
  | { readonly type: "update-available" }
  | {
      readonly candidateVersion?: string;
      readonly type: "update-downloaded";
    }
  | { readonly type: "update-not-available" };

export type RestartRequestOutcome =
  | "blocked"
  | "cancelled"
  | "stale"
  | "started";

function memoryDeferredRecords(): DeferredUpdateRecords {
  let record: DeferredUpdateRecord | null = null;
  return {
    async clear() {
      record = null;
    },
    async load() {
      return record === null ? null : structuredClone(record);
    },
    async save(next) {
      record = structuredClone(next);
    },
  };
}

function versionOrder(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(value);
  if (match === null) return undefined;
  const numbers = match.slice(1, 4).map(Number);
  if (numbers.some((number) => !Number.isSafeInteger(number))) return undefined;
  return {
    numbers: numbers as [number, number, number],
    prerelease: match[4] !== undefined,
  };
}

function isStrictlyNewerStableVersion(candidate: string, running: string) {
  const candidateOrder = versionOrder(candidate);
  const runningOrder = versionOrder(running);
  if (candidateOrder === undefined || runningOrder === undefined) return false;
  for (let index = 0; index < candidateOrder.numbers.length; index += 1) {
    const difference =
      candidateOrder.numbers[index]! - runningOrder.numbers[index]!;
    if (difference !== 0) return difference > 0;
  }
  return runningOrder.prerelease;
}

export function createUpdateCoordinator(input: {
  readonly application: UpdateApplicationIdentity;
  readonly clock: UpdateClock;
  readonly deferredRecords?: DeferredUpdateRecords;
  readonly diagnosticsExporter?: ReleaseDiagnosticsExporter;
  readonly id?: () => string;
  readonly prepareRestart?: () => Promise<void>;
  readonly records: UpdateCheckRecords;
  readonly restartSafety?: () => {
    readonly guardReasons: readonly RestartGuardReason[];
  };
  readonly scheduler: UpdateScheduler;
  readonly updater: UpdateAdapter;
}) {
  const deferredRecords = input.deferredRecords ?? memoryDeferredRecords();
  const diagnosticsExporter =
    input.diagnosticsExporter ??
    ({ export: async () => "cancelled" as const } satisfies ReleaseDiagnosticsExporter);
  const newId = input.id ?? randomUUID;
  const prepareRestart = input.prepareRestart ?? (async () => undefined);
  const restartSafety =
    input.restartSafety ?? (() => ({ guardReasons: [] as const }));
  let activeCheckId: number | undefined;
  let cancelScheduledCheck: (() => void) | undefined;
  let candidate: ReleaseCandidateIdentity | null = null;
  let candidateDownloadedInSession = false;
  let checkSequence = 0;
  let disposed = false;
  const listeners = new Set<(snapshot: AboutUpdateSnapshot) => void>();
  const platformPolicy = selectUpdatePlatformPolicy(input.application);
  const feedUrl =
    platformPolicy.mode === "automatic" ? platformPolicy.feedUrl : undefined;
  const publicPolicy =
    platformPolicy.mode === "automatic"
      ? { channel: platformPolicy.channel, mode: platformPolicy.mode }
      : platformPolicy;
  let restartAttempt = 0;
  let restartInProgress = false;
  let updateRecoveryUncertain = false;
  let snapshot: AboutUpdateSnapshotV2 = {
    application: {
      architecture: input.application.architecture,
      platform: input.application.platform,
      version: input.application.version,
    },
    candidate: null,
    lastCheckAt: null,
    nextAutomaticCheckAt: null,
    policy: publicPolicy,
    restart: {
      guardReasons: [],
      immediateRestartAvailable: false,
      kind: "none",
    },
    schemaVersion: 2,
    state:
      platformPolicy.mode === "manual"
        ? { kind: "manual" }
        : platformPolicy.mode === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "idle" },
  };

  const currentGuardReasons = () => {
    const activeReasons = new Set(restartSafety().guardReasons);
    if (updateRecoveryUncertain) activeReasons.add("recovery-uncertain");
    return RESTART_GUARD_ORDER.filter((reason) => activeReasons.has(reason));
  };

  const refreshRestartState = () => {
    const guardReasons =
      platformPolicy.mode === "automatic" ? currentGuardReasons() : [];
    snapshot = {
      ...snapshot,
      candidate: candidate === null ? null : structuredClone(candidate),
      restart: {
        guardReasons,
        immediateRestartAvailable:
          candidate !== null &&
          candidateDownloadedInSession &&
          !restartInProgress &&
          guardReasons.length === 0,
        kind: guardReasons.length > 0
          ? "blocked"
          : restartInProgress
            ? "restarting"
            : candidate === null
              ? "none"
              : "deferred",
      },
    };
  };

  const publish = () => {
    refreshRestartState();
    for (const listener of listeners) listener(structuredClone(snapshot));
  };

  const updateState = (state: AboutUpdateSnapshotV2["state"]) => {
    snapshot = { ...snapshot, state };
    publish();
  };

  const failCheck = () => {
    activeCheckId = undefined;
    candidate = null;
    candidateDownloadedInSession = false;
    updateState({
      error: {
        code: "check_failed",
        message: "The update check could not be completed.",
        retryable: true,
      },
      kind: "error",
    });
  };

  const receiveUpdaterEvent = async (
    checkId: number,
    event: UpdateAdapterEvent,
  ) => {
    if (activeCheckId !== checkId || disposed) return;
    switch (event.type) {
      case "checking":
        return;
      case "update-available":
        updateState({ kind: "update-available" });
        return;
      case "update-downloaded": {
        const parsedCandidate = releaseCandidateIdentitySchema.safeParse({
          architecture: input.application.architecture,
          id: newId(),
          platform: input.application.platform,
          version: event.candidateVersion,
        });
        if (
          !parsedCandidate.success ||
          !isStrictlyNewerStableVersion(
            parsedCandidate.data.version,
            input.application.version,
          )
        ) {
          updateRecoveryUncertain = true;
          failCheck();
          return;
        }
        const downloadedAt = input.clock.now().toISOString();
        try {
          await deferredRecords.save({
            candidate: parsedCandidate.data,
            downloadedAt,
            runningVersion: input.application.version,
          });
        } catch {
          updateRecoveryUncertain = true;
          failCheck();
          return;
        }
        if (activeCheckId !== checkId || disposed) return;
        activeCheckId = undefined;
        candidate = parsedCandidate.data;
        candidateDownloadedInSession = true;
        updateRecoveryUncertain = false;
        updateState({ kind: "update-downloaded" });
        return;
      }
      case "update-not-available":
        activeCheckId = undefined;
        updateState({ kind: "up-to-date" });
        return;
      case "error":
        failCheck();
    }
  };

  const scheduleCheck = (delayMs: number) => {
    cancelScheduledCheck?.();
    const nextAutomaticCheckAt = new Date(
      input.clock.now().getTime() + delayMs,
    ).toISOString();
    snapshot = { ...snapshot, nextAutomaticCheckAt };
    cancelScheduledCheck = input.scheduler.after(delayMs, () =>
      runCheck("automatic"),
    );
  };

  const runCheck = async (requestedBy: "automatic" | "user") => {
    if (
      feedUrl === undefined ||
      activeCheckId !== undefined ||
      candidate !== null ||
      disposed
    ) {
      return;
    }
    cancelScheduledCheck?.();
    cancelScheduledCheck = undefined;
    const checkId = ++checkSequence;
    activeCheckId = checkId;
    const checkedAt = input.clock.now().toISOString();
    try {
      await input.records.save(checkedAt);
    } catch {
      failCheck();
      return;
    }
    if (activeCheckId !== checkId || disposed) return;
    snapshot = {
      ...snapshot,
      lastCheckAt: checkedAt,
      state: { kind: "checking", requestedBy },
    };
    scheduleCheck(CHECK_INTERVAL_MS);
    publish();
    try {
      input.updater.checkForUpdates({
        feedUrl,
        onEvent: (event) => receiveUpdaterEvent(checkId, event),
      });
    } catch {
      await receiveUpdaterEvent(checkId, { type: "error" });
    }
  };

  return {
    dispose() {
      disposed = true;
      restartAttempt += 1;
      restartInProgress = false;
      cancelScheduledCheck?.();
      cancelScheduledCheck = undefined;
      listeners.clear();
    },
    async exportDiagnostics() {
      refreshRestartState();
      const diagnosticGuardReasons = currentGuardReasons();
      const diagnostics = aboutReleaseDiagnosticsSchema.parse({
        application: snapshot.application,
        candidate: snapshot.candidate,
        errors:
          snapshot.state.kind === "error"
            ? [
                {
                  code: snapshot.state.error.code,
                  message: snapshot.state.error.message,
                },
              ]
            : [],
        exportedAt: input.clock.now().toISOString(),
        guardReasons: diagnosticGuardReasons,
        restartState:
          diagnosticGuardReasons.length > 0 ? "blocked" : snapshot.restart.kind,
        schemaVersion: 1,
        updateState: snapshot.state.kind,
      });
      const source = `${JSON.stringify(diagnostics, null, 2)}\n`;
      if (Buffer.byteLength(source, "utf8") > MAX_DIAGNOSTIC_BYTES) {
        throw new Error("Release diagnostics exceeded the output limit.");
      }
      return diagnosticsExporter.export(source);
    },
    getSnapshot() {
      refreshRestartState();
      return structuredClone(snapshot);
    },
    prepareNormalQuit() {
      if (candidate === null && !updateRecoveryUncertain) return true;
      const allowed = currentGuardReasons().length === 0;
      if (!allowed) publish();
      return allowed;
    },
    async requestCheck() {
      await runCheck("user");
    },
    async requestRestart(candidateId: string): Promise<RestartRequestOutcome> {
      if (
        disposed ||
        restartInProgress ||
        candidate === null ||
        candidate.id !== candidateId ||
        !candidateDownloadedInSession ||
        input.updater.restartAndInstall === undefined
      ) {
        return "stale";
      }
      if (currentGuardReasons().length > 0) {
        publish();
        return "blocked";
      }
      const attempt = ++restartAttempt;
      restartInProgress = true;
      publish();
      try {
        await prepareRestart();
      } catch {
        restartInProgress = false;
        publish();
        return "cancelled";
      }
      if (
        disposed ||
        restartAttempt !== attempt ||
        candidate?.id !== candidateId ||
        !candidateDownloadedInSession
      ) {
        restartInProgress = false;
        return "cancelled";
      }
      if (currentGuardReasons().length > 0) {
        restartInProgress = false;
        publish();
        return "blocked";
      }
      input.updater.restartAndInstall();
      return "started";
    },
    async start() {
      if (feedUrl === undefined || disposed) return;
      let recovered: DeferredUpdateRecord | null;
      try {
        recovered = await deferredRecords.load();
      } catch {
        updateRecoveryUncertain = true;
        failCheck();
        return;
      }
      if (recovered !== null) {
        const matchesRuntime =
          recovered.runningVersion === input.application.version &&
          recovered.candidate.platform === input.application.platform &&
          recovered.candidate.architecture === input.application.architecture;
        if (matchesRuntime) {
          candidate = recovered.candidate;
          candidateDownloadedInSession = false;
          updateState({ kind: "update-downloaded" });
          return;
        }
        try {
          await deferredRecords.clear();
        } catch {
          updateRecoveryUncertain = true;
          failCheck();
          return;
        }
      }
      let lastCheckAt: string | null;
      try {
        lastCheckAt = await input.records.load();
      } catch {
        failCheck();
        return;
      }
      const now = input.clock.now().getTime();
      const nextEligibleAt =
        lastCheckAt === null
          ? now
          : Date.parse(lastCheckAt) + CHECK_INTERVAL_MS;
      const delayMs = Math.max(
        STARTUP_DELAY_MS,
        Math.max(0, nextEligibleAt - now),
      );
      snapshot = { ...snapshot, lastCheckAt };
      scheduleCheck(delayMs);
    },
    subscribe(listener: (snapshot: AboutUpdateSnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
