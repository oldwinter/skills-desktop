import { describe, expect, it } from "vitest";

import { workspaceWindowOptions } from "./electron-security.js";

describe("workspace BrowserWindow security contract", () => {
  it("enables isolation and sandboxing while denying Node and webviews", () => {
    expect(workspaceWindowOptions("/app/preload/workspace.cjs", true)).toMatchObject({
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
});
