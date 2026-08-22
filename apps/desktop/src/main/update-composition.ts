import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  createElectronUpdateAdapter,
  type ElectronAutoUpdater,
} from "./adapters/electron-auto-updater.js";
import { createUpdateCoordinator } from "./application/update-coordinator.js";
import type { RestartGuardReason } from "../contracts/about.js";
import { createJsonDeferredUpdateRecords } from "./persistence/deferred-update-records.js";
import { createJsonUpdateCheckRecords } from "./persistence/update-check-records.js";

interface UpdateRuntimeApp {
  getPath(name: "userData"): string;
  getVersion(): string;
  readonly isPackaged: boolean;
}

export async function createElectronUpdateComposition(input: {
  readonly app: UpdateRuntimeApp;
  readonly architecture: string;
  readonly autoUpdater: ElectronAutoUpdater;
  readonly clock?: () => Date;
  readonly diagnosticsExporter?: {
    export(source: string): Promise<"cancelled" | "saved">;
  };
  readonly id?: () => string;
  readonly platform: NodeJS.Platform;
  readonly releaseChannel: "stable" | "unsigned-preview";
  readonly prepareRestart?: () => Promise<void>;
  readonly restartSafety?: () => {
    readonly guardReasons: readonly RestartGuardReason[];
  };
  readonly schedule?: (
    delayMs: number,
    action: () => void | Promise<void>,
  ) => () => void;
}) {
  const now = input.clock ?? (() => new Date());
  const newId = input.id ?? randomUUID;
  const schedule =
    input.schedule ??
    ((delayMs: number, action: () => void | Promise<void>) => {
      const timer = setTimeout(() => {
        void Promise.resolve(action()).catch(() => undefined);
      }, delayMs);
      return () => clearTimeout(timer);
    });
  const updates = createUpdateCoordinator({
    application: {
      architecture: input.architecture,
      isPackaged: input.app.isPackaged,
      platform: input.platform,
      releaseChannel: input.releaseChannel,
      version: input.app.getVersion(),
    },
    clock: { now },
    deferredRecords: createJsonDeferredUpdateRecords({
      id: newId,
      path: resolve(
        input.app.getPath("userData"),
        "updates",
        "deferred-restart-v1.json",
      ),
    }),
    diagnosticsExporter: input.diagnosticsExporter,
    id: newId,
    prepareRestart: input.prepareRestart,
    records: createJsonUpdateCheckRecords({
      path: resolve(
        input.app.getPath("userData"),
        "updates",
        "check-record-v1.json",
      ),
    }),
    scheduler: { after: schedule },
    restartSafety: input.restartSafety,
    updater: createElectronUpdateAdapter(input.autoUpdater),
  });
  await updates.start();
  return updates;
}
