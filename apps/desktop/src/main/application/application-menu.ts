import {
  createTranslator,
  type MessageKey,
  type Translator,
} from "../../contracts/i18n/translate.js";
import type { Locale } from "../../contracts/preferences.js";
import {
  applicationMenuSchema,
  type ApplicationMenu,
  type MenuCommand,
  type MenuItem,
  type MenuPlatform,
  type MenuRole,
  type TopLevelMenu,
} from "../../contracts/menu.js";

/**
 * ADR 0023: the application menu is main-owned and localized from the same
 * catalogs as the renderer. This module is pure: it turns locale + platform
 * into the structured `ApplicationMenu` projection. The Electron adapter
 * renders that projection; the renderer mirrors its accelerators; packaged QA
 * enumerates it. Nothing here touches Electron.
 */

export interface ApplicationMenuInput {
  readonly locale: Locale;
  readonly platform: MenuPlatform;
}

export interface AboutPanelDescription {
  readonly applicationName: string;
  readonly applicationVersion: string;
  readonly copyright: string;
  readonly credits: string;
  readonly version: string;
}

export interface AboutPanelInput extends ApplicationMenuInput {
  readonly architecture: string;
  readonly releaseChannel: string;
  readonly version: string;
}

const NAVIGATION: readonly {
  readonly command: MenuCommand;
  readonly digit: string;
  readonly label: MessageKey;
}[] = [
  { command: "navigate.inventory", digit: "1", label: "nav.inventory" },
  { command: "navigate.comparison", digit: "2", label: "nav.comparison" },
  { command: "navigate.collections", digit: "3", label: "nav.collections" },
  { command: "navigate.targets", digit: "4", label: "nav.targets" },
  { command: "navigate.recovery", digit: "5", label: "nav.recovery" },
  { command: "navigate.about", digit: "6", label: "nav.about" },
];

/** Convert an Electron accelerator into WAI-ARIA `aria-keyshortcuts` text. */
export function ariaKeyShortcutsFor(
  accelerator: string,
  platform: MenuPlatform,
): string {
  return accelerator
    .split("+")
    .map((part) => {
      switch (part) {
        case "CmdOrCtrl":
        case "CommandOrControl":
          return platform === "darwin" ? "Meta" : "Control";
        case "Cmd":
        case "Command":
          return "Meta";
        case "Ctrl":
          return "Control";
        default:
          return part;
      }
    })
    .join("+");
}

function separator(id: string): MenuItem {
  return { id, kind: "separator" };
}

function role(id: string, label: string, roleName: MenuRole): MenuItem {
  return { id, kind: "role", label, role: roleName };
}

function command(
  id: string,
  label: string,
  commandName: MenuCommand,
  platform: MenuPlatform,
  accelerator?: string,
): MenuItem {
  return accelerator === undefined
    ? { command: commandName, id, kind: "command", label }
    : {
        accelerator,
        ariaKeyShortcuts: ariaKeyShortcutsFor(accelerator, platform),
        command: commandName,
        id,
        kind: "command",
        label,
      };
}

function appMenu({ t }: Translator): TopLevelMenu {
  const app = t("app.name");
  return {
    id: "app",
    items: [
      role("app.about", t("menu.about", { app }), "about"),
      separator("app.separator-1"),
      role("app.services", t("menu.services"), "services"),
      separator("app.separator-2"),
      role("app.hide", t("menu.hide", { app }), "hide"),
      role("app.hide-others", t("menu.hideOthers"), "hideOthers"),
      role("app.unhide", t("menu.unhide"), "unhide"),
      separator("app.separator-3"),
      role("app.quit", t("menu.quit", { app }), "quit"),
    ],
    label: app,
    role: "appMenu",
  };
}

function fileMenu({ t }: Translator, platform: MenuPlatform): TopLevelMenu {
  return {
    id: "file",
    items:
      platform === "darwin"
        ? [role("file.close", t("menu.closeWindow"), "close")]
        : [role("file.exit", t("menu.exit"), "quit")],
    label: t("menu.file"),
  };
}

