import { resolve } from "node:path";

import {
  createElectronUpdateAdapter,
  type ElectronAutoUpdater,
} from "./adapters/electron-auto-updater.js";
import { createUpdateCoordinator } from "./application/update-coordinator.js";
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
  readonly platform: NodeJS.Platform;
  readonly schedule?: (
    delayMs: number,
    action: () => void | Promise<void>,
  ) => () => void;
}) {
  const now = input.clock ?? (() => new Date());
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
      version: input.app.getVersion(),
    },
    clock: { now },
    records: createJsonUpdateCheckRecords({
      path: resolve(
        input.app.getPath("userData"),
        "updates",
        "check-record-v1.json",
      ),
    }),
    scheduler: { after: schedule },
    updater: createElectronUpdateAdapter(input.autoUpdater),
  });
  await updates.start();
  return updates;
}
