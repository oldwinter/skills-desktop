import { describe, expect, it } from "vitest";

import { CATALOGS } from "../../contracts/i18n/translate.js";
import { LOCALES } from "../../contracts/preferences.js";
import {
  MENU_PLATFORMS,
  applicationMenuSchema,
  menuCommandItem,
  type MenuItem,
} from "../../contracts/menu.js";
import {
  ariaKeyShortcutsFor,
  buildApplicationMenu,
  describeAboutPanel,
  menuPlatformFor,
} from "./application-menu.js";

const labelled = (items: readonly MenuItem[]) =>
  items.flatMap((item) => (item.kind === "separator" ? [] : [item.label]));

describe("buildApplicationMenu", () => {
  it.each(MENU_PLATFORMS)(
    "produces the standard top-level menus on %s",
    (platform) => {
      const menu = buildApplicationMenu({ locale: "en", platform });
      expect(applicationMenuSchema.safeParse(menu).success).toBe(true);
      expect(menu.menus.map(({ id }) => id)).toEqual(
        platform === "darwin"
          ? ["app", "file", "edit", "view", "window", "help"]
          : ["file", "edit", "view", "window", "help"],
      );
      expect(menu.menus.find(({ id }) => id === "app")?.role).toBe(
        platform === "darwin" ? "appMenu" : undefined,
      );
      expect(menu.menus.find(({ id }) => id === "window")?.role).toBe(
        platform === "darwin" ? "windowMenu" : undefined,
      );
    },
  );

  it("reaches every renderer command and the two main-owned commands from the menu", () => {
    for (const platform of MENU_PLATFORMS) {
      const menu = buildApplicationMenu({ locale: "en", platform });
      for (const command of [
        "inventory.refresh",
        "navigate.inventory",
        "navigate.comparison",
        "navigate.collections",
        "navigate.targets",
        "navigate.publish",
        "navigate.recovery",
        "navigate.about",
        "update.check",
        "workspace.show",
      ] as const) {
        expect(menuCommandItem(menu, command), `${platform} ${command}`).toBeDefined();
      }
      const nativeAbout = menuCommandItem(menu, "about.show");
      const aboutRole = menu.menus
        .flatMap(({ items }) => items)
        .find((item) => item.kind === "role" && item.role === "about");
      if (platform === "darwin") {
        expect(nativeAbout).toBeUndefined();
        expect(aboutRole).toBeDefined();
      } else {
        expect(nativeAbout).toBeDefined();
        expect(aboutRole).toBeUndefined();
      }
    }
  });

  it("gives navigation and refresh unique accelerators with matching aria-keyshortcuts", () => {
    const darwin = buildApplicationMenu({ locale: "en", platform: "darwin" });
    const linux = buildApplicationMenu({ locale: "en", platform: "linux" });
    expect(menuCommandItem(darwin, "inventory.refresh")).toMatchObject({
      accelerator: "CmdOrCtrl+R",
      ariaKeyShortcuts: "Meta+R",
    });
    expect(menuCommandItem(linux, "inventory.refresh")).toMatchObject({
      accelerator: "CmdOrCtrl+R",
      ariaKeyShortcuts: "Control+R",
    });
    expect(menuCommandItem(linux, "navigate.about")).toMatchObject({
      accelerator: "CmdOrCtrl+7",
      ariaKeyShortcuts: "Control+7",
    });
    expect(menuCommandItem(linux, "update.check")?.accelerator).toBeUndefined();
    const accelerators = linux.menus
      .flatMap(({ items }) => items)
      .flatMap((item) =>
        item.kind === "separator" || item.accelerator === undefined
          ? []
          : [item.accelerator],
      );
    expect(new Set(accelerators).size).toBe(accelerators.length);
    expect(accelerators).not.toContain("CmdOrCtrl+Shift+R");
  });

  it("never leaves a raw message key or an English fallback in the zh-CN menu", () => {
    const en = buildApplicationMenu({ locale: "en", platform: "linux" });
    const zh = buildApplicationMenu({ locale: "zh-CN", platform: "linux" });
    expect(zh.locale).toBe("zh-CN");
    const enLabels = en.menus.flatMap(({ items, label }) => [label, ...labelled(items)]);
    const zhLabels = zh.menus.flatMap(({ items, label }) => [label, ...labelled(items)]);
    expect(zhLabels).toHaveLength(enLabels.length);
    for (const label of [...enLabels, ...zhLabels]) {
      expect(label).not.toMatch(/^(menu|nav|app)\./);
      expect(label).not.toMatch(/\{[a-zA-Z]+\}/);
    }
    expect(zhLabels).toContain("文件");
    expect(zhLabels).toContain("刷新库存");
    expect(zhLabels).toContain("前往库存");
    expect(zhLabels).toContain("关于 Skills Desktop");
    // Identifiers are interpolated, never translated (ADR 0023).
    expect(zhLabels).toContain("前往Targets");
  });

  it("keeps every menu message key present in every catalog", () => {
    const menuKeys = Object.keys(CATALOGS.en).filter((key) =>
      key.startsWith("menu."),
    );
    expect(menuKeys.length).toBeGreaterThan(20);
    for (const locale of LOCALES) {
      for (const key of menuKeys) {
        expect(CATALOGS[locale]).toHaveProperty(key);
      }
    }
  });

  it("rejects duplicate ids and accelerators at the schema edge", () => {
    const menu = buildApplicationMenu({ locale: "en", platform: "win32" });
    const view = menu.menus.find(({ id }) => id === "view");
    const refresh = view?.items.find(
      (item) => item.kind === "command" && item.command === "inventory.refresh",
    );
    if (view === undefined || refresh === undefined) throw new Error("fixture");
    expect(
      applicationMenuSchema.safeParse({
        ...menu,
        menus: menu.menus.map((topLevel) =>
          topLevel.id === "view"
            ? { ...topLevel, items: [...topLevel.items, { ...refresh, id: "dup" }] }
            : topLevel,
        ),
      }).success,
    ).toBe(false);
    expect(
      applicationMenuSchema.safeParse({
        ...menu,
        menus: [...menu.menus, menu.menus[0]],
      }).success,
    ).toBe(false);
  });
});

