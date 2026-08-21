import { contextBridge, ipcRenderer } from "electron";

import {
  desktopEventSchema,
  workspaceRequestResultSchema,
  workspaceSnapshotResultSchema,
  type DesktopEvent,
  type MutationIntent,
  type PrepareCollectionRequest,
  type TargetDraft,
  type WorkspaceBridge,
} from "../contracts/workspace.js";

const bridge: WorkspaceBridge = Object.freeze({
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
