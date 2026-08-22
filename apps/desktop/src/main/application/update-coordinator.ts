import { randomUUID } from "node:crypto";

import {
  type AboutUpdateSnapshot,
  type RestartGuardReason,
} from "../../contracts/about.js";
import type { DeferredUpdateRecords } from "../persistence/deferred-update-records.js";
import {
  createDeferredUpdateController,
  createMemoryDeferredUpdateRecords,
  type RestartRequestOutcome,
} from "./deferred-update-controller.js";
import {
  CHECK_INTERVAL_MS,
  STARTUP_DELAY_MS,
  type UpdateAdapter,
  type UpdateAdapterEvent,
  type UpdateCheckRecords,
  type UpdateClock,
  type UpdateScheduler,
} from "./update-check-contracts.js";
import {
  selectUpdatePlatformPolicy,
  type UpdateApplicationIdentity,
} from "./update-platform-policy.js";
import type { ReleaseDiagnosticsExporter } from "./release-diagnostics.js";
import {
  createInitialUpdateSnapshot,
  type AboutUpdateSnapshotV2,
} from "./update-snapshot.js";

export type { RestartRequestOutcome } from "./deferred-update-controller.js";
export type { UpdateAdapterEvent } from "./update-check-contracts.js";

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
  const deferredRecords =
    input.deferredRecords ?? createMemoryDeferredUpdateRecords();
  const diagnosticsExporter =
    input.diagnosticsExporter ??
    ({
      async export() {
        return "cancelled";
      },
    } satisfies ReleaseDiagnosticsExporter);
  const newId = input.id ?? randomUUID;
  const prepareRestart = input.prepareRestart ?? (async () => undefined);
  const restartSafety =
    input.restartSafety ?? (() => ({ guardReasons: [] }));
  let activeCheckId: number | undefined;
  let cancelScheduledCheck: (() => void) | undefined;
  let checkSequence = 0;
  let disposed = false;
  const listeners = new Set<(snapshot: AboutUpdateSnapshot) => void>();
  const platformPolicy = selectUpdatePlatformPolicy(input.application);
  const feedUrl =
    platformPolicy.mode === "automatic" ? platformPolicy.feedUrl : undefined;
  let snapshot = createInitialUpdateSnapshot(input.application, platformPolicy);

  function publish() {
    snapshot = deferredUpdate.applyToSnapshot(snapshot);
    for (const listener of listeners) listener(structuredClone(snapshot));
  }

  const deferredUpdate = createDeferredUpdateController({
    application: input.application,
    automatic: platformPolicy.mode === "automatic",
    clock: input.clock,
    diagnosticsExporter,
    id: newId,
    onChange: publish,
    prepareRestart,
    records: deferredRecords,
    restartAndInstall: input.updater.restartAndInstall,
    restartSafety,
  });

  const updateState = (state: AboutUpdateSnapshotV2["state"]) => {
    snapshot = { ...snapshot, state };
    publish();
  };

  const failCheck = () => {
    activeCheckId = undefined;
    deferredUpdate.resetCandidate();
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
        const outcome = await deferredUpdate.acceptDownloadedCandidate(
          event.candidateVersion,
          () => activeCheckId === checkId && !disposed,
        );
        if (outcome === "failed") {
          failCheck();
          return;
        }
        if (outcome === "stale") return;
        activeCheckId = undefined;
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
      snapshot.candidate !== null ||
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
    } catch (_error) {
      // Eligibility-store errors can contain local paths; publish only fixed state.
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
    } catch (_error) {
      // Updater errors can contain feed details; publish only fixed state.
      await receiveUpdaterEvent(checkId, { type: "error" });
    }
  };

  return {
    dispose() {
      disposed = true;
      deferredUpdate.dispose();
      cancelScheduledCheck?.();
      cancelScheduledCheck = undefined;
      listeners.clear();
    },
    async exportDiagnostics() {
      return deferredUpdate.exportDiagnostics(snapshot);
    },
    getSnapshot() {
      snapshot = deferredUpdate.applyToSnapshot(snapshot);
      return structuredClone(snapshot);
    },
    prepareNormalQuit() {
      return deferredUpdate.prepareNormalQuit();
    },
    async requestCheck() {
      await runCheck("user");
    },
    async requestRestart(candidateId: string): Promise<RestartRequestOutcome> {
      return deferredUpdate.requestRestart(candidateId);
    },
    async start() {
      if (feedUrl === undefined || disposed) return;
      const recovery = await deferredUpdate.recover();
      if (recovery === "failed") {
        failCheck();
        return;
      }
      if (recovery === "recovered") {
        updateState({ kind: "update-downloaded" });
        return;
      }
      let lastCheckAt: string | null;
      try {
        lastCheckAt = await input.records.load();
      } catch (_error) {
        // Eligibility-store errors can contain local paths; publish only fixed state.
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
