import { z } from "zod";

import { localeSchema } from "./preferences.js";

/**
 * ADR 0023: main owns the localized application menu. This contract is the
 * structured projection of that menu (so the renderer can mirror accelerators
 * as `aria-keyshortcuts` and packaged QA can enumerate it) plus the closed set
 * of commands a menu item may relay to the workspace renderer.
 *
 * Commands never carry arguments. Anything that needs workspace state (the
 * active Target for a refresh, the current route for navigation) is resolved
 * by the renderer, which then issues the same closed Workspace v2 request it
 * would for the equivalent toolbar control.
 */

export const MENU_PLATFORMS = ["darwin", "linux", "win32"] as const;
export const menuPlatformSchema = z.enum(MENU_PLATFORMS);
export type MenuPlatform = z.infer<typeof menuPlatformSchema>;

/** Commands the workspace renderer executes on main's behalf. */
export const RENDERER_MENU_COMMANDS = [
  "inventory.refresh",
  "navigate.about",
  "navigate.collections",
  "navigate.comparison",
  "navigate.inventory",
  "navigate.publish",
  "navigate.recovery",
  "navigate.targets",
  "update.check",
] as const;
export const rendererMenuCommandSchema = z.enum(RENDERER_MENU_COMMANDS);
export type RendererMenuCommand = z.infer<typeof rendererMenuCommandSchema>;

/** Commands main resolves itself without a renderer. */
export const MAIN_MENU_COMMANDS = ["about.show", "workspace.show"] as const;

export const MENU_COMMANDS = [
  ...RENDERER_MENU_COMMANDS,
  ...MAIN_MENU_COMMANDS,
] as const;
export const menuCommandSchema = z.enum(MENU_COMMANDS);
export type MenuCommand = z.infer<typeof menuCommandSchema>;

/** Electron roles this shell is allowed to delegate to the runtime. */
export const MENU_ROLES = [
  "about",
  "close",
  "copy",
  "cut",
  "delete",
  "front",
  "hide",
  "hideOthers",
  "minimize",
  "paste",
  "quit",
  "redo",
  "resetZoom",
  "selectAll",
  "services",
  "togglefullscreen",
  "undo",
  "unhide",
  "zoom",
  "zoomIn",
  "zoomOut",
] as const;
export const menuRoleSchema = z.enum(MENU_ROLES);
export type MenuRole = z.infer<typeof menuRoleSchema>;

const menuIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9.-]*$/);
const menuLabelSchema = z.string().trim().min(1).max(128);
/** Electron accelerator syntax, e.g. `CmdOrCtrl+Shift+R`. */
const acceleratorSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9]+(\+[A-Za-z0-9=-]+)*$/);
/** WAI-ARIA `aria-keyshortcuts` syntax, e.g. `Control+Shift+R`. */
const ariaKeyShortcutsSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9]+(\+[A-Za-z0-9]+)*( [A-Za-z0-9]+(\+[A-Za-z0-9]+)*)*$/);

export const menuSeparatorSchema = z
  .object({
    id: menuIdSchema,
    kind: z.literal("separator"),
  })
  .strict();

export const menuRoleItemSchema = z
  .object({
    accelerator: acceleratorSchema.optional(),
    id: menuIdSchema,
    kind: z.literal("role"),
    label: menuLabelSchema,
    role: menuRoleSchema,
  })
  .strict();

export const menuCommandItemSchema = z
  .object({
    accelerator: acceleratorSchema.optional(),
    ariaKeyShortcuts: ariaKeyShortcutsSchema.optional(),
    command: menuCommandSchema,
    id: menuIdSchema,
    kind: z.literal("command"),
    label: menuLabelSchema,
  })
  .strict();

export const menuItemSchema = z.discriminatedUnion("kind", [
  menuCommandItemSchema,
  menuRoleItemSchema,
  menuSeparatorSchema,
]);
export type MenuItem = z.infer<typeof menuItemSchema>;

export const TOP_LEVEL_MENUS = [
  "app",
  "file",
  "edit",
  "view",
  "window",
  "help",
] as const;
export const topLevelMenuIdSchema = z.enum(TOP_LEVEL_MENUS);
export type TopLevelMenuId = z.infer<typeof topLevelMenuIdSchema>;

export const topLevelMenuSchema = z
  .object({
    id: topLevelMenuIdSchema,
    items: z.array(menuItemSchema).min(1).max(32),
    label: menuLabelSchema,
    /** Electron `appMenu`/`windowMenu` semantics on macOS; absent elsewhere. */
    role: z.enum(["appMenu", "windowMenu"]).optional(),
  })
  .strict();
export type TopLevelMenu = z.infer<typeof topLevelMenuSchema>;

export const applicationMenuSchema = z
  .object({
    locale: localeSchema,
    menus: z
      .array(topLevelMenuSchema)
      .min(1)
      .max(TOP_LEVEL_MENUS.length)
      .superRefine((menus, context) => {
        const topLevel = new Set<string>();
        const items = new Set<string>();
        const accelerators = new Set<string>();
        for (const [index, menu] of menus.entries()) {
          if (topLevel.has(menu.id)) {
            context.addIssue({
              code: "custom",
              message: `Duplicate top-level menu ${menu.id}.`,
              path: [index, "id"],
            });
          }
          topLevel.add(menu.id);
          for (const [itemIndex, item] of menu.items.entries()) {
            if (items.has(item.id)) {
              context.addIssue({
                code: "custom",
                message: `Duplicate menu item ${item.id}.`,
                path: [index, "items", itemIndex, "id"],
              });
            }
            items.add(item.id);
            if (item.kind === "separator") continue;
            if (item.accelerator === undefined) continue;
            if (accelerators.has(item.accelerator)) {
              context.addIssue({
                code: "custom",
                message: `Duplicate accelerator ${item.accelerator}.`,
                path: [index, "items", itemIndex, "accelerator"],
              });
            }
            accelerators.add(item.accelerator);
          }
        }
      }),
    platform: menuPlatformSchema,
    schemaVersion: z.literal(1),
  })
  .strict();
export type ApplicationMenu = z.infer<typeof applicationMenuSchema>;

/** Main → workspace renderer relay of one menu activation. */
export const menuCommandEventSchema = z
  .object({
    command: rendererMenuCommandSchema,
    schemaVersion: z.literal(1),
  })
  .strict();
export type MenuCommandEvent = z.infer<typeof menuCommandEventSchema>;

const menuErrorSchema = z
  .object({
    code: z.enum(["internal_error", "invalid_request", "unauthorized"]),
    message: z.string().trim().min(1).max(256),
    retryable: z.boolean(),
  })
  .strict();

export const applicationMenuResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: applicationMenuSchema }).strict(),
  z.object({ error: menuErrorSchema, ok: z.literal(false) }).strict(),
]);
export type ApplicationMenuResult = z.infer<typeof applicationMenuResultSchema>;

export interface MenuBridge {
  /** The application menu main currently shows, in the resolved locale. */
  getMenu(): Promise<ApplicationMenuResult>;
  subscribeMenuCommand(listener: (event: MenuCommandEvent) => void): () => void;
}

/** Find the command item that drives a renderer control, if the menu has one. */
export function menuCommandItem(
  menu: ApplicationMenu | undefined,
  command: MenuCommand,
) {
  if (menu === undefined) return undefined;
  for (const topLevel of menu.menus) {
    for (const item of topLevel.items) {
      if (item.kind === "command" && item.command === command) return item;
    }
  }
  return undefined;
}
