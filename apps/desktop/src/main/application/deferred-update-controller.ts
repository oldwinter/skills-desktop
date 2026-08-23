import {
  releaseCandidateIdentitySchema,
  type AboutUpdateSnapshot,
  type ReleaseCandidateIdentity,
  type RestartGuardReason,
} from "../../contracts/about.js";
import type {
  DeferredUpdateRecord,
  DeferredUpdateRecords,
} from "../persistence/deferred-update-records.js";
import type { UpdateApplicationIdentity } from "./update-platform-policy.js";
import {
  serializeReleaseDiagnostics,
  type ReleaseDiagnosticsExporter,
} from "./release-diagnostics.js";
import { isStrictlyNewerStableVersion } from "./update-version.js";

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

export type RestartRequestOutcome =
  | "blocked"
  | "cancelled"
  | "stale"
  | "started";

type RecoveryOutcome = "empty" | "failed" | "recovered";
type SaveOutcome = "accepted" | "failed" | "stale";

export function createMemoryDeferredUpdateRecords(): DeferredUpdateRecords {
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

export function createDeferredUpdateController(input: {
  readonly application: UpdateApplicationIdentity;
  readonly automatic: boolean;
  readonly clock: { now(): Date };
  readonly diagnosticsExporter: ReleaseDiagnosticsExporter;
  readonly id: () => string;
  readonly onChange: () => void;
  readonly prepareRestart: () => Promise<void>;
  readonly records: DeferredUpdateRecords;
  readonly restartAndInstall?: () => void;
  readonly restartSafety: () => {
    readonly guardReasons: readonly RestartGuardReason[];
  };
}) {
  let candidate: ReleaseCandidateIdentity | null = null;
  let candidateDownloadedInSession = false;
  let disposed = false;
  let restartAttempt = 0;
  let restartInProgress = false;
  let recoveryUncertain = false;

  const currentGuardReasons = () => {
    const activeReasons = new Set(input.restartSafety().guardReasons);
    if (recoveryUncertain) activeReasons.add("recovery-uncertain");
    return RESTART_GUARD_ORDER.filter((reason) => activeReasons.has(reason));
  };

  const applyToSnapshot = (
    snapshot: AboutUpdateSnapshotV2,
  ): AboutUpdateSnapshotV2 => {
    const guardReasons = input.automatic ? currentGuardReasons() : [];
    return {
      ...snapshot,
      candidate: candidate === null ? null : structuredClone(candidate),
      restart: {
        guardReasons,
        immediateRestartAvailable:
          candidate !== null &&
          candidateDownloadedInSession &&
          !restartInProgress &&
          guardReasons.length === 0,
        kind:
          guardReasons.length > 0
            ? "blocked"
            : restartInProgress
              ? "restarting"
              : candidate === null
                ? "none"
                : "deferred",
      },
    };
  };

  return {
    async acceptDownloadedCandidate(
      candidateVersion: string | undefined,
      stillCurrent: () => boolean,
    ): Promise<SaveOutcome> {
      const parsedCandidate = releaseCandidateIdentitySchema.safeParse({
        architecture: input.application.architecture,
        id: input.id(),
        platform: input.application.platform,
        version: candidateVersion,
      });
      if (
        !parsedCandidate.success ||
        !isStrictlyNewerStableVersion(
          parsedCandidate.data.version,
          input.application.version,
        )
      ) {
        recoveryUncertain = true;
        return "failed";
      }
      recoveryUncertain = true;
      input.onChange();
      try {
        await input.records.save({
          candidate: parsedCandidate.data,
          downloadedAt: input.clock.now().toISOString(),
          runningVersion: input.application.version,
        });
      } catch {
        // Store failures can contain local paths; only fixed state crosses this boundary.
        recoveryUncertain = true;
        return "failed";
      }
      if (!stillCurrent()) return "stale";
      candidate = parsedCandidate.data;
      candidateDownloadedInSession = true;
      recoveryUncertain = false;
      return "accepted";
    },
    applyToSnapshot,
    dispose() {
      disposed = true;
      restartAttempt += 1;
      restartInProgress = false;
    },
    async exportDiagnostics(snapshot: AboutUpdateSnapshotV2) {
      const refreshedSnapshot = applyToSnapshot(snapshot);
      const diagnosticGuardReasons = currentGuardReasons();
      return input.diagnosticsExporter.export(
        serializeReleaseDiagnostics({
          exportedAt: input.clock.now(),
          guardReasons: diagnosticGuardReasons,
          snapshot: refreshedSnapshot,
        }),
      );
    },
    prepareNormalQuit() {
      if (candidate === null && !recoveryUncertain) return true;
      const allowed = currentGuardReasons().length === 0;
      if (!allowed) input.onChange();
      return allowed;
    },
    async recover(): Promise<RecoveryOutcome> {
      let recovered: DeferredUpdateRecord | null;
      try {
        recovered = await input.records.load();
      } catch {
        // Store failures can contain local paths; only fixed state crosses this boundary.
        recoveryUncertain = true;
        return "failed";
      }
      if (recovered === null) return "empty";
      const matchesPlatform =
        recovered.candidate.platform === input.application.platform &&
        recovered.candidate.architecture === input.application.architecture;
      const matchesDownloadRuntime =
        matchesPlatform &&
        recovered.runningVersion === input.application.version &&
        isStrictlyNewerStableVersion(
          recovered.candidate.version,
          input.application.version,
        );
      if (matchesDownloadRuntime) {
        candidate = recovered.candidate;
        candidateDownloadedInSession = false;
        return "recovered";
      }
      const updateCompleted =
        matchesPlatform &&
        recovered.runningVersion !== input.application.version &&
        recovered.candidate.version === input.application.version;
      if (!updateCompleted) {
        // Removing app evidence cannot cancel bytes already staged by Electron.
        recoveryUncertain = true;
        return "failed";
      }
      try {
        await input.records.clear();
      } catch {
        // Store failures can contain local paths; only fixed state crosses this boundary.
        recoveryUncertain = true;
        return "failed";
      }
      return "empty";
    },
    resetCandidate() {
      candidate = null;
      candidateDownloadedInSession = false;
    },
    async requestRestart(candidateId: string): Promise<RestartRequestOutcome> {
      if (
        disposed ||
        restartInProgress ||
        candidate === null ||
        candidate.id !== candidateId ||
        !candidateDownloadedInSession ||
        input.restartAndInstall === undefined
      ) {
        return "stale";
      }
      if (currentGuardReasons().length > 0) {
        input.onChange();
        return "blocked";
      }
      const attempt = ++restartAttempt;
      restartInProgress = true;
      input.onChange();
      try {
        await input.prepareRestart();
      } catch {
        // Shutdown failures are contained without exposing process or path details.
        restartInProgress = false;
        input.onChange();
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
        input.onChange();
        return "blocked";
      }
      input.restartAndInstall();
      return "started";
    },
  };
}
