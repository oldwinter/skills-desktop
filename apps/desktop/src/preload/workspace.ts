import { contextBridge, ipcRenderer } from "electron";

import {
  aboutUpdateResultSchema,
  aboutUpdateSnapshotSchema,
  type AboutBridge,
} from "../contracts/about.js";
import type { DesktopBridge } from "../contracts/desktop.js";
import {
  desktopEventSchema,
  workspaceRequestResultSchema,
  workspaceSnapshotResultSchema,
  type DesktopEvent,
  type MutationIntent,
  type PrepareCollectionAcrossTargetsRequest,
  type PrepareCollectionRequest,
  type TargetDraft,
} from "../contracts/workspace.js";

const about: AboutBridge = Object.freeze({
  async getSnapshot() {
    return aboutUpdateResultSchema.parse(
      await ipcRenderer.invoke("about:update:snapshot:get"),
    );
  },
  async requestCheck() {
    return aboutUpdateResultSchema.parse(
      await ipcRenderer.invoke("about:update:check", {
        type: "update.check",
        version: 1,
      }),
    );
  },
  subscribe(listener: Parameters<AboutBridge["subscribe"]>[0]) {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(aboutUpdateSnapshotSchema.parse(value));
    };
    ipcRenderer.on("about:update:snapshot-changed", receive);
    return () =>
      ipcRenderer.removeListener("about:update:snapshot-changed", receive);
  },
});

const bridge: DesktopBridge = Object.freeze({
  about,
  async cancelInventory(operationId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:inventory:cancel", operationId),
    );
  },
  async compareTargets(leftTargetId: string, rightTargetId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke(
        "workspace:comparison:open",
        leftTargetId,
        rightTargetId,
      ),
    );
  },
  async createTarget(definition: TargetDraft) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:target:create", definition),
    );
  },
  async deleteTarget(targetId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:target:delete", targetId),
    );
  },
  async getSnapshot() {
    return workspaceSnapshotResultSchema.parse(
      await ipcRenderer.invoke("workspace:snapshot:get"),
    );
  },
  async prepareMutation(targetId: string, intent: MutationIntent) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:mutation:prepare", targetId, intent),
    );
  },
  async prepareCollection(
    request: Omit<PrepareCollectionRequest, "type" | "version">,
  ) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:collection:prepare", request),
    );
  },
  async prepareCollectionAcrossTargets(
    request: Omit<
      PrepareCollectionAcrossTargetsRequest,
      "type" | "version"
    >,
  ) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:collection:prepare-many", request),
    );
  },
  async prepareComparison(
    comparisonId: string,
    rowKey: string,
    destinationTargetId: string,
  ) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke(
        "workspace:comparison:prepare",
        comparisonId,
        rowKey,
        destinationTargetId,
      ),
    );
  },
  async reconcileMutation(targetId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:mutation:reconcile", targetId),
    );
  },
  async refreshInventory(targetId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:inventory:refresh", targetId),
    );
  },
  async requestCancellationReview(operationId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:review:cancel-request", operationId),
    );
  },
  async requestHostTrustReview(targetId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:host-trust:review", targetId),
    );
  },
  async requestCollectionReview(collectionPlanId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke(
        "workspace:collection:review-request",
        collectionPlanId,
      ),
    );
  },
  async requestReview(preparedMutationId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:review:request", preparedMutationId),
    );
  },
  subscribe(listener: (event: DesktopEvent) => void) {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(desktopEventSchema.parse(value));
    };
    ipcRenderer.on("workspace:event", receive);
    return () => ipcRenderer.removeListener("workspace:event", receive);
  },
  async updateTarget(targetId: string, definition: TargetDraft) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:target:update", targetId, definition),
    );
  },
});

contextBridge.exposeInMainWorld("skillsDesktop", bridge);
