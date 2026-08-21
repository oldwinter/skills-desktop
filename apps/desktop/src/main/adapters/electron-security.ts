import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import type { BrowserWindow, BrowserWindowConstructorOptions, Protocol } from "electron";

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export const WORKSPACE_URL = "skills-desktop://workspace/index.html";
export const REVIEW_URL = "skills-desktop://review/index.html";

export function workspaceWindowOptions(
  preload: string,
  isPackaged: boolean,
): BrowserWindowConstructorOptions {
  return {
    autoHideMenuBar: true,
    backgroundColor: "#f5f6f7",
    height: 900,
    minHeight: 640,
    minWidth: 360,
    show: false,
    title: "Skills Desktop",
    webPreferences: {
      contextIsolation: true,
      devTools: !isPackaged,
      nodeIntegration: false,
      preload,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      webviewTag: false,
    },
    width: 1440,
  };
}

export function registerAssetProtocol(
  protocol: Protocol,
  roots: { readonly review: string; readonly workspace: string },
) {
  protocol.handle("skills-desktop", async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const root = url.hostname === "workspace" ? roots.workspace : url.hostname === "review" ? roots.review : null;
    if (root === null) return new Response("Not found", { status: 404 });

    let relativePath: string;
    try {
      relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const candidate = resolve(root, `.${relativePath}`);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const details = await stat(candidate);
      if (!details.isFile() || details.size > 20 * 1024 * 1024) {
        return new Response("Not found", { status: 404 });
      }
      const body = await readFile(candidate);
      return new Response(body, {
        headers: {
          "Content-Security-Policy": CONTENT_SECURITY_POLICY,
          "Content-Type": MIME_TYPES[extname(candidate)] ?? "application/octet-stream",
          "Cross-Origin-Opener-Policy": "same-origin",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

export function secureWindow(window: BrowserWindow, expectedUrl: string) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    if (navigationUrl !== expectedUrl) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.on("will-download", (event) => event.preventDefault());
}
