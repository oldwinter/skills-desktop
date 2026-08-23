import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FolderGit2,
  HardDrive,
  Info,
  LibraryBig,
  ListFilter,
  MonitorCog,
  PackagePlus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Terminal,
  ShieldCheck,
  Square,
  Trash2,
  WifiOff,
} from "lucide-react";

import type { DesktopBridge } from "../../../contracts/desktop.js";
import { isInventoryEntryAvailableToHarness } from "../../../contracts/inventory-availability.js";
import type {
  DesktopEvent,
  PublicInventoryEntry,
  PublicInventoryState,
  RendererError,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";
import { AboutView } from "../about/AboutView.js";
import { ComparisonView } from "../comparison/ComparisonView.js";
import { CollectionsView } from "../collections/CollectionsView.js";
import { TargetsView } from "../targets/TargetsView.js";

type ScopeFilter = "all" | "global" | "project";
type SelectedIdentity = Pick<PublicInventoryEntry, "name" | "scope">;
type WorkspaceView =
  | "about"
  | "collections"
  | "comparison"
  | "inventory"
  | "targets";

function freshnessLabel(
  freshness: WorkspaceSnapshot["inventory"]["freshness"],
) {
  if (freshness === "fresh") return "Fresh evidence";
  if (freshness === "stale") return "Stale evidence";
  return "No evidence";
}

function statusLabel(snapshot: WorkspaceSnapshot) {
  const { freshness, phase } = snapshot.inventory;
  if (phase === "loading") return `Refreshing - ${freshnessLabel(freshness)}`;
  if (phase === "cancelled")
    return `Refresh cancelled - ${freshnessLabel(freshness)}`;
  if (phase === "error" && isTargetOffline(snapshot))
    return `Offline - ${freshnessLabel(freshness)}`;
  if (phase === "error")
    return freshness === "stale" ? "Stale after error" : "Refresh error";
  return freshnessLabel(freshness);
}

function isTargetOffline(snapshot: WorkspaceSnapshot) {
  return (
    snapshot.target.kind === "ssh" &&
    snapshot.inventory.lastError !== null &&
    ["transport_failed", "transport_lost", "transport_unavailable"].includes(
      snapshot.inventory.lastError.code,
    )
  );
}

function statusTone(snapshot: WorkspaceSnapshot) {
  if (snapshot.inventory.phase === "error") return "danger";
  if (
    snapshot.inventory.phase === "cancelled" ||
    snapshot.inventory.freshness === "stale"
  ) {
    return "warning";
  }
  return snapshot.inventory.freshness === "fresh" ? "healthy" : "neutral";
}

function scopeLabel(scope: PublicInventoryEntry["scope"]) {
  return scope === "project" ? "Project" : "Global";
}

function sourceLabel(entry: PublicInventoryEntry) {
  return entry.declaredSource.source ?? "Provenance unavailable";
}

function InventoryStatus({
  snapshot,
}: {
  readonly snapshot: WorkspaceSnapshot;
}) {
  const { inventory } = snapshot;
  if (inventory.phase === "loading") {
    return (
      <div className="state-banner state-banner--loading" role="status">
        <RefreshCw aria-hidden="true" className="spin" size={16} />
        <span>Refreshing project and global inventory</span>
        <strong>
          {inventory.freshness === "none"
            ? "No prior evidence"
            : `${freshnessLabel(inventory.freshness)} retained`}
        </strong>
      </div>
    );
  }
  if (inventory.phase === "error" && inventory.lastError !== null) {
    const offline = isTargetOffline(snapshot);
    return (
      <div className="state-banner state-banner--danger" role="alert">
        {offline ? (
          <WifiOff aria-hidden="true" size={16} />
        ) : (
          <AlertCircle aria-hidden="true" size={16} />
        )}
        <UserFacingErrorCopy error={inventory.lastError} />
        {offline ? (
          <strong>Target offline</strong>
        ) : inventory.freshness === "stale" ? (
          <strong>Last complete evidence retained</strong>
        ) : null}
      </div>
    );
  }
  if (inventory.phase === "cancelled") {
    return (
      <div className="state-banner state-banner--warning" role="status">
        <Square aria-hidden="true" size={15} />
        <span>Refresh cancelled</span>
        <strong>{freshnessLabel(inventory.freshness)}</strong>
      </div>
    );
  }
  if (inventory.freshness === "stale") {
    return (
      <div className="state-banner state-banner--warning" role="status">
        <Clock3 aria-hidden="true" size={16} />
        {inventory.lastError !== null ? (
          <UserFacingErrorCopy error={inventory.lastError} />
        ) : (
          <span>
            Showing stale evidence restored from the last complete observation
          </span>
        )}
      </div>
    );
  }
  if (inventory.persistenceWarning !== null) {
    return (
      <div className="state-banner state-banner--warning" role="status">
        <AlertCircle aria-hidden="true" size={16} />
        <UserFacingErrorCopy error={inventory.persistenceWarning} />
      </div>
    );
  }
  return null;
}

function EmptyInventory({ filtered }: { readonly filtered: boolean }) {
  return (
    <div className="empty-state" role="status">
      <CircleHelp aria-hidden="true" size={22} />
      <h2>{filtered ? "No matching skills" : "No skills found"}</h2>
      <p>
        {filtered
          ? "Change the current search or scope filter."
          : "Project and global inventory are empty. Refresh this Target, or install a skill via npx skills."}
      </p>
    </div>
  );
}

function MissingInventoryEvidence({
  phase,
}: {
  readonly phase: PublicInventoryState["phase"];
}) {
  const copy =
    phase === "loading"
      ? {
          heading: "Waiting for inventory",
          message:
            "A complete project and global observation has not finished yet. Wait for the refresh to complete.",
        }
      : phase === "error"
        ? {
            heading: "Inventory unavailable",
            message:
              "No complete inventory evidence is available for this Target. Refresh this Target to try again.",
          }
        : {
            heading: "No inventory evidence",
            message:
              "No complete inventory evidence yet. Refresh this Target to establish one.",
          };
  return (
    <div className="empty-state" role="status">
      <CircleHelp aria-hidden="true" size={22} />
      <h2>{copy.heading}</h2>
      <p>{copy.message}</p>
    </div>
  );
}

export function InventoryApp({ client }: { readonly client: DesktopBridge }) {
  const [baseSnapshot, setBaseSnapshot] = useState<WorkspaceSnapshot>();
  const [bootstrapError, setBootstrapError] = useState<RendererError>();
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [selectedIdentity, setSelectedIdentity] = useState<SelectedIdentity>();
  const [preparedMutationId, setPreparedMutationId] = useState<string>();
  const [actionError, setActionError] = useState<RendererError>();
  const [addName, setAddName] = useState("");
  const [addSource, setAddSource] = useState("");
  const [addScope, setAddScope] = useState<"global" | "project">("project");
  const [view, setView] = useState<WorkspaceView>("inventory");
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const targetStates =
    baseSnapshot?.targets ??
    (baseSnapshot === undefined
      ? []
      : [
          {
            deletionBlocked: true,
            inventory: baseSnapshot.inventory,
            mutation: baseSnapshot.mutation,
            target: baseSnapshot.target,
          },
        ]);
  const selectedTargetState =
    targetStates.find(({ target }) => target.id === selectedTargetId) ??
    targetStates[0];
  const snapshot =
    baseSnapshot === undefined || selectedTargetState === undefined
      ? baseSnapshot
      : {
          ...baseSnapshot,
          collections:
            selectedTargetState.collections ?? baseSnapshot.collections,
          inventory: selectedTargetState.inventory,
          mutation: selectedTargetState.mutation,
          target: selectedTargetState.target,
        };
  const inventory = snapshot?.inventory;

  useEffect(() => {
    let active = true;
    const resynchronize = async () => {
      const result = await client.getSnapshot();
      if (!result.ok) {
        if (active) setBootstrapError(result.error);
        return undefined;
      }
      const next = result.value;
      if (active) setBootstrapError(undefined);
      if (active)
        setBaseSnapshot((current) =>
          current && current.stateRevision > next.stateRevision
            ? current
            : next,
        );
      return next;
    };
    const receive = (event: DesktopEvent) => {
      if (!active) return;
      if (event.type === "resync.required") {
        void resynchronize();
        return;
      }
      setBaseSnapshot((current) => {
        if (
          current !== undefined &&
          current.sessionEpoch === event.sessionEpoch &&
          event.sequence === current.eventSequence + 1
        ) {
          return event.snapshot;
        }
        void resynchronize();
        return current;
      });
    };
    const unsubscribe = client.subscribe(receive);
    void resynchronize().then((initial) => {
      const initialTarget = initial?.targets?.[0]?.target ?? initial?.target;
      if (active && initialTarget !== undefined) {
        setSelectedTargetId((current) => current ?? initialTarget.id);
      }
      if (
        active &&
        initial !== undefined &&
        initialTarget?.kind === "local" &&
        (initial.targets?.[0]?.inventory.phase ?? initial.inventory.phase) !==
          "loading" &&
        (initial.targets?.[0]?.inventory.freshness ??
          initial.inventory.freshness) !== "fresh"
      ) {
        void client.refreshInventory(initialTarget.id);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bootstrapAttempt, client]);

  const filteredEntries = useMemo(() => {
    if (inventory === undefined) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return inventory.entries.filter((entry) => {
      const matchesScope = scope === "all" || entry.scope === scope;
      const searchable = [
        entry.name,
        entry.declaredSource.source,
        entry.declaredSource.sourceType,
        ...entry.agents,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return (
        matchesScope &&
        (normalizedQuery === "" || searchable.includes(normalizedQuery))
      );
    });
  }, [inventory, query, scope]);

  const selected = useMemo(() => {
    const entries = inventory?.entries ?? [];
    if (selectedIdentity !== undefined) {
      return entries.find(
        (entry) =>
          entry.name === selectedIdentity.name &&
          entry.scope === selectedIdentity.scope,
      );
    }
    return entries[0];
  }, [inventory, selectedIdentity]);

  if (snapshot === undefined) {
    if (bootstrapError !== undefined) {
      return (
        <main className="boot-state boot-state--error" role="alert">
          <AlertCircle aria-hidden="true" size={24} />
          <UserFacingErrorCopy error={bootstrapError} />
          <button
            aria-label="Retry opening inventory"
            className="icon-button"
            onClick={() => setBootstrapAttempt((attempt) => attempt + 1)}
            title="Retry opening inventory"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={17} />
          </button>
        </main>
      );
    }
    return (
      <main className="boot-state" aria-busy="true">
        <Boxes aria-hidden="true" size={24} />
        <span>Opening local inventory</span>
      </main>
    );
  }

  const projectCount = snapshot.inventory.entries.filter(
    ({ scope: entryScope }) => entryScope === "project",
  ).length;
  const globalCount = snapshot.inventory.entries.length - projectCount;
  const isFiltered = query.trim() !== "" || scope !== "all";
  const activeOperationId = snapshot.inventory.activeOperationId;
  const sshUnavailable = snapshot.target.kind === "ssh";
  const mutationBlocked =
    sshUnavailable ||
    snapshot.inventory.freshness !== "fresh" ||
    snapshot.mutation.phase === "reconciliation-required" ||
    snapshot.mutation.phase === "running";
  const mutationBlockedReason = sshUnavailable
    ? "SSH · 未在 V1 开放，无法准备变更"
    : snapshot.inventory.freshness !== "fresh"
      ? "需要先刷新 inventory 证据"
      : snapshot.mutation.phase === "reconciliation-required"
        ? "需要先完成 reconciliation"
        : snapshot.mutation.phase === "running"
          ? "变更进行中，请等待"
          : undefined;
  const mutationBlockedDescribedBy = sshUnavailable
    ? "inventory-ssh-unavailable-reason"
    : mutationBlocked
      ? [
          "inventory-mutation-blocked-reason",
          snapshot.inventory.freshness !== "fresh"
            ? "inventory-refresh-cta"
            : snapshot.mutation.phase === "reconciliation-required"
              ? "inventory-reconcile-cta"
              : undefined,
        ]
          .filter((id): id is string => id !== undefined)
          .join(" ")
      : undefined;
  const showRefreshMutationCta =
    !sshUnavailable && snapshot.inventory.freshness !== "fresh";
  const showReconcileMutationCta =
    !sshUnavailable &&
    snapshot.inventory.freshness === "fresh" &&
    snapshot.mutation.phase === "reconciliation-required";
  const prepareSelected = async (type: "remove" | "update") => {
    if (sshUnavailable || selected === undefined) return;
    const result = await client.prepareMutation(snapshot.target.id, {
      names: [selected.name],
      scope: selected.scope,
      type,
    });
    if (result.ok) {
      setActionError(undefined);
      setPreparedMutationId(result.value.operationId);
    } else setActionError(result.error);
  };
  const prepareUpdateAll = async () => {
    if (sshUnavailable || scope === "all") return;
    const result = await client.prepareMutation(snapshot.target.id, {
      scope,
      type: "update-all",
    });
    if (result.ok) {
      setActionError(undefined);
      setPreparedMutationId(result.value.operationId);
    } else setActionError(result.error);
  };
  const prepareAdd = async () => {
    if (sshUnavailable) return;
    const result = await client.prepareMutation(snapshot.target.id, {
      names: [addName],
      scope: addScope,
      source: { source: addSource, sourceType: "github" },
      type: "add",
    });
    if (result.ok) {
      setActionError(undefined);
      setPreparedMutationId(result.value.operationId);
    } else setActionError(result.error);
  };
  const requestReview = async () => {
    if (preparedMutationId === undefined) return;
    const result = await client.requestReview(preparedMutationId);
    if (result.ok) setActionError(undefined);
    else setActionError(result.error);
  };
  const reconcileMutation = async () => {
    const result = await client.reconcileMutation(snapshot.target.id);
    if (result.ok) setActionError(undefined);
    else setActionError(result.error);
  };
  const requestCancellationReview = async (operationId: string) => {
    const result = await client.requestCancellationReview(operationId);
    if (result.ok) setActionError(undefined);
    else setActionError(result.error);
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Boxes aria-hidden="true" size={17} />
          </span>
          <span>Skills Desktop</span>
        </div>
        <div className="header-target">
          {snapshot.target.kind === "ssh" ? (
            <Server aria-hidden="true" size={15} />
          ) : (
            <HardDrive aria-hidden="true" size={15} />
          )}
          <span>{snapshot.target.label}</span>
          <span aria-hidden="true">/</span>
          <code>{snapshot.target.workspaceLabel}</code>
        </div>
        <div className="header-status">
          <span className={`status-pill status-pill--${statusTone(snapshot)}`}>
            {snapshot.inventory.freshness === "fresh" ? (
              <CheckCircle2 aria-hidden="true" size={14} />
            ) : (
              <Clock3 aria-hidden="true" size={14} />
            )}
            {statusLabel(snapshot)}
          </span>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="scope-rail" aria-label="Workspace navigation">
          <nav className="primary-nav" aria-label="Primary">
            <button
              aria-current={view === "inventory" ? "page" : undefined}
              aria-label="Inventory"
              className={`nav-item${view === "inventory" ? " nav-item--active" : ""}`}
              onClick={() => setView("inventory")}
              title="Inventory"
              type="button"
            >
              <ListFilter aria-hidden="true" size={17} />
              <span>Inventory</span>
            </button>
            <button
              aria-current={view === "comparison" ? "page" : undefined}
              aria-label="Comparison"
              className={`nav-item${view === "comparison" ? " nav-item--active" : ""}`}
              onClick={() => setView("comparison")}
              title="Comparison"
              type="button"
            >
              <MonitorCog aria-hidden="true" size={17} />
              <span>Comparison</span>
            </button>
            <button
              aria-current={view === "collections" ? "page" : undefined}
              aria-label="Collections"
              className={`nav-item${view === "collections" ? " nav-item--active" : ""}`}
              onClick={() => setView("collections")}
              title="Collections"
              type="button"
            >
              <LibraryBig aria-hidden="true" size={17} />
              <span>Collections</span>
            </button>
            <button
              aria-current={view === "targets" ? "page" : undefined}
              aria-label="Targets"
              className={`nav-item${view === "targets" ? " nav-item--active" : ""}`}
              onClick={() => setView("targets")}
              title="Targets"
              type="button"
            >
              <Settings2 aria-hidden="true" size={17} />
              <span>Targets</span>
            </button>
            <button
              aria-current={view === "about" ? "page" : undefined}
              aria-label="About"
              className={`nav-item${view === "about" ? " nav-item--active" : ""}`}
              onClick={() => setView("about")}
              title="About"
              type="button"
            >
              <Info aria-hidden="true" size={17} />
              <span>About</span>
            </button>
          </nav>

          <section className="target-section" aria-labelledby="target-heading">
            <h2 id="target-heading">Targets</h2>
            {targetStates.map((state) => (
              <button
                className={`target-row${state.target.id === snapshot.target.id ? " target-row--active" : ""}`}
                key={state.target.id}
                onClick={() => {
                  setSelectedTargetId(state.target.id);
                  setView("inventory");
                }}
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
                <dd>{snapshot.target.harness}</dd>
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
            <span>skills {snapshot.inventory.cliVersion ?? "1.5.23"}</span>
          </div>
        </aside>

        {view === "inventory" ? (
          <>
            <main
              className="inventory-workspace"
              aria-busy={snapshot.inventory.phase === "loading"}
            >
              <section className="page-heading">
                <div>
                  <h1>Inventory</h1>
                  <p>
                    {snapshot.inventory.entries.length} skills across project
                    and global scopes
                  </p>
                  {targetStates.length > 1 ? (
                    <label className="inventory-target-chooser">
                      Target
                      <select
                        onChange={(event) => {
                          setSelectedTargetId(event.currentTarget.value);
                          setView("inventory");
                        }}
                        value={snapshot.target.id}
                      >
                        {targetStates.map((state) => (
                          <option key={state.target.id} value={state.target.id}>
                            {state.target.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p
                      aria-label="Target summary"
                      className="mobile-target-summary"
                    >
                      {snapshot.target.kind === "ssh" ? (
                        <Server aria-hidden="true" size={14} />
                      ) : (
                        <HardDrive aria-hidden="true" size={14} />
                      )}
                      {snapshot.target.label} / {snapshot.target.workspaceLabel}{" "}
                      / {snapshot.target.harness}
                    </p>
                  )}
                </div>
                {snapshot.inventory.phase === "loading" &&
                activeOperationId !== null ? (
                  <button
                    aria-label="Cancel refresh"
                    className="icon-button"
                    onClick={() =>
                      void client.cancelInventory(activeOperationId)
                    }
                    title="Cancel refresh"
                    type="button"
                  >
                    <Square aria-hidden="true" size={16} />
                  </button>
                ) : (
                  <button
                    aria-label="Refresh inventory"
                    className="icon-button"
                    onClick={() =>
                      void client.refreshInventory(snapshot.target.id)
                    }
                    title="Refresh inventory"
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" size={17} />
                  </button>
                )}
              </section>

              <InventoryStatus snapshot={snapshot} />
              {sshUnavailable ? (
                <div
                  className="state-banner state-banner--warning"
                  id="inventory-ssh-unavailable-reason"
                  role="status"
                >
                  <Server aria-hidden="true" size={16} />
                  <span>
                    SSH · 未在 V1 开放。远程 Target 仅保留只读痕迹，不能作为变更工作区。
                  </span>
                  <strong>未开放</strong>
                </div>
              ) : null}
              {mutationBlockedReason && !sshUnavailable ? (
                <div
                  className="state-banner state-banner--warning"
                  id="inventory-mutation-blocked-reason"
                  role="status"
                >
                  <CircleHelp aria-hidden="true" size={16} />
                  <span>{mutationBlockedReason}</span>
                  {showRefreshMutationCta ? (
                    <button
                      className="text-button text-button--primary"
                      id="inventory-refresh-cta"
                      onClick={() =>
                        void client.refreshInventory(snapshot.target.id)
                      }
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      Refresh
                    </button>
                  ) : null}
                  {showReconcileMutationCta ? (
                    <button
                      className="text-button text-button--primary"
                      id="inventory-reconcile-cta"
                      onClick={() => void reconcileMutation()}
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      Reconcile
                    </button>
                  ) : null}
                </div>
              ) : null}
              {snapshot.inventory.lastError?.code === "host_trust_required" ||
              snapshot.inventory.lastError?.code === "host_key_changed" ? (
                <div
                  className="state-banner state-banner--warning"
                  role="status"
                >
                  <ShieldCheck aria-hidden="true" size={16} />
                  <span>
                    主机身份复核 · 未在 V1 开放。当前版本不能启动该复核。
                  </span>
                </div>
              ) : null}
              {snapshot.mutation.phase === "reconciliation-required" ? (
                <div className="state-banner state-banner--danger" role="alert">
                  <AlertCircle aria-hidden="true" size={16} />
                  {snapshot.mutation.lastError !== null ? (
                    <UserFacingErrorCopy error={snapshot.mutation.lastError} />
                  ) : (
                    <span>This Target requires reconciliation.</span>
                  )}
                  {showReconcileMutationCta ? null : (
                    <button
                      className="text-button text-button--primary"
                      onClick={() => void reconcileMutation()}
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      Reconcile
                    </button>
                  )}
                </div>
              ) : snapshot.mutation.phase === "running" ? (
                <div
                  className="state-banner state-banner--loading"
                  role="status"
                >
                  <RefreshCw aria-hidden="true" className="spin" size={16} />
                  <span>Applying confirmed mutation</span>
                  {snapshot.mutation.activeOperationId !== null ? (
                    <button
                      className="text-button"
                      onClick={() =>
                        void requestCancellationReview(
                          snapshot.mutation.activeOperationId!,
                        )
                      }
                      type="button"
                    >
                      <ShieldCheck aria-hidden="true" size={15} />
                      Review cancellation
                    </button>
                  ) : null}
                </div>
              ) : snapshot.mutation.lastError !== null ? (
                <div className="state-banner state-banner--danger" role="alert">
                  <AlertCircle aria-hidden="true" size={16} />
                  <UserFacingErrorCopy error={snapshot.mutation.lastError} />
                </div>
              ) : null}
              {actionError !== undefined ? (
                <div className="state-banner state-banner--danger" role="alert">
                  <AlertCircle aria-hidden="true" size={16} />
                  <UserFacingErrorCopy error={actionError} />
                </div>
              ) : null}

              <div className="inventory-toolbar">
                <label className="search-control">
                  <Search aria-hidden="true" size={16} />
                  <span className="sr-only">Search inventory</span>
                  <input
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="Search skills or sources"
                    type="search"
                    value={query}
                  />
                </label>
                <div
                  className="segmented-control"
                  aria-label="Inventory scope"
                  role="group"
                >
                  {(["all", "project", "global"] as const).map((value) => (
                    <button
                      aria-pressed={scope === value}
                      key={value}
                      onClick={() => setScope(value)}
                      type="button"
                    >
                      {value === "all"
                        ? "All scopes"
                        : `${scopeLabel(value)} scope`}
                    </button>
                  ))}
                </div>
                <button
                  aria-describedby={
                    scope === "all" ? undefined : mutationBlockedDescribedBy
                  }
                  className="text-button"
                  disabled={scope === "all" || mutationBlocked}
                  onClick={() => void prepareUpdateAll()}
                  title={
                    scope === "all"
                      ? "Choose project or global scope first"
                      : mutationBlockedReason
                  }
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={15} />
                  Update scope
                </button>
              </div>

              <div className="inventory-table-wrap">
                {filteredEntries.length === 0 ? (
                  snapshot.inventory.freshness === "none" ? (
                    <MissingInventoryEvidence
                      phase={snapshot.inventory.phase}
                    />
                  ) : (
                    <EmptyInventory filtered={isFiltered} />
                  )
                ) : (
                  <table className="inventory-table">
                    <caption className="sr-only">
                      Skills observed on the selected Local Target
                    </caption>
                    <thead>
                      <tr>
                        <th>Skill</th>
                        <th>Scope</th>
                        <th>Harness</th>
                        <th>Declared source</th>
                        <th>Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map((entry) => {
                        const selectedRow =
                          selected?.name === entry.name &&
                          selected.scope === entry.scope;
                        return (
                          <tr
                            className={selectedRow ? "is-selected" : undefined}
                            key={`${entry.scope}:${entry.name}`}
                          >
                            <td data-label="Skill">
                              <button
                                className="skill-button"
                                onClick={() =>
                                  setSelectedIdentity({
                                    name: entry.name,
                                    scope: entry.scope,
                                  })
                                }
                                type="button"
                              >
                                <FolderGit2 aria-hidden="true" size={16} />
                                <span>{entry.name}</span>
                              </button>
                            </td>
                            <td data-label="Scope">
                              <span className="scope-badge">
                                {scopeLabel(entry.scope)}
                              </span>
                            </td>
                            <td data-label="Harness">
                              {isInventoryEntryAvailableToHarness(
                                entry,
                                snapshot.target.harness,
                              )
                                ? snapshot.target.harness
                                : "Not linked"}
                            </td>
                            <td data-label="Declared source">
                              <code className="wrapping-value">
                                {sourceLabel(entry)}
                              </code>
                            </td>
                            <td data-label="Evidence">
                              {entry.revision.status === "known" ? (
                                <code className="wrapping-value">
                                  {entry.revision.value}
                                </code>
                              ) : (
                                <span className="unknown-label">
                                  <CircleHelp aria-hidden="true" size={14} />
                                  Unknown revision
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </main>

            <aside className="inspector" aria-label="Selected skill evidence">
              {selected === undefined ? (
                <div className="inspector-empty">
                  <CircleHelp aria-hidden="true" size={22} />
                  {(inventory?.entries.length ?? 0) === 0 ? (
                    <>
                      <h2>No skills to inspect</h2>
                      <p>
                        Refresh this Target, or install a skill via npx skills.
                      </p>
                    </>
                  ) : (
                    <>
                      <h2>No skill selected</h2>
                      <p>Select a skill in the table to inspect evidence.</p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <header className="inspector-heading">
                    <FolderGit2 aria-hidden="true" size={18} />
                    <div>
                      <p>Skill evidence</p>
                      <h2>{selected.name}</h2>
                    </div>
                  </header>
                  <dl className="evidence-list">
                    <div>
                      <dt>Scope</dt>
                      <dd>{scopeLabel(selected.scope)}</dd>
                    </div>
                    <div>
                      <dt>Harness</dt>
                      <dd>{selected.agents.join(", ") || "None reported"}</dd>
                    </div>
                    <div>
                      <dt>Source type</dt>
                      <dd>{selected.declaredSource.sourceType ?? "Unknown"}</dd>
                    </div>
                    <div>
                      <dt>Declared source</dt>
                      <dd>
                        <code className="wrapping-value">
                          {sourceLabel(selected)}
                        </code>
                      </dd>
                    </div>
                    <div>
                      <dt>Revision</dt>
                      <dd>
                        {selected.revision.status === "known" ? (
                          <code className="wrapping-value">
                            {selected.revision.kind} / {selected.revision.value}
                          </code>
                        ) : (
                          <span className="unknown-label">
                            <CircleHelp aria-hidden="true" size={14} />
                            Revision unknown
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Content fingerprint</dt>
                      <dd>
                        {selected.contentFingerprint.status === "known" ? (
                          <code className="wrapping-value">
                            {selected.contentFingerprint.kind} /{" "}
                            {selected.contentFingerprint.value}
                          </code>
                        ) : (
                          <span className="unknown-label">
                            <CircleHelp aria-hidden="true" size={14} />
                            Unknown
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="inspector-actions">
                    <button
                      aria-describedby={mutationBlockedDescribedBy}
                      className="text-button"
                      disabled={mutationBlocked}
                      onClick={() => void prepareSelected("update")}
                      title={mutationBlockedReason}
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      Prepare update
                    </button>
                    <button
                      aria-describedby={mutationBlockedDescribedBy}
                      className="text-button text-button--danger"
                      disabled={mutationBlocked}
                      onClick={() => void prepareSelected("remove")}
                      title={mutationBlockedReason}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                      Prepare removal
                    </button>
                  </div>
                </>
              )}

              <form
                className="add-skill-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void prepareAdd();
                }}
              >
                <h2>Add Skill</h2>
                <label>
                  <span>GitHub source</span>
                  <input
                    onChange={(event) =>
                      setAddSource(event.currentTarget.value)
                    }
                    placeholder="owner/repository"
                    required
                    value={addSource}
                  />
                </label>
                <label>
                  <span>Exact skill name</span>
                  <input
                    onChange={(event) => setAddName(event.currentTarget.value)}
                    required
                    value={addName}
                  />
                </label>
                <div
                  className="segmented-control segmented-control--compact"
                  aria-label="Add scope"
                  role="group"
                >
                  {(["project", "global"] as const).map((value) => (
                    <button
                      aria-pressed={addScope === value}
                      key={value}
                      onClick={() => setAddScope(value)}
                      type="button"
                    >
                      {scopeLabel(value)} scope
                    </button>
                  ))}
                </div>
                <button
                  aria-describedby={mutationBlockedDescribedBy}
                  className="text-button"
                  disabled={mutationBlocked}
                  title={mutationBlockedReason}
                  type="submit"
                >
                  <PackagePlus aria-hidden="true" size={15} />
                  Prepare add
                </button>
              </form>

              {snapshot.mutation.commandPlan !== null ? (
                <section
                  className="command-plan"
                  aria-labelledby="command-plan-heading"
                >
                  <header>
                    <ShieldCheck aria-hidden="true" size={17} />
                    <h2 id="command-plan-heading">Command Plan</h2>
                  </header>
                  <dl>
                    <div>
                      <dt>Operation</dt>
                      <dd>{snapshot.mutation.commandPlan.operation}</dd>
                    </div>
                    <div>
                      <dt>Scope</dt>
                      <dd>{scopeLabel(snapshot.mutation.commandPlan.scope)}</dd>
                    </div>
                    <div>
                      <dt>Skills</dt>
                      <dd>{snapshot.mutation.commandPlan.names.join(", ")}</dd>
                    </div>
                  </dl>
                  <code className="command-preview wrapping-value">
                    {snapshot.mutation.commandPlan.preview}
                  </code>
                  {snapshot.mutation.outcome === null ? (
                    <button
                      className="text-button text-button--primary"
                      disabled={
                        preparedMutationId === undefined ||
                        snapshot.mutation.phase !== "planned"
                      }
                      onClick={() => void requestReview()}
                      type="button"
                    >
                      <ShieldCheck aria-hidden="true" size={15} />
                      Open Trusted Review
                    </button>
                  ) : (
                    <p className="mutation-outcome" role="status">
                      {snapshot.mutation.outcome.process.disposition} /{" "}
                      {snapshot.mutation.outcome.effects.status}
                    </p>
                  )}
                </section>
              ) : null}
            </aside>
          </>
        ) : view === "comparison" ? (
          <ComparisonView
            client={client}
            onPrepared={(preparedId, destinationTargetId) => {
              setPreparedMutationId(preparedId);
              setSelectedTargetId(destinationTargetId);
              setView("inventory");
            }}
            snapshot={snapshot}
            targets={targetStates}
          />
        ) : view === "collections" ? (
          <CollectionsView client={client} snapshot={snapshot} />
        ) : view === "about" ? (
          <AboutView client={client.about} />
        ) : (
          <TargetsView
            client={client}
            onSelected={setSelectedTargetId}
            targets={targetStates}
          />
        )}
      </div>
    </div>
  );
}