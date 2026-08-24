import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  type WindowLike = {
    readonly options: unknown;
    readonly webContents: {
      readonly id: number;
      focus: ReturnType<typeof vi.fn>;
      getURL: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      emit(event: string, ...args: unknown[]): void;
    };
    close: ReturnType<typeof vi.fn>;
    emit(event: string, ...args: unknown[]): void;
    focus: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
  };

  const appListeners = new Map<string, Listener[]>();
  const updaterListeners = new Map<string, Listener[]>();
  const windows: WindowLike[] = [];
  let nextWebContentsId = 1;
  let reviewRequested: ((reviewId: string) => void) | undefined;

  const addListener = (
    listeners: Map<string, Listener[]>,
    event: string,
    listener: Listener,
  ) => {
    const existing = listeners.get(event) ?? [];
    existing.push(listener);
    listeners.set(event, existing);
  };
  const emitListeners = (
    listeners: Map<string, Listener[]>,
    event: string,
    args: unknown[],
  ) => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
  };

  const createWindow = (options: unknown): WindowLike => {
    let currentUrl = "";
    let destroyed = false;
    const windowListeners = new Map<string, Listener[]>();
    const webContentsListeners = new Map<string, Listener[]>();
    const webContents = {
      id: nextWebContentsId++,
      focus: vi.fn(),
      getURL: vi.fn(() => currentUrl),
      on: vi.fn((event: string, listener: Listener) => {
        addListener(webContentsListeners, event, listener);
        return webContents;
      }),
      emit(event: string, ...args: unknown[]) {
        emitListeners(webContentsListeners, event, args);
      },
    };
    const window: WindowLike = {
      options,
      webContents,
      close: vi.fn(() => {
        destroyed = true;
        window.emit("closed");
      }),
      emit(event: string, ...args: unknown[]) {
        emitListeners(windowListeners, event, args);
      },
      focus: vi.fn(),
      isDestroyed: vi.fn(() => destroyed),
      loadURL: vi.fn(async (url: string) => {
        currentUrl = url;
      }),
      once: vi.fn((event: string, listener: Listener) => {
        const onceListener = (...args: unknown[]) => {
          const remaining = windowListeners.get(event) ?? [];
          windowListeners.set(
            event,
            remaining.filter((candidate) => candidate !== onceListener),
          );
          listener(...args);
        };
        addListener(windowListeners, event, onceListener);
        return window;
      }),
      show: vi.fn(),
    };
    windows.push(window);
    return window;
  };

  const app = {
    isPackaged: false,
    on: vi.fn((event: string, listener: Listener) => {
      addListener(appListeners, event, listener);
      return app;
    }),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(async () => undefined),
  };
  const autoUpdater = {
    on: vi.fn((event: string, listener: Listener) => {
      addListener(updaterListeners, event, listener);
      return autoUpdater;
    }),
  };
  const protocol = { registerSchemesAsPrivileged: vi.fn() };
  const BrowserWindow = vi.fn(function BrowserWindow(options: unknown) {
    return createWindow(options);
  });

  const capabilities = {
    initialize: vi.fn(),
    shutdown: vi.fn(async () => undefined),
  };
  const updates = {
    dispose: vi.fn(),
    prepareNormalQuit: vi.fn(() => true),
  };
  const desktopIpc = {
    attach: vi.fn(),
    detach: vi.fn(),
    dispose: vi.fn(),
    notifyReviewWindowClosed: vi.fn(),
  };

  const registerAssetProtocol = vi.fn();
  const registerDesktopIpc = vi.fn(() => desktopIpc);
  const secureWindow = vi.fn();
  const workspaceWindowOptions = vi.fn(() => ({ kind: "workspace" }));
  const reviewWindowOptions = vi.fn(() => ({ kind: "review" }));
  const onWindowClosed = vi.fn(
    (window: WindowLike, handleClosed: (webContentsId: number) => void) => {
      (
        window.once as unknown as (
          event: string,
          listener: () => void,
        ) => unknown
      )("closed", () => handleClosed(window.webContents.id));
    },
  );
  const createCompositionRoot = vi.fn(
    async (options: { onReviewRequested(reviewId: string): void }) => {
      reviewRequested = options.onReviewRequested;
      return { capabilities, updates };
    },
  );

  const emitApp = (event: string, ...args: unknown[]) =>
    emitListeners(appListeners, event, args);
  const emitUpdater = (event: string, ...args: unknown[]) =>
    emitListeners(updaterListeners, event, args);

  const reset = () => {
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: "/resources",
    });
    appListeners.clear();
    updaterListeners.clear();
    windows.length = 0;
    nextWebContentsId = 1;
    reviewRequested = undefined;

    app.isPackaged = false;
    app.on.mockClear();
    app.quit.mockClear();
    app.requestSingleInstanceLock.mockReset();
    app.requestSingleInstanceLock.mockReturnValue(true);
    app.whenReady.mockReset();
    app.whenReady.mockResolvedValue(undefined);
    autoUpdater.on.mockClear();
    protocol.registerSchemesAsPrivileged.mockClear();
    BrowserWindow.mockClear();
    capabilities.initialize.mockReset();
    capabilities.shutdown.mockReset();
    capabilities.shutdown.mockResolvedValue(undefined);
    updates.dispose.mockClear();
    updates.prepareNormalQuit.mockReset();
    updates.prepareNormalQuit.mockReturnValue(true);
    desktopIpc.attach.mockClear();
    desktopIpc.detach.mockClear();
    desktopIpc.dispose.mockClear();
    desktopIpc.notifyReviewWindowClosed.mockClear();
    registerAssetProtocol.mockClear();
    registerDesktopIpc.mockClear();
    secureWindow.mockClear();
    workspaceWindowOptions.mockClear();
    reviewWindowOptions.mockClear();
    onWindowClosed.mockClear();
    createCompositionRoot.mockReset();
    createCompositionRoot.mockImplementation(
      async (options: { onReviewRequested(reviewId: string): void }) => {
        reviewRequested = options.onReviewRequested;
        return { capabilities, updates };
      },
    );
  };

  return {
    app,
    autoUpdater,
    BrowserWindow,
    capabilities,
    createCompositionRoot,
    desktopIpc,
    emitApp,
    emitUpdater,
    onWindowClosed,
    protocol,
    registerAssetProtocol,
    registerDesktopIpc,
    reviewRequested: () => reviewRequested,
    reviewWindowOptions,
    secureWindow,
    updates,
    windows,
    workspaceWindowOptions,
    reset,
  };
});

