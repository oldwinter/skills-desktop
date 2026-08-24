import { contextBridge, ipcRenderer } from "electron";

import {
  reviewDecisionResultSchema,
  reviewSnapshotResultSchema,
  type ReviewBridge,
} from "../contracts/review.js";

const attachmentEpoch = new Promise<string>((resolve, reject) => {
  ipcRenderer.once(
    "desktop:attachment-epoch",
    (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 256
      ) {
        resolve(value);
      } else {
        reject(new TypeError("Invalid desktop attachment epoch."));
      }
    },
  );
});

async function invoke(channel: string) {
  return ipcRenderer.invoke(channel, await attachmentEpoch);
}

const bridge: ReviewBridge = Object.freeze({
  async approve() {
    return reviewDecisionResultSchema.parse(
      await invoke("review:decision:approve"),
    );
  },
  async getReview() {
    return reviewSnapshotResultSchema.parse(
      await invoke("review:snapshot:get"),
    );
  },
  async reject() {
    return reviewDecisionResultSchema.parse(
      await invoke("review:decision:reject"),
    );
  },
});

contextBridge.exposeInMainWorld("skillsReview", bridge);
