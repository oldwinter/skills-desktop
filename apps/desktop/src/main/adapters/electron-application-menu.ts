import type { MenuItemConstructorOptions } from "electron";

import type { Locale } from "../../contracts/preferences.js";
import type { ApplicationMenu, MenuCommand, MenuItem } from "../../contracts/menu.js";
import {
  buildApplicationMenu,
  describeAboutPanel,
  menuPlatformFor,
} from "../application/application-menu.js";

/** The slice of Electron this adapter needs; tests substitute a recorder. */
export interface ApplicationMenuRuntime {
  readonly app: {
    setAboutPanelOptions(options: {
      readonly applicationName: string;
      readonly applicationVersion: string;
      readonly copyright: string;
      readonly credits: string;
      readonly version: string;
    }): void;
  };
  readonly menu: {
    buildFromTemplate(template: MenuItemConstructorOptions[]): unknown;
    setApplicationMenu(menu: unknown): void;
  };
}

export interface ElectronApplicationMenuOptions {
  /** Identity shown by the native About panel; read at each install. */
  readonly about: () => {
    readonly architecture: string;
    readonly releaseChannel: string;
    readonly version: string;
  };
  readonly locale: () => Locale;
  /** Every menu activation lands here with its closed command name. */
  readonly onCommand: (command: MenuCommand) => void;
  readonly platform: NodeJS.Platform;
  readonly runtime: ApplicationMenuRuntime;
}

export interface ElectronApplicationMenu {
  /** The projection currently installed (or about to be, before `install`). */
  current(): ApplicationMenu;
  /** Build from the current locale and hand it to Electron. Idempotent. */
  install(): ApplicationMenu;
}

function itemTemplate(
  item: MenuItem,
  onCommand: (command: MenuCommand) => void,
): MenuItemConstructorOptions {
  switch (item.kind) {
    case "separator":
      return { id: item.id, type: "separator" };
    case "role":
      return { id: item.id, label: item.label, role: item.role };
    case "command":
      return {
        ...(item.accelerator === undefined
          ? {}
          : { accelerator: item.accelerator }),
        click: () => onCommand(item.command),
        id: item.id,
        label: item.label,
      };
  }
}

export function menuTemplate(
  menu: ApplicationMenu,
  onCommand: (command: MenuCommand) => void,
): MenuItemConstructorOptions[] {
  return menu.menus.map((topLevel) => ({
    id: topLevel.id,
    label: topLevel.label,
    ...(topLevel.role === undefined ? {} : { role: topLevel.role }),
    submenu: topLevel.items.map((item) => itemTemplate(item, onCommand)),
  }));
}

export function createElectronApplicationMenu(
  options: ElectronApplicationMenuOptions,
): ElectronApplicationMenu {
  const platform = menuPlatformFor(options.platform);
  let installed: ApplicationMenu | undefined;

  const build = () =>
    buildApplicationMenu({ locale: options.locale(), platform });

  return {
    current() {
      return installed ?? build();
    },
    install() {
      const menu = build();
      const about = options.about();
      options.runtime.app.setAboutPanelOptions(
        describeAboutPanel({
          architecture: about.architecture,
          locale: menu.locale,
          platform,
          releaseChannel: about.releaseChannel,
          version: about.version,
        }),
      );
      options.runtime.menu.setApplicationMenu(
        options.runtime.menu.buildFromTemplate(
          menuTemplate(menu, options.onCommand),
        ),
      );
      installed = menu;
      return menu;
    },
  };
}