vi.mock("electron", () => ({
  app: mocks.app,
  autoUpdater: mocks.autoUpdater,
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: {},
  protocol: mocks.protocol,
}));
vi.mock("./adapters/electron-security.js", () => ({
  registerAssetProtocol: mocks.registerAssetProtocol,
  reviewWindowOptions: mocks.reviewWindowOptions,
  REVIEW_URL: "skills-desktop://review/index.html",
  secureWindow: mocks.secureWindow,
  workspaceWindowOptions: mocks.workspaceWindowOptions,
  WORKSPACE_URL: "skills-desktop://workspace/index.html",
}));
vi.mock("./adapters/electron-ipc.js", () => ({
  registerDesktopIpc: mocks.registerDesktopIpc,
}));
vi.mock("./adapters/electron-window-lifecycle.js", () => ({
  onWindowClosed: mocks.onWindowClosed,
}));
vi.mock("./composition-root.js", () => ({
  createCompositionRoot: mocks.createCompositionRoot,
}));

async function loadEntrypoint() {
  vi.resetModules();
  await import("./index.js");
}

async function waitForStartup() {
  await vi.waitFor(() => expect(mocks.windows.length).toBeGreaterThan(0));
}

describe("desktop main entrypoint", () => {
  beforeEach(() => {
    mocks.reset();
  });

  it("quits immediately when another instance owns the lock", async () => {
    mocks.app.requestSingleInstanceLock.mockReturnValue(false);

    await loadEntrypoint();

    expect(mocks.app.quit).toHaveBeenCalledTimes(1);
    expect(mocks.app.whenReady).not.toHaveBeenCalled();
    expect(mocks.createCompositionRoot).not.toHaveBeenCalled();
    expect(mocks.BrowserWindow).not.toHaveBeenCalled();
  });

  it("uses the packaged resources icon for both production windows", async () => {
    mocks.app.isPackaged = true;

    await loadEntrypoint();
    await waitForStartup();
    mocks.reviewRequested()?.("packaged-review");

    expect(mocks.workspaceWindowOptions).toHaveBeenCalledWith(
      expect.stringContaining(join("preload", "workspace.cjs")),
      true,
      expect.stringContaining("app-icon.png"),
    );
    expect(mocks.reviewWindowOptions).toHaveBeenCalledWith(
      expect.stringContaining(join("preload", "review.cjs")),
      true,
      mocks.windows[0],
      expect.stringContaining("app-icon.png"),
    );
  });

  it("ignores a review request received before composition is ready", async () => {
    mocks.createCompositionRoot.mockImplementationOnce(
      async (options: { onReviewRequested(reviewId: string): void }) => {
        options.onReviewRequested("too-early");
        return { capabilities: mocks.capabilities, updates: mocks.updates };
      },
    );

    await loadEntrypoint();
    await waitForStartup();

    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(1);
  });

  it("starts the workspace, handles review/navigation/close events, and reactivates windows", async () => {
    await loadEntrypoint();
    await waitForStartup();

    const workspace = mocks.windows[0];
    expect(workspace?.options).toEqual({ kind: "workspace" });
    expect(mocks.protocol.registerSchemesAsPrivileged).toHaveBeenCalledTimes(1);
    expect(mocks.registerAssetProtocol).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        review: expect.stringContaining("review-renderer"),
        workspace: expect.stringContaining("renderer"),
      }),
    );
    expect(mocks.registerDesktopIpc).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceWindowOptions).toHaveBeenCalledWith(
      expect.stringContaining(join("preload", "workspace.cjs")),
      false,
      expect.stringContaining("app-icon.png"),
    );
    expect(mocks.secureWindow).toHaveBeenCalledWith(
      workspace,
      "skills-desktop://workspace/index.html",
    );
    workspace?.webContents.getURL.mockReturnValueOnce(
      "skills-desktop://unexpected/index.html",
    );
    workspace?.webContents.emit("dom-ready");
    expect(mocks.desktopIpc.attach).not.toHaveBeenCalled();
    workspace?.webContents.emit("dom-ready");
    expect(mocks.desktopIpc.attach).toHaveBeenCalledWith(
      workspace?.webContents,
      "workspace",
      "skills-desktop://workspace/index.html",
    );
    expect(workspace?.loadURL).toHaveBeenCalledWith(
      "skills-desktop://workspace/index.html",
    );

    workspace?.webContents.emit("did-start-navigation", {
      isMainFrame: false,
      isSameDocument: false,
      url: "skills-desktop://unexpected/index.html",
    });
    expect(mocks.desktopIpc.attach).toHaveBeenCalledTimes(1);
    workspace?.webContents.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: true,
      url: "skills-desktop://workspace/index.html",
    });
    expect(mocks.desktopIpc.detach).not.toHaveBeenCalled();
    workspace?.webContents.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url: "skills-desktop://workspace/index.html",
    });
    expect(mocks.desktopIpc.detach).toHaveBeenCalledWith(
      workspace?.webContents.id,
    );
    workspace?.webContents.emit("dom-ready");
    expect(mocks.desktopIpc.attach).toHaveBeenCalledTimes(2);
    workspace?.emit("ready-to-show");
    expect(workspace?.show).toHaveBeenCalledTimes(1);

    mocks.reviewRequested()?.("review-1");
    const review = mocks.windows[1];
    expect(review?.options).toEqual({ kind: "review" });
    expect(mocks.reviewWindowOptions).toHaveBeenCalledWith(
      expect.stringContaining(join("preload", "review.cjs")),
      false,
      workspace,
      expect.stringContaining("app-icon.png"),
    );
    expect(mocks.desktopIpc.attach).toHaveBeenCalledTimes(2);
    review?.webContents.emit("did-start-navigation", {
      isMainFrame: false,
      isSameDocument: false,
      url: "skills-desktop://review/index.html",
    });
    expect(mocks.desktopIpc.attach).toHaveBeenCalledTimes(2);
    review?.webContents.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
      url: "skills-desktop://review/index.html",
    });
    expect(mocks.desktopIpc.detach).toHaveBeenCalledWith(
      review?.webContents.id,
    );
    review?.webContents.emit("dom-ready");
    expect(mocks.desktopIpc.attach).toHaveBeenLastCalledWith(
      review?.webContents,
      "review",
      "skills-desktop://review/index.html",
      "review-1",
    );
    review?.emit("ready-to-show");
    expect(review?.show).toHaveBeenCalledTimes(1);

    mocks.emitApp("activate");
    expect(workspace?.focus).toHaveBeenCalledTimes(1);
    mocks.emitApp("second-instance");
    expect(workspace?.focus).toHaveBeenCalledTimes(2);

    review?.close.mockImplementationOnce(() => undefined);
    mocks.reviewRequested()?.("review-2");
    expect(review?.close).toHaveBeenCalledTimes(1);
    expect(workspace?.focus).toHaveBeenCalledTimes(2);
    expect(workspace?.webContents.focus).not.toHaveBeenCalled();
    expect(mocks.desktopIpc.notifyReviewWindowClosed).not.toHaveBeenCalled();
    const activeReview = mocks.windows[2];
    expect(activeReview?.options).toEqual({ kind: "review" });

    review?.emit("closed");
    expect(mocks.desktopIpc.detach).toHaveBeenCalledWith(
      review?.webContents.id,
    );
    expect(workspace?.focus).toHaveBeenCalledTimes(2);
    expect(workspace?.webContents.focus).not.toHaveBeenCalled();
    expect(mocks.desktopIpc.notifyReviewWindowClosed).not.toHaveBeenCalled();

    (activeReview?.close as unknown as (() => void) | undefined)?.();
    expect(workspace?.focus).toHaveBeenCalledTimes(3);
    expect(workspace?.webContents.focus).toHaveBeenCalledTimes(1);
    expect(mocks.desktopIpc.notifyReviewWindowClosed).toHaveBeenCalledWith(
      "review-2",
      workspace?.webContents.id,
    );
    expect(mocks.desktopIpc.notifyReviewWindowClosed).toHaveBeenCalledTimes(1);
    expect(workspace?.focus.mock.invocationCallOrder.at(-1)).toBeLessThan(
      workspace?.webContents.focus.mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(
      workspace?.webContents.focus.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(
      mocks.desktopIpc.notifyReviewWindowClosed.mock.invocationCallOrder.at(
        -1,
      ) ?? 0,
    );

    (workspace?.close as unknown as (() => void) | undefined)?.();
    expect(mocks.desktopIpc.detach).toHaveBeenCalledWith(
      workspace?.webContents.id,
    );
    mocks.emitApp("activate");
    const replacement = mocks.windows[3];
    expect(replacement?.options).toEqual({ kind: "workspace" });
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(4);
    mocks.emitApp("second-instance");
    expect(replacement?.focus).toHaveBeenCalledTimes(1);
    (activeReview?.close as unknown as (() => void) | undefined)?.();
    expect(replacement?.focus).toHaveBeenCalledTimes(1);
    expect(replacement?.webContents.focus).not.toHaveBeenCalled();
    expect(mocks.desktopIpc.notifyReviewWindowClosed).toHaveBeenCalledTimes(1);
    const platform = vi.spyOn(process, "platform", "get");
    platform.mockReturnValue("linux");
    mocks.emitApp("window-all-closed");
    expect(mocks.app.quit).toHaveBeenCalledTimes(1);
    platform.mockRestore();
  });

  it("keeps the application alive when macOS owns window-all-closed", async () => {
    await loadEntrypoint();
    await waitForStartup();
    const platform = vi.spyOn(process, "platform", "get");

    platform.mockReturnValue("darwin");
    mocks.emitApp("window-all-closed");
    expect(mocks.app.quit).not.toHaveBeenCalled();
    platform.mockRestore();
  });

  it("shuts down once for a normal quit and ignores reentrant quit events", async () => {
    let finishShutdown: (() => void) | undefined;
    mocks.capabilities.shutdown.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishShutdown = () => resolve(undefined);
        }),
    );
    await loadEntrypoint();
    await waitForStartup();

    const firstQuit = { preventDefault: vi.fn() };
    const secondQuit = { preventDefault: vi.fn() };
    mocks.emitApp("before-quit", firstQuit);
    mocks.emitApp("before-quit", secondQuit);
    expect(firstQuit.preventDefault).toHaveBeenCalledTimes(1);
    expect(secondQuit.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.updates.prepareNormalQuit).toHaveBeenCalledTimes(1);
    expect(mocks.updates.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.capabilities.shutdown).toHaveBeenCalledTimes(1);
    expect(mocks.desktopIpc.dispose).not.toHaveBeenCalled();

    finishShutdown?.();
    await vi.waitFor(() => expect(mocks.app.quit).toHaveBeenCalledTimes(1));
    expect(mocks.desktopIpc.dispose).toHaveBeenCalledTimes(1);

    const readyQuit = { preventDefault: vi.fn() };
    mocks.emitApp("before-quit", readyQuit);
    expect(readyQuit.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves normal quit to Electron when update restart safety rejects it", async () => {
    await loadEntrypoint();
    await waitForStartup();
    mocks.updates.prepareNormalQuit.mockReturnValue(false);
    const quit = { preventDefault: vi.fn() };

    mocks.emitApp("before-quit", quit);

    expect(quit.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.capabilities.shutdown).not.toHaveBeenCalled();
    expect(mocks.updates.dispose).not.toHaveBeenCalled();
    expect(mocks.app.quit).not.toHaveBeenCalled();
  });

  it("disposes update and capability ownership for an updater-triggered quit", async () => {
    await loadEntrypoint();
    await waitForStartup();

    mocks.emitUpdater("before-quit-for-update");
    await vi.waitFor(() =>
      expect(mocks.capabilities.shutdown).toHaveBeenCalledTimes(1),
    );
    expect(mocks.updates.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.desktopIpc.dispose).toHaveBeenCalledTimes(1);

    const quit = { preventDefault: vi.fn() };
    mocks.emitApp("before-quit", quit);
    expect(quit.preventDefault).not.toHaveBeenCalled();
  });

  it("quits if composition-root startup fails", async () => {
    mocks.createCompositionRoot.mockRejectedValueOnce(
      new Error("startup failure"),
    );

    await loadEntrypoint();
    await vi.waitFor(() => expect(mocks.app.quit).toHaveBeenCalledTimes(1));

    expect(mocks.BrowserWindow).not.toHaveBeenCalled();
  });
});
