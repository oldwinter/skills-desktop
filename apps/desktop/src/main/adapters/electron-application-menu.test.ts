import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";

import type { Locale } from "../../contracts/preferences.js";
import type { MenuCommand } from "../../contracts/menu.js";
import {
  createElectronApplicationMenu,
  menuTemplate,
  type ApplicationMenuRuntime,
} from "./electron-application-menu.js";

function recorder() {
  const aboutOptions: unknown[] = [];
  const installed: MenuItemConstructorOptions[][] = [];
  const runtime: ApplicationMenuRuntime = {
    app: {
      setAboutPanelOptions(options) {
        aboutOptions.push(options);
      },
    },
    menu: {
      buildFromTemplate(template) {
        return { template };
      },
      setApplicationMenu(menu) {
        installed.push((menu as { template: MenuItemConstructorOptions[] }).template);
      },
    },
  };
  return { aboutOptions, installed, runtime };
}

const flatten = (template: MenuItemConstructorOptions[]) =>
  template.flatMap((top) =>
    Array.isArray(top.submenu) ? top.submenu : [],
  );

describe("createElectronApplicationMenu", () => {
  it("installs a localized template and the native About identity together", () => {
    const { aboutOptions, installed, runtime } = recorder();
    let locale: Locale = "en";
    const menu = createElectronApplicationMenu({
      about: () => ({
        architecture: "x64",
        releaseChannel: "unsigned-preview",
        version: "0.1.0",
      }),
      locale: () => locale,
      onCommand() {},
      platform: "linux",
      runtime,
    });

    const first = menu.install();
    expect(first.locale).toBe("en");
    expect(installed).toHaveLength(1);
    expect(installed[0]?.map(({ label }) => label)).toEqual([
      "File",
      "Edit",
      "View",
      "Window",
      "Help",
    ]);
    expect(aboutOptions[0]).toEqual({
      applicationName: "Skills Desktop",
      applicationVersion: "0.1.0",
      copyright:
        "Local-only V1. Skills are managed through the pinned skills CLI.",
      credits: "Release channel: unsigned-preview",
      version: "linux-x64",
    });

    locale = "zh-CN";
    expect(menu.current().locale).toBe("en");
    const second = menu.install();
    expect(second.locale).toBe("zh-CN");
    expect(installed[1]?.map(({ label }) => label)).toEqual([
      "文件",
      "编辑",
      "视图",
      "窗口",
      "帮助",
    ]);
    expect(aboutOptions[1]).toMatchObject({ credits: "发布渠道：unsigned-preview" });
    expect(menu.current()).toEqual(second);
  });

  it("routes clicks to the closed command name and keeps roles for Electron", () => {
    const { installed, runtime } = recorder();
    const commands: MenuCommand[] = [];
    createElectronApplicationMenu({
      about: () => ({ architecture: "arm64", releaseChannel: "stable", version: "1.0.0" }),
      locale: () => "en",
      onCommand: (command) => commands.push(command),
      platform: "darwin",
      runtime,
    }).install();

    const template = installed[0];
    if (template === undefined) throw new Error("fixture");
    expect(template[0]).toMatchObject({ id: "app", role: "appMenu" });
    expect(template.find(({ id }) => id === "window")).toMatchObject({
      role: "windowMenu",
    });
    const items = flatten(template);
    const refresh = items.find(({ id }) => id === "view.refresh-inventory");
    const about = items.find(({ id }) => id === "app.about");
    const separator = items.find(({ id }) => id === "edit.separator-1");
    expect(refresh).toMatchObject({ accelerator: "CmdOrCtrl+R", label: "Refresh Inventory" });
    expect(about).toEqual({ id: "app.about", label: "About Skills Desktop", role: "about" });
    expect(separator).toEqual({ id: "edit.separator-1", type: "separator" });
    expect(refresh?.role).toBeUndefined();

    refresh?.click?.(
      undefined as never,
      undefined as never,
      undefined as never,
    );
    items
      .find(({ id }) => id === "view.navigate-about")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    expect(commands).toEqual(["inventory.refresh", "navigate.about"]);
    expect(about?.click).toBeUndefined();
  });

  it("emits no role for top-level menus outside macOS", () => {
    const { runtime } = recorder();
    const menu = createElectronApplicationMenu({
      about: () => ({ architecture: "x64", releaseChannel: "stable", version: "1.0.0" }),
      locale: () => "en",
      onCommand() {},
      platform: "win32",
      runtime,
    }).install();
    for (const top of menuTemplate(menu, () => undefined)) {
      expect(top.role).toBeUndefined();
    }
    expect(menuTemplate(menu, () => undefined).map(({ id }) => id)).toEqual([
      "file",
      "edit",
      "view",
      "window",
      "help",
    ]);
  });
});
