import {
  HardDrive,
  Info,
  LibraryBig,
  LifeBuoy,
  ListFilter,
  MonitorCog,
  Server,
  Settings2,
  Terminal,
  type LucideIcon,
} from "lucide-react";

import type { MessageKey } from "../../../contracts/i18n/translate.js";
import {
  menuCommandItem,
  type ApplicationMenu,
} from "../../../contracts/menu.js";
import type {
  PublicInventoryState,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { useTranslator } from "../../i18n/LocaleProvider.js";

export type WorkspaceView =
  | "about"
  | "collections"
  | "comparison"
  | "inventory"
  | "recovery"
  | "targets";

type TargetState = NonNullable<WorkspaceSnapshot["targets"]>[number];

const navigationItems: readonly {
  readonly view: WorkspaceView;
  readonly label: MessageKey;
  readonly icon: LucideIcon;
}[] = [
  { view: "inventory", label: "nav.inventory", icon: ListFilter },
  { view: "comparison", label: "nav.comparison", icon: MonitorCog },
  { view: "collections", label: "nav.collections", icon: LibraryBig },
  { view: "targets", label: "nav.targets", icon: Settings2 },
  { view: "recovery", label: "nav.recovery", icon: LifeBuoy },
  { view: "about", label: "nav.about", icon: Info },
];

export function WorkspaceNavigation({
  applicationMenu,
  inventory,
  onSelectTarget,
  onViewChange,
  recoveryCount = 0,
  target,
  targetStates,
  view,
}: {
  /** Main-owned menu; its accelerators are mirrored as `aria-keyshortcuts`. */
  readonly applicationMenu?: ApplicationMenu;
  readonly inventory: PublicInventoryState;
  readonly onSelectTarget: (targetId: string) => void;
  readonly onViewChange: (view: WorkspaceView) => void;
  readonly recoveryCount?: number;
  readonly target: WorkspaceSnapshot["target"];
  readonly targetStates: readonly TargetState[];
  readonly view: WorkspaceView;
}) {
  const { t, tc } = useTranslator();
  const projectCount = inventory.entries.filter(
    ({ scope }) => scope === "project",
  ).length;
  const globalCount = inventory.entries.length - projectCount;

  return (
    <aside className="scope-rail" aria-label={t("nav.workspaceNavigation")}>
      <nav className="primary-nav" aria-label={t("nav.primary")}>
        {navigationItems.map(({ icon: Icon, label: labelKey, view: itemView }) => {
          const label = t(labelKey);
          const pending = itemView === "recovery" ? recoveryCount : 0;
          const accessibleLabel =
            pending > 0 ? tc("nav.pending", pending, { label }) : label;
          return (
            <button
              aria-current={view === itemView ? "page" : undefined}
              aria-keyshortcuts={
                menuCommandItem(applicationMenu, `navigate.${itemView}`)
                  ?.ariaKeyShortcuts
              }
              aria-label={accessibleLabel}
              className={`nav-item${view === itemView ? " nav-item--active" : ""}`}
              data-nav-view={itemView}
              key={itemView}
              onClick={() => onViewChange(itemView)}
              title={accessibleLabel}
              type="button"
            >
              <Icon aria-hidden="true" size={17} />
              <span>{label}</span>
              {pending > 0 ? (
                <span aria-hidden="true" className="nav-count">
                  {pending}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <section className="target-section" aria-labelledby="target-heading">
        <h2 id="target-heading">{t("common.targets")}</h2>
        {targetStates.map((state) => (
          <button
            className={`target-row${state.target.id === target.id ? " target-row--active" : ""}`}
            key={state.target.id}
            onClick={() => onSelectTarget(state.target.id)}
            type="button"
          >
            {state.target.kind === "local" ? (
              <HardDrive aria-hidden="true" size={16} />
            ) : (
              <Server aria-hidden="true" size={16} />
            )}
            <span>
              <strong>{state.target.label}</strong>
              <small>{state.target.workspaceLabel}</small>
            </span>
            {state.target.kind === "ssh" ? (
              <span
                aria-label={t("common.ssh.badgeLabel")}
                className="scope-badge"
                title={t("common.ssh.notInV1")}
              >
                {t("common.ssh.badge")}
              </span>
            ) : null}
          </button>
        ))}
        <dl className="target-facts">
          <div>
            <dt>{t("common.harness")}</dt>
            <dd>{target.harnessIds.join(", ")}</dd>
          </div>
          <div>
            <dt>{t("common.scope.project")}</dt>
            <dd>{projectCount}</dd>
          </div>
          <div>
            <dt>{t("common.scope.global")}</dt>
            <dd>{globalCount}</dd>
          </div>
        </dl>
      </section>
      <div className="rail-version">
        <Terminal aria-hidden="true" size={14} />
        <span>
          {t("nav.cliVersion", { version: inventory.cliVersion ?? "1.5.23" })}
        </span>
      </div>
    </aside>
  );
}