describe("ariaKeyShortcutsFor", () => {
  it("maps Electron modifiers onto the WAI-ARIA vocabulary per platform", () => {
    expect(ariaKeyShortcutsFor("CmdOrCtrl+Shift+R", "darwin")).toBe(
      "Meta+Shift+R",
    );
    expect(ariaKeyShortcutsFor("CommandOrControl+1", "win32")).toBe("Control+1");
    expect(ariaKeyShortcutsFor("Ctrl+Alt+Delete", "linux")).toBe(
      "Control+Alt+Delete",
    );
    expect(ariaKeyShortcutsFor("Cmd+Q", "darwin")).toBe("Meta+Q");
  });
});

describe("describeAboutPanel", () => {
  it("shows the same identity and channel the renderer About view shows", () => {
    expect(
      describeAboutPanel({
        architecture: "x64",
        locale: "en",
        platform: "linux",
        releaseChannel: "unsigned-preview",
        version: "0.1.0",
      }),
    ).toEqual({
      applicationName: "Skills Desktop",
      applicationVersion: "0.1.0",
      copyright:
        "Local-only V1. Skills are managed through the pinned skills CLI.",
      credits: "Release channel: unsigned-preview",
      version: "linux-x64",
    });
    expect(
      describeAboutPanel({
        architecture: "arm64",
        locale: "zh-CN",
        platform: "darwin",
        releaseChannel: "stable",
        version: "1.2.3",
      }),
    ).toMatchObject({
      applicationName: "Skills Desktop",
      credits: "发布渠道：stable",
      version: "darwin-arm64",
    });
  });
});

describe("menuPlatformFor", () => {
  it("folds every non-Apple, non-Windows platform onto the Linux layout", () => {
    expect(menuPlatformFor("darwin")).toBe("darwin");
    expect(menuPlatformFor("win32")).toBe("win32");
    expect(menuPlatformFor("linux")).toBe("linux");
    expect(menuPlatformFor("freebsd")).toBe("linux");
  });
});
