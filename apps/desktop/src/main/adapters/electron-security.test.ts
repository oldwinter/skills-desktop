import { describe, expect, it } from "vitest";

import {
  reviewWindowOptions,
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
  });
});
