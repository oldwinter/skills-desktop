import { contextBridge, ipcRenderer } from "electron";

import {
  reviewDecisionResultSchema,
  reviewSnapshotResultSchema,
  type ReviewBridge,
} from "../contracts/review.js";

const bridge: ReviewBridge = Object.freeze({
  async approve() {
    return reviewDecisionResultSchema.parse(
      await ipcRenderer.invoke("review:decision:approve"),
    );
  },
  async getReview() {
    return reviewSnapshotResultSchema.parse(await ipcRenderer.invoke("review:snapshot:get"));
  },
  async reject() {
    return reviewDecisionResultSchema.parse(
      await ipcRenderer.invoke("review:decision:reject"),
    );
  },
});

contextBridge.exposeInMainWorld("skillsReview", bridge);
