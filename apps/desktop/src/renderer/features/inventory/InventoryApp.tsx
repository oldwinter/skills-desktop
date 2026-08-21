import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FolderGit2,
  HardDrive,
  LibraryBig,
  ListFilter,
  MonitorCog,
  PackagePlus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  WifiOff,
} from "lucide-react";

import type {
  DesktopEvent,
  PublicInventoryEntry,
  PublicInventoryState,
  RendererError,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { ComparisonView } from "../comparison/ComparisonView.js";
import { TargetsView } from "../targets/TargetsView.js";

type ScopeFilter = "all" | "global" | "project";
type SelectedIdentity = Pick<PublicInventoryEntry, "name" | "scope">;
type WorkspaceView = "comparison" | "inventory" | "targets";

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
        <span>{inventory.lastError.message}</span>
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
        <span>
          {inventory.lastError?.message ??
            "Showing stale evidence restored from the last complete observation"}
        </span>
      </div>
    );
  }
  if (inventory.persistenceWarning !== null) {
    return (
      <div className="state-banner state-banner--warning" role="status">
        <AlertCircle aria-hidden="true" size={16} />
        <span>{inventory.persistenceWarning.message}</span>
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
          : "Project and global inventory are empty."}
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
            "A complete project and global observation has not finished yet.",
        }
      : phase === "error"
        ? {
            heading: "Inventory unavailable",
            message:
              "No complete inventory evidence is available for this Target.",
          }
        : {
            heading: "No inventory evidence",
            message: "Refresh this Target to establish a complete inventory.",
          };
  return (
    <div className="empty-state" role="status">
      <CircleHelp aria-hidden="true" size={22} />
      <h2>{copy.heading}</h2>
      <p>{copy.message}</p>
    </div>
  );
}

export function InventoryApp({ client }: { readonly client: WorkspaceBridge }) {
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
          inventory: selectedTargetState.inventory,
          mutation: selectedTargetState.mutation,
          target: selectedTargetState.target,
        };

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
    if (snapshot === undefined) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return snapshot.inventory.entries.filter((entry) => {
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
  }, [query, scope, snapshot]);

  const selected = useMemo(() => {
    const entries = snapshot?.inventory.entries ?? [];
    return (
      entries.find(
        (entry) =>
          entry.name === selectedIdentity?.name &&
          entry.scope === selectedIdentity.scope,
      ) ?? entries[0]
    );
  }, [selectedIdentity, snapshot]);

  if (snapshot === undefined) {
    if (bootstrapError !== undefined) {
      return (
        <main className="boot-state boot-state--error" role="alert">
          <AlertCircle aria-hidden="true" size={24} />
          <span>{bootstrapError.message}</span>
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
  const mutationBlocked =
    snapshot.inventory.freshness !== "fresh" ||
    snapshot.mutation.phase === "reconciliation-required" ||
    snapshot.mutation.phase === "running";
  const prepareSelected = async (type: "remove" | "update") => {
    if (selected === undefined) return;
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
    if (scope === "all") return;
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
  const requestHostTrustReview = async () => {
    const result = await client.requestHostTrustReview(snapshot.target.id);
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
              aria-label="Collections"
              className="nav-item"
              disabled
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
            <Server aria-hidden="true" size={14} />
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
                  <p
                    aria-label="Target summary"
                    className="mobile-target-summary"
                  >
                    {snapshot.target.kind === "ssh" ? (
                      <Server aria-hidden="true" size={14} />
                    ) : (
                      <HardDrive aria-hidden="true" size={14} />
                    )}
                    {snapshot.target.label} / {snapshot.target.workspaceLabel} /{" "}
                    {snapshot.target.harness}
                  </p>
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
              {snapshot.inventory.lastError?.code === "host_trust_required" ||
              snapshot.inventory.lastError?.code === "host_key_changed" ? (
                <div
                  className="state-banner state-banner--warning"
                  role="status"
                >
                  <ShieldCheck aria-hidden="true" size={16} />
                  <span>Host identity review required</span>
                  <button
                    className="text-button"
                    onClick={() => void requestHostTrustReview()}
                    type="button"
                  >
                    <ShieldCheck aria-hidden="true" size={15} />
                    Review host identity
                  </button>
                </div>
              ) : null}
              {snapshot.mutation.phase === "reconciliation-required" ? (
                <div className="state-banner state-banner--danger" role="alert">
                  <AlertCircle aria-hidden="true" size={16} />
                  <span>
                    {snapshot.mutation.lastError?.message ??
                      "This Target requires reconciliation."}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => void reconcileMutation()}
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" size={15} />
                    Reconcile
                  </button>
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
                  <span>{snapshot.mutation.lastError.message}</span>
                </div>
              ) : null}
              {actionError !== undefined ? (
                <div className="state-banner state-banner--danger" role="alert">
                  <AlertCircle aria-hidden="true" size={16} />
                  <span>{actionError.message}</span>
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
                <div className="segmented-control" aria-label="Inventory scope">
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
                  className="text-button"
                  disabled={scope === "all" || mutationBlocked}
                  onClick={() => void prepareUpdateAll()}
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
                              {entry.agents.includes(snapshot.target.harness)
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
                  <h2>No skill selected</h2>
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
                      className="text-button"
                      disabled={mutationBlocked}
                      onClick={() => void prepareSelected("update")}
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      Prepare update
                    </button>
                    <button
                      className="text-button text-button--danger"
                      disabled={mutationBlocked}
                      onClick={() => void prepareSelected("remove")}
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
                  className="text-button"
                  disabled={mutationBlocked}
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
