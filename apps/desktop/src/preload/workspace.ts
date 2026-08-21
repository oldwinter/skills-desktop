import { contextBridge, ipcRenderer } from "electron";

import {
  desktopEventSchema,
  workspaceRequestResultSchema,
  workspaceSnapshotResultSchema,
  type DesktopEvent,
  type WorkspaceBridge,
} from "../contracts/workspace.js";

const bridge: WorkspaceBridge = Object.freeze({
  async cancelInventory(operationId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:inventory:cancel", operationId),
    );
  },
  async getSnapshot() {
    return workspaceSnapshotResultSchema.parse(await ipcRenderer.invoke("workspace:snapshot:get"));
  },
  async refreshInventory(targetId: string) {
    return workspaceRequestResultSchema.parse(
      await ipcRenderer.invoke("workspace:inventory:refresh", targetId),
    );
  },
  subscribe(listener: (event: DesktopEvent) => void) {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(desktopEventSchema.parse(value));
    };
    ipcRenderer.on("workspace:event", receive);
    return () => ipcRenderer.removeListener("workspace:event", receive);
  },
});

contextBridge.exposeInMainWorld("skillsDesktop", bridge);