function editMenu({ t }: Translator): TopLevelMenu {
  return {
    id: "edit",
    items: [
      role("edit.undo", t("menu.undo"), "undo"),
      role("edit.redo", t("menu.redo"), "redo"),
      separator("edit.separator-1"),
      role("edit.cut", t("menu.cut"), "cut"),
      role("edit.copy", t("menu.copy"), "copy"),
      role("edit.paste", t("menu.paste"), "paste"),
      role("edit.delete", t("menu.delete"), "delete"),
      role("edit.select-all", t("menu.selectAll"), "selectAll"),
    ],
    label: t("menu.edit"),
  };
}

function viewMenu({ t }: Translator, platform: MenuPlatform): TopLevelMenu {
  return {
    id: "view",
    items: [
      command(
        "view.refresh-inventory",
        t("menu.refreshInventory"),
        "inventory.refresh",
        platform,
        "CmdOrCtrl+R",
      ),
      separator("view.separator-1"),
      ...NAVIGATION.map(({ command: navigate, digit, label }) =>
        command(
          `view.${navigate.replace(".", "-")}`,
          t("menu.goTo", { view: t(label) }),
          navigate,
          platform,
          `CmdOrCtrl+${digit}`,
        ),
      ),
      separator("view.separator-2"),
      role("view.reset-zoom", t("menu.resetZoom"), "resetZoom"),
      role("view.zoom-in", t("menu.zoomIn"), "zoomIn"),
      role("view.zoom-out", t("menu.zoomOut"), "zoomOut"),
      separator("view.separator-3"),
      role(
        "view.toggle-full-screen",
        t("menu.toggleFullScreen"),
        "togglefullscreen",
      ),
    ],
    label: t("menu.view"),
  };
}

function windowMenu({ t }: Translator, platform: MenuPlatform): TopLevelMenu {
  const show = command(
    "window.show-workspace",
    t("menu.showWorkspace"),
    "workspace.show",
    platform,
  );
  return {
    id: "window",
    items:
      platform === "darwin"
        ? [
            role("window.minimize", t("menu.minimize"), "minimize"),
            role("window.zoom", t("menu.zoom"), "zoom"),
            separator("window.separator-1"),
            show,
            separator("window.separator-2"),
            role("window.front", t("menu.front"), "front"),
          ]
        : [
            role("window.minimize", t("menu.minimize"), "minimize"),
            role("window.close", t("menu.closeWindow"), "close"),
            separator("window.separator-1"),
            show,
          ],
    label: t("menu.window"),
    ...(platform === "darwin" ? { role: "windowMenu" as const } : {}),
  };
}

function helpMenu({ t }: Translator, platform: MenuPlatform): TopLevelMenu {
  const check = command(
    "help.check-for-updates",
    t("menu.checkForUpdates"),
    "update.check",
    platform,
  );
  return {
    id: "help",
    items:
      platform === "darwin"
        ? [check]
        : [
            check,
            separator("help.separator-1"),
            command(
              "help.about",
              t("menu.about", { app: t("app.name") }),
              "about.show",
              platform,
            ),
          ],
    label: t("menu.help"),
  };
}

export function buildApplicationMenu(
  input: ApplicationMenuInput,
): ApplicationMenu {
  const translator = createTranslator(input.locale);
  const menus: TopLevelMenu[] = [
    ...(input.platform === "darwin" ? [appMenu(translator)] : []),
    fileMenu(translator, input.platform),
    editMenu(translator),
    viewMenu(translator, input.platform),
    windowMenu(translator, input.platform),
    helpMenu(translator, input.platform),
  ];
  return applicationMenuSchema.parse({
    locale: input.locale,
    menus,
    platform: input.platform,
    schemaVersion: 1,
  });
}

/**
 * The native About panel shows exactly the identity the renderer About view
 * shows: product name, version, and release channel from the update
 * coordinator. No other source of version truth exists.
 */
export function describeAboutPanel(
  input: AboutPanelInput,
): AboutPanelDescription {
  const { t } = createTranslator(input.locale);
  return {
    applicationName: t("app.name"),
    applicationVersion: input.version,
    copyright: t("menu.aboutPanel.copyright"),
    credits: t("menu.aboutPanel.channel", { channel: input.releaseChannel }),
    version: `${input.platform}-${input.architecture}`,
  };
}

export function menuPlatformFor(platform: NodeJS.Platform): MenuPlatform {
  return platform === "darwin" || platform === "win32" ? platform : "linux";
}
