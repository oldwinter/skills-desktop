import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  autoUpdater,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
} from "electron";

import {
  registerAssetProtocol,
  reviewWindowOptions,
  REVIEW_URL,
  secureWindow,
  workspaceWindowOptions,
  WORKSPACE_URL,
} from "./adapters/electron-security.js";
import { createElectronApplicationMenu } from "./adapters/electron-application-menu.js";
import {
  registerDesktopIpc,
  type DesktopIpcAttachment,
} from "./adapters/electron-ipc.js";
import { RENDERER_MENU_COMMANDS } from "../contracts/menu.js";
import { onWindowClosed } from "./adapters/electron-window-lifecycle.js";
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
  const appIcon = app.isPackaged
    ? resolve(process.resourcesPath, "app-icon.png")
    : resolve(currentDirectory, "../../assets/app-icon.png");
  let workspaceWindow: BrowserWindow | undefined;
  let workspaceAttachment: DesktopIpcAttachment | undefined;
  let reviewWindow: BrowserWindow | undefined;

  void app
    .whenReady()
    .then(async () => {
      let presentReview = (_reviewId: string) => undefined;
      const { capabilities, preferences, releaseChannel, updates } =
        await createCompositionRoot({
          onReviewRequested(reviewId) {
            presentReview(reviewId);
          },
        });
      registerAssetProtocol(protocol, {
        review: resolve(currentDirectory, "../review-renderer"),
        workspace: resolve(currentDirectory, "../renderer"),
      });
      // ADR 0023: main owns the localized menu. Renderer-bound commands are
      // relayed to the live workspace, which issues the same closed request
      // its own controls would; nothing here bypasses DesktopCapabilities.
      const applicationMenu = createElectronApplicationMenu({
        about: () => {
          const { application } = updates.getSnapshot();
          return {
            architecture: application.architecture,
            releaseChannel,
            version: application.version,
          };
        },
        locale: () => preferences.current().locale,
        onCommand(command) {
          if (command === "about.show") {
            app.showAboutPanel();
            return;
          }
          if (workspaceWindow === undefined) {
            createWorkspaceWindow();
            return;
          }
          workspaceWindow.focus();
          if (command === "workspace.show") return;
          if (
            workspaceAttachment !== undefined &&
            (RENDERER_MENU_COMMANDS as readonly string[]).includes(command)
          ) {
            desktopIpc.notifyMenuCommand(
              command as (typeof RENDERER_MENU_COMMANDS)[number],
              workspaceAttachment,
            );
          }
        },
        platform: process.platform,
        runtime: { app, menu: Menu },
      });
      const desktopIpc = registerDesktopIpc({
        capabilities,
        ipcMain,
        menu: { current: () => applicationMenu.current() },
        newEpoch: randomUUID,
        updates,
      });
      applicationMenu.install();
      const unsubscribePreferences = preferences.subscribe(() => {
        applicationMenu.install();
      });

      const createWorkspaceWindow = () => {
        const window = new BrowserWindow(
          workspaceWindowOptions(
            resolve(currentDirectory, "../preload/workspace.cjs"),
            app.isPackaged,
            appIcon,
          ),
        );
        secureWindow(window, WORKSPACE_URL);
        window.webContents.on("did-start-navigation", (details) => {
          if (details.isMainFrame && !details.isSameDocument) {
            desktopIpc.detach(window.webContents.id);
            if (workspaceWindow === window) workspaceAttachment = undefined;
          }
        });
        window.webContents.on("dom-ready", () => {
          if (window.webContents.getURL() === WORKSPACE_URL) {
            const attachment = desktopIpc.attach(
              window.webContents,
              "workspace",
              WORKSPACE_URL,
            );
            if (workspaceWindow === window) workspaceAttachment = attachment;
          }
        });
        window.once("ready-to-show", () => window.show());
        onWindowClosed(window, (webContentsId) => {
          desktopIpc.detach(webContentsId);
          if (workspaceWindow === window) {
            workspaceWindow = undefined;
            workspaceAttachment = undefined;
          }
        });
        workspaceWindow = window;
        workspaceAttachment = undefined;
        void window.loadURL(WORKSPACE_URL);
      };

      presentReview = (reviewId) => {
        const priorReviewWindow = reviewWindow;
        reviewWindow = undefined;
        priorReviewWindow?.close();
        const ownerWindow = workspaceWindow;
        const ownerAttachment = workspaceAttachment;
        const window = new BrowserWindow(
          reviewWindowOptions(
            resolve(currentDirectory, "../preload/review.cjs"),
            app.isPackaged,
            ownerWindow,
            appIcon,
          ),
        );
        secureWindow(window, REVIEW_URL);
        window.webContents.on("did-start-navigation", (details) => {
          if (details.isMainFrame && !details.isSameDocument) {
            desktopIpc.detach(window.webContents.id);
          }
        });
        window.webContents.on("dom-ready", () => {
          if (window.webContents.getURL() === REVIEW_URL) {
            desktopIpc.attach(
              window.webContents,
              "review",
              REVIEW_URL,
              reviewId,
            );
          }
        });
        window.once("ready-to-show", () => window.show());
        onWindowClosed(window, (webContentsId) => {
          desktopIpc.detach(webContentsId);
          const wasActiveReview = reviewWindow === window;
          if (wasActiveReview) reviewWindow = undefined;
          if (
            wasActiveReview &&
            ownerWindow !== undefined &&
            ownerAttachment !== undefined &&
            workspaceAttachment !== undefined &&
            !ownerWindow.isDestroyed() &&
            workspaceWindow === ownerWindow &&
            workspaceAttachment.webContentsId ===
              ownerAttachment.webContentsId &&
            workspaceAttachment.attachmentEpoch ===
              ownerAttachment.attachmentEpoch
          ) {
            ownerWindow.focus();
            ownerWindow.webContents.focus();
            desktopIpc.notifyReviewWindowClosed(reviewId, ownerAttachment);
          }
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
      let updaterOwnedQuit = false;
      autoUpdater.on("before-quit-for-update", () => {
        updaterOwnedQuit = true;
        unsubscribePreferences();
        updates.dispose();
        desktopIpc.dispose();
        void capabilities.shutdown();
      });
      app.on("before-quit", (event) => {
        if (updaterOwnedQuit) return;
        if (readyToQuit) return;
        event.preventDefault();
        if (shutdownStarted) return;
        if (!updates.prepareNormalQuit()) return;
        shutdownStarted = true;
        unsubscribePreferences();
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
