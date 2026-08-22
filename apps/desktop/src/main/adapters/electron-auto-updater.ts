import type { AutoUpdater } from "electron";

import type { UpdateAdapterEvent } from "../application/update-coordinator.js";

export type ElectronAutoUpdater = Pick<
  AutoUpdater,
  | "checkForUpdates"
  | "on"
  | "quitAndInstall"
  | "removeListener"
  | "setFeedURL"
>;

function normalizeCandidateVersion(releaseName: string) {
  const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(
    releaseName.trim(),
  );
  return match?.[1];
}

export function createElectronUpdateAdapter(updater: ElectronAutoUpdater) {
  return {
    checkForUpdates(input: {
      readonly feedUrl: string;
      readonly onEvent: (event: UpdateAdapterEvent) => void;
    }) {
      const checking = () => input.onEvent({ type: "checking" });
      const available = () => input.onEvent({ type: "update-available" });
      const cleanup = () => {
        updater.removeListener("checking-for-update", checking);
        updater.removeListener("update-available", available);
        updater.removeListener("update-downloaded", downloaded);
        updater.removeListener("update-not-available", notAvailable);
        updater.removeListener("error", failed);
      };
      const downloaded = (
        _event: Electron.Event,
        _releaseNotes: string,
        releaseName: string,
      ) => {
        cleanup();
        const candidateVersion = normalizeCandidateVersion(releaseName);
        if (candidateVersion === undefined) {
          void input.onEvent({ type: "error" });
          return;
        }
        void input.onEvent({ candidateVersion, type: "update-downloaded" });
      };
      const notAvailable = () => {
        cleanup();
        input.onEvent({ type: "update-not-available" });
      };
      const failed = () => {
        cleanup();
        input.onEvent({ type: "error" });
      };

      updater.on("checking-for-update", checking);
      updater.on("update-available", available);
      updater.on("update-downloaded", downloaded);
      updater.on("update-not-available", notAvailable);
      updater.on("error", failed);
      try {
        updater.setFeedURL({ url: input.feedUrl });
        updater.checkForUpdates();
      } catch (error) {
        cleanup();
        throw error;
      }
    },
    restartAndInstall() {
      updater.quitAndInstall();
    },
  };
}
