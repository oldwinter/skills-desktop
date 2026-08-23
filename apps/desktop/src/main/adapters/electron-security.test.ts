import { mkdtemp, mkdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerAssetProtocol,
  reviewWindowOptions,
  secureWindow,
  WORKSPACE_URL,
  workspaceWindowOptions,
} from "./electron-security.js";

describe("workspace BrowserWindow security contract", () => {
  it("enables isolation and sandboxing while denying Node and webviews", () => {
    expect(
      workspaceWindowOptions(
        "/app/preload/workspace.cjs",
        true,
        "/app/resources/app-icon.png",
      ),
    ).toMatchObject({
      icon: "/app/resources/app-icon.png",
      minWidth: 360,
      webPreferences: {
        contextIsolation: true,
        devTools: false,
        nodeIntegration: false,
        preload: "/app/preload/workspace.cjs",
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    });
    expect(workspaceWindowOptions("/app/preload/workspace.cjs", false).webPreferences?.devTools).toBe(
      true,
    );
  });

  it("gives Trusted Review an isolated, modal, purpose-built window", () => {
    const parent = { id: "workspace-window" } as never;

    expect(
      reviewWindowOptions(
        "/app/preload/review.cjs",
        true,
        parent,
        "/app/resources/app-icon.png",
      ),
    ).toMatchObject({
      icon: "/app/resources/app-icon.png",
      minWidth: 360,
      modal: true,
      parent,
      title: "Trusted Review",
      webPreferences: {
        contextIsolation: true,
        devTools: false,
        nodeIntegration: false,
        preload: "/app/preload/review.cjs",
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    });
    expect(reviewWindowOptions("/app/preload/review.cjs", false).modal).toBe(
      false,
    );
  });
});

describe("skills-desktop asset protocol", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  async function createRoots() {
    const base = await mkdtemp(join(tmpdir(), "skills-desktop-assets-"));
    temporaryDirectories.push(base);
    const roots = {
      review: join(base, "review"),
      workspace: join(base, "workspace"),
    };
    await mkdir(roots.review);
    await mkdir(roots.workspace);
    return roots;
  }

  function register(roots: { readonly review: string; readonly workspace: string }) {
    let handler:
      | ((request: { readonly url: string }) => Promise<Response>)
      | undefined;
    const protocol = {
      handle: vi.fn(
        (
          scheme: string,
          callback: (request: { readonly url: string }) => Promise<Response>,
        ) => {
          expect(scheme).toBe("skills-desktop");
          handler = callback;
        },
      ),
    };
    registerAssetProtocol(protocol as never, roots);
    expect(handler).toBeDefined();
    return handler as (request: { readonly url: string }) => Promise<Response>;
  }

  it("serves allowlisted workspace and review assets with bounded headers", async () => {
    const roots = await createRoots();
    await writeFile(join(roots.workspace, "index.html"), "workspace index");
    await writeFile(join(roots.review, "index.html"), "review index");
    await writeFile(join(roots.workspace, "theme.css"), "body {}");
    await writeFile(join(roots.workspace, "payload.bin"), "opaque");
    const handle = register(roots);

    const workspaceResponse = await handle({ url: WORKSPACE_URL });
    expect(workspaceResponse.status).toBe(200);
    expect(await workspaceResponse.text()).toBe("workspace index");
    expect(workspaceResponse.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(workspaceResponse.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    expect(workspaceResponse.headers.get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin",
    );
    expect(workspaceResponse.headers.get("X-Content-Type-Options")).toBe(
      "nosniff",
    );

    const reviewResponse = await handle({ url: "skills-desktop://review/" });
    expect(await reviewResponse.text()).toBe("review index");

    const cssResponse = await handle({
      url: "skills-desktop://workspace/theme.css",
    });
    expect(cssResponse.headers.get("Content-Type")).toBe(
      "text/css; charset=utf-8",
    );
    const fallbackResponse = await handle({
      url: "skills-desktop://workspace/payload.bin",
    });
    expect(fallbackResponse.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
  });

  it("returns 404 for malformed URLs, hosts, escapes, directories, oversized files, and misses", async () => {
    const roots = await createRoots();
    await mkdir(join(roots.workspace, "directory"));
    await writeFile(join(roots.workspace, "large.bin"), "");
    await truncate(join(roots.workspace, "large.bin"), 20 * 1024 * 1024 + 1);
    const handle = register(roots);

    for (const url of [
      "not a URL",
      "skills-desktop://other/index.html",
      "skills-desktop://workspace/%E0%A4%A",
      "skills-desktop://workspace/%2e%2e/outside.txt",
      "skills-desktop://workspace/..%2Foutside.txt",
      "skills-desktop://workspace/directory",
      "skills-desktop://workspace/large.bin",
      "skills-desktop://workspace/missing.js",
    ]) {
      await expect(handle({ url })).resolves.toMatchObject({ status: 404 });
    }
  });
});

describe("Electron window security handlers", () => {
  it("denies windows, unexpected navigation, webviews, permissions, and downloads", () => {
    const windowOpenHandler = vi.fn();
    const listeners = new Map<string, (...args: never[]) => unknown>();
    const on = vi.fn((event: string, listener: (...args: never[]) => unknown) => {
      listeners.set(event, listener);
    });
    const setPermissionCheckHandler = vi.fn();
    const setPermissionRequestHandler = vi.fn();
    const sessionOn = vi.fn();
    const window = {
      webContents: {
        setWindowOpenHandler: windowOpenHandler,
        on,
        session: {
          setPermissionCheckHandler,
          setPermissionRequestHandler,
          on: sessionOn,
        },
      },
    };
    secureWindow(window as never, WORKSPACE_URL);

    expect(windowOpenHandler).toHaveBeenCalledTimes(1);
    expect(
      (windowOpenHandler.mock.calls[0]?.[0] as () => { action: string })(),
    ).toEqual({ action: "deny" });

    const allowedEvent = { preventDefault: vi.fn() };
    listeners.get("will-navigate")?.(allowedEvent as never, WORKSPACE_URL as never);
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
    const deniedEvent = { preventDefault: vi.fn() };
    listeners
      .get("will-navigate")
      ?.(deniedEvent as never, "https://example.test/" as never);
    expect(deniedEvent.preventDefault).toHaveBeenCalledOnce();

    const webviewEvent = { preventDefault: vi.fn() };
    listeners.get("will-attach-webview")?.(webviewEvent as never);
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce();

    const permissionCheck = setPermissionCheckHandler.mock.calls[0]?.[0] as
      | (() => boolean)
      | undefined;
    expect(permissionCheck?.()).toBe(false);
    const permissionCallback = vi.fn();
    const permissionRequest = setPermissionRequestHandler.mock.calls[0]?.[0] as
      | ((webContents: unknown, permission: unknown, callback: (allowed: boolean) => void) => void)
      | undefined;
    permissionRequest?.({ id: 1 }, "notifications", permissionCallback);
    expect(permissionCallback).toHaveBeenCalledWith(false);

    const downloadEvent = { preventDefault: vi.fn() };
    const downloadListener = sessionOn.mock.calls[0]?.[1] as
      | ((event: { preventDefault: () => void }) => void)
      | undefined;
    downloadListener?.(downloadEvent);
    expect(downloadEvent.preventDefault).toHaveBeenCalledOnce();
  });
});
