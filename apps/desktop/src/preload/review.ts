import { contextBridge, ipcRenderer } from "electron";

import { reviewSnapshotResultSchema, type ReviewBridge } from "../contracts/review.js";

const bridge: ReviewBridge = Object.freeze({
  async getReview() {
    return reviewSnapshotResultSchema.parse(await ipcRenderer.invoke("review:snapshot:get"));
  },
});

contextBridge.exposeInMainWorld("skillsReview", bridge);
