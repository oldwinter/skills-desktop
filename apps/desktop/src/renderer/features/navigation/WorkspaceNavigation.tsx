import {
  HardDrive,
  Info,
  LibraryBig,
  ListFilter,
  MonitorCog,
  Server,
  Settings2,
  Terminal,
  type LucideIcon,
} from "lucide-react";

import type {
  PublicInventoryState,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";

export type WorkspaceView =
  | "about"
  | "collections"
  | "comparison"
  | "inventory"
  | "targets";

type TargetState = NonNullable<WorkspaceSnapshot["targets"]>[number];

const navigationItems: readonly {
  readonly view: WorkspaceView;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { view: "inventory", label: "Inventory", icon: ListFilter },
  { view: "comparison", label: "Comparison", icon: MonitorCog },
  { view: "collections", label: "Collections", icon: LibraryBig },
  { view: "targets", label: "Targets", icon: Settings2 },
  { view: "about", label: "About", icon: Info },
];

export function WorkspaceNavigation({
  inventory,
  onSelectTarget,
  onViewChange,
  target,
  targetStates,
  view,
}: {
  readonly inventory: PublicInventoryState;
  readonly onSelectTarget: (targetId: string) => void;
  readonly onViewChange: (view: WorkspaceView) => void;
  readonly target: WorkspaceSnapshot["target"];
  readonly targetStates: readonly TargetState[];
  readonly view: WorkspaceView;
}) {
  const projectCount = inventory.entries.filter(
    ({ scope }) => scope === "project",
  ).length;
  const globalCount = inventory.entries.length - projectCount;

  return (
    <aside className="scope-rail" aria-label="Workspace navigation">
      <nav className="primary-nav" aria-label="Primary">
        {navigationItems.map(({ icon: Icon, label, view: itemView }) => (
          <button
            aria-current={view === itemView ? "page" : undefined}
            aria-label={label}
            className={`nav-item${view === itemView ? " nav-item--active" : ""}`}
            key={itemView}
            onClick={() => onViewChange(itemView)}
            title={label}
            type="button"
          >
            <Icon aria-hidden="true" size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <section className="target-section" aria-labelledby="target-heading">
        <h2 id="target-heading">Targets</h2>
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
                aria-label="SSH 未开放"
                className="scope-badge"
                title="SSH · 未在 V1 开放"
              >
                未开放
              </span>
            ) : null}
          </button>
        ))}
        <dl className="target-facts">
          <div>
            <dt>Harness</dt>
            <dd>{target.harnessIds.join(", ")}</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{projectCount}</dd>
          </div>
          <div>
            <dt>Global</dt>
            <dd>{globalCount}</dd>
          </div>
        </dl>
      </section>
      <div className="rail-version">
        <Terminal aria-hidden="true" size={14} />
        <span>skills {inventory.cliVersion ?? "1.5.23"}</span>
      </div>
    </aside>
  );
}
