import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain, protocol } from "electron";

import {
  registerAssetProtocol,
  reviewWindowOptions,
  REVIEW_URL,
  secureWindow,
  workspaceWindowOptions,
  WORKSPACE_URL,
} from "./adapters/electron-security.js";
import { registerDesktopIpc } from "./adapters/electron-ipc.js";
import { createCompositionRoot } from "./composition-root.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "skills-desktop",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: false,
    },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  let workspaceWindow: BrowserWindow | undefined;
  let reviewWindow: BrowserWindow | undefined;

  void app
    .whenReady()
    .then(async () => {
      let presentReview = (_reviewId: string) => undefined;
      const { capabilities, updates } = await createCompositionRoot({
        onReviewRequested(reviewId) {
          presentReview(reviewId);
        },
      });
      registerAssetProtocol(protocol, {
        review: resolve(currentDirectory, "../review-renderer"),
        workspace: resolve(currentDirectory, "../renderer"),
      });
      const desktopIpc = registerDesktopIpc({
        capabilities,
        ipcMain,
        newEpoch: randomUUID,
        updates,
      });

      const createWorkspaceWindow = () => {
        const window = new BrowserWindow(
          workspaceWindowOptions(
            resolve(currentDirectory, "../preload/workspace.cjs"),
            app.isPackaged,
          ),
        );
        secureWindow(window, WORKSPACE_URL);
        desktopIpc.attach(window.webContents, "workspace", WORKSPACE_URL);
        window.webContents.on(
          "did-start-navigation",
          (_event, _url, _inPlace, isMainFrame) => {
            if (isMainFrame) {
              desktopIpc.attach(window.webContents, "workspace", WORKSPACE_URL);
            }
          },
        );
        window.once("ready-to-show", () => window.show());
        window.once("closed", () => {
          desktopIpc.detach(window.webContents.id);
          if (workspaceWindow === window) workspaceWindow = undefined;
        });
        void window.loadURL(WORKSPACE_URL);
        workspaceWindow = window;
      };

      presentReview = (reviewId) => {
        if (reviewWindow !== undefined) reviewWindow.close();
        const window = new BrowserWindow(
          reviewWindowOptions(
            resolve(currentDirectory, "../preload/review.cjs"),
            app.isPackaged,
            workspaceWindow,
          ),
        );
        secureWindow(window, REVIEW_URL);
        window.webContents.on(
          "did-start-navigation",
          (_event, _url, _inPlace, isMainFrame) => {
            if (isMainFrame) {
              desktopIpc.attach(
                window.webContents,
                "review",
                REVIEW_URL,
                reviewId,
              );
            }
          },
        );
        window.once("ready-to-show", () => window.show());
        window.once("closed", () => {
          desktopIpc.detach(window.webContents.id);
          if (reviewWindow === window) reviewWindow = undefined;
        });
        void window.loadURL(REVIEW_URL);
        reviewWindow = window;
      };

      createWorkspaceWindow();
      app.on("activate", () => {
        if (workspaceWindow === undefined) createWorkspaceWindow();
        else workspaceWindow.focus();
      });
      app.on("second-instance", () => workspaceWindow?.focus());
      let shutdownStarted = false;
      let readyToQuit = false;
      app.on("before-quit", (event) => {
        if (readyToQuit) return;
        event.preventDefault();
        if (shutdownStarted) return;
        shutdownStarted = true;
        updates.dispose();
        void capabilities.shutdown().finally(() => {
          desktopIpc.dispose();
          readyToQuit = true;
          app.quit();
        });
      });
    })
    .catch(() => app.quit());

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
