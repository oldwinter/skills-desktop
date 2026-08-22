import {
  selectUpdatePlatformPolicy,
  type UpdateApplicationIdentity,
} from "./update-platform-policy.js";
import type { AboutUpdateSnapshot } from "../../contracts/about.js";

const STARTUP_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

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
    readonly onEvent: (event: UpdateAdapterEvent) => void;
  }): void;
}

export type UpdateAdapterEvent =
  | { readonly type: "checking" }
  | { readonly type: "error" }
  | { readonly type: "update-available" }
  | { readonly type: "update-downloaded" }
  | { readonly type: "update-not-available" };

export function createUpdateCoordinator(input: {
  readonly application: UpdateApplicationIdentity;
  readonly clock: UpdateClock;
  readonly records: UpdateCheckRecords;
  readonly scheduler: UpdateScheduler;
  readonly updater: UpdateAdapter;
}) {
  let activeCheckId: number | undefined;
  let cancelScheduledCheck: (() => void) | undefined;
  let checkSequence = 0;
  const listeners = new Set<(snapshot: AboutUpdateSnapshot) => void>();
  const platformPolicy = selectUpdatePlatformPolicy(input.application);
  const feedUrl =
    platformPolicy.mode === "automatic" ? platformPolicy.feedUrl : undefined;
  const publicPolicy =
    platformPolicy.mode === "automatic"
      ? { channel: platformPolicy.channel, mode: platformPolicy.mode }
      : platformPolicy;
  let snapshot: AboutUpdateSnapshot = {
    application: {
      architecture: input.application.architecture,
      platform: input.application.platform,
      version: input.application.version,
    },
    lastCheckAt: null,
    nextAutomaticCheckAt: null,
    policy: publicPolicy,
    schemaVersion: 1,
    state:
      platformPolicy.mode === "manual"
        ? { kind: "manual" }
        : platformPolicy.mode === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "idle" },
  };

  const publish = () => {
    for (const listener of listeners) listener(structuredClone(snapshot));
  };

  const updateState = (state: AboutUpdateSnapshot["state"]) => {
    snapshot = { ...snapshot, state };
    publish();
  };

  const failCheck = () => {
    activeCheckId = undefined;
    updateState({
      error: {
        code: "check_failed",
        message: "The update check could not be completed.",
        retryable: true,
      },
      kind: "error",
    });
  };

  const receiveUpdaterEvent = (
    checkId: number,
    event: UpdateAdapterEvent,
  ) => {
    if (activeCheckId !== checkId) return;
    switch (event.type) {
      case "checking":
        return;
      case "update-available":
        updateState({ kind: "update-available" });
        return;
      case "update-downloaded":
        activeCheckId = undefined;
        updateState({ kind: "update-downloaded" });
        return;
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
    if (feedUrl === undefined || activeCheckId !== undefined) return;
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
      receiveUpdaterEvent(checkId, { type: "error" });
    }
  };

  return {
    dispose() {
      cancelScheduledCheck?.();
      cancelScheduledCheck = undefined;
      listeners.clear();
    },
    getSnapshot() {
      return structuredClone(snapshot);
    },
    async requestCheck() {
      await runCheck("user");
    },
    async start() {
      if (feedUrl === undefined) return;
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
