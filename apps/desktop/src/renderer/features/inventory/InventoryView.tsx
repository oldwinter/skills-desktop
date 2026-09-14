import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CircleHelp,
  Clock3,
  FolderGit2,
  HardDrive,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Square,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";

import type { DesktopBridge } from "../../../contracts/desktop.js";
import { isInventoryEntryAvailableToHarness } from "../../../contracts/inventory-availability.js";
import { GITHUB_SOURCE_OWNER_REPOSITORY_COPY } from "../../../contracts/user-facing-error.js";
import {
  isGithubOwnerRepository,
  type PublicInventoryEntry,
  type PublicInventoryState,
  type RendererError,
  type WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";
import {
  isSshNotInV1,
  prepareBlockedDescribedBy,
  prepareBlockedReasonCopy,
} from "../workspace/prepare-eligibility-copy.js";
import type { WorkspaceTargetState } from "../workspace/useWorkspaceSession.js";
import type { useReviewFocusRestore } from "../workspace/useReviewFocusRestore.js";
import {
  freshnessLabel,
  isTargetOffline,
  scopeLabel,
  sourceLabel,
  targetOptionLabel,
} from "./inventory-state.js";

type ScopeFilter = "all" | "global" | "project";
type SelectedIdentity = Pick<PublicInventoryEntry, "name" | "scope">;
type ReviewFocus = ReturnType<typeof useReviewFocusRestore>;

function inventorySubtitle(count: number, filtered: boolean): string {
  const noun = count === 1 ? "skill" : "skills";
  return filtered
    ? `${count} matching ${noun}`
    : `${count} ${noun} across project and global scopes`;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement)
  );
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

function EmptyInventory({
  filtered,
  onClearFilters,
}: {
  readonly filtered: boolean;
  readonly onClearFilters: () => void;
}) {
  return (
    <div className="empty-state" role="status">
      <CircleHelp aria-hidden="true" size={22} />
      <h2>{filtered ? "No matching skills" : "No skills found"}</h2>
      <p>
        {filtered
          ? "Change the current search or scope filter."
          : "Project and global inventory are empty. Refresh this Target, or install a skill via npx skills."}
      </p>
      {filtered ? (
        <button
          className="text-button"
          onClick={onClearFilters}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={15} />
          Clear filters
        </button>
      ) : null}
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

export function InventoryView({
  client,
  onPreparedMutation,
  onSelectTarget,
  preparedMutationContext,
  reviewFocus,
  snapshot,
  targetStates,
}: {
  readonly client: DesktopBridge;
  readonly onPreparedMutation: (context: {
    readonly generation: number;
    readonly operationId: string;
    readonly targetId: string;
  }) => void;
  readonly onSelectTarget: (targetId: string) => void;
  readonly preparedMutationContext:
    | {
        readonly generation: number;
        readonly operationId: string;
        readonly targetId: string;
      }
    | undefined;
  readonly reviewFocus: ReviewFocus;
  readonly snapshot: WorkspaceSnapshot;
  readonly targetStates: readonly WorkspaceTargetState[];
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [selectedIdentity, setSelectedIdentity] = useState<SelectedIdentity>();
  const [actionError, setActionError] = useState<RendererError>();
  const [addName, setAddName] = useState("");
  const [addSource, setAddSource] = useState("");
  const [addSourceError, setAddSourceError] = useState<string>();
  const [addScope, setAddScope] = useState<"global" | "project">("project");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const inventory = snapshot.inventory;
  const preparedMutationId = preparedMutationContext?.operationId;
  const eligibility = snapshot.prepareEligibility;
  const mutationBlocked = !eligibility.allowed;
  const sshUnavailable = isSshNotInV1(eligibility);
  const mutationBlockedReason = prepareBlockedReasonCopy(eligibility);
  const mutationBlockedDescribedBy = prepareBlockedDescribedBy(eligibility);
  const showRefreshMutationCta = eligibility.nextAction === "refresh";
  const showReconcileMutationCta = eligibility.nextAction === "reconcile";

  useEffect(() => {
    const focusInventorySearch = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== "/" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isTextEditingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", focusInventorySearch);
    return () => window.removeEventListener("keydown", focusInventorySearch);
  }, []);

  const filteredEntries = useMemo(() => {
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

  const clearInventoryFilters = () => {
    setQuery("");
    setScope("all");
    searchInputRef.current?.focus();
  };

  const selected = useMemo(() => {
    if (selectedIdentity !== undefined) {
      return filteredEntries.find(
        (entry) =>
          entry.name === selectedIdentity.name &&
          entry.scope === selectedIdentity.scope,
      );
    }
    return filteredEntries[0];
  }, [filteredEntries, selectedIdentity]);

  const isFiltered = query.trim() !== "" || scope !== "all";
  const activeOperationId = snapshot.inventory.activeOperationId;

  const prepareSelected = async (type: "remove" | "update") => {
    if (mutationBlocked || selected === undefined) return;
    const result = await client.prepareMutation(snapshot.target.id, {
      names: [selected.name],
      scope: selected.scope,
      type,
    });
    if (result.ok) {
      setActionError(undefined);
      reviewFocus.cancel();
      onPreparedMutation({
        generation: snapshot.target.generation,
        operationId: result.value.operationId,
        targetId: snapshot.target.id,
      });
    } else setActionError(result.error);
  };
  const prepareUpdateAll = async () => {
    if (mutationBlocked || scope === "all") return;
    const result = await client.prepareMutation(snapshot.target.id, {
      scope,
      type: "update-all",
    });
    if (result.ok) {
      setActionError(undefined);
      reviewFocus.cancel();
      onPreparedMutation({
        generation: snapshot.target.generation,
        operationId: result.value.operationId,
        targetId: snapshot.target.id,
      });
    } else setActionError(result.error);
  };
  const prepareAdd = async () => {
    if (mutationBlocked) return;
    const source = addSource.trim();
    if (!isGithubOwnerRepository(source)) {
      setAddSourceError(GITHUB_SOURCE_OWNER_REPOSITORY_COPY);
      setActionError(undefined);
      return;
    }
    setAddSourceError(undefined);
    const result = await client.prepareMutation(snapshot.target.id, {
      names: [addName],
      scope: addScope,
      source: { source, sourceType: "github" },
      type: "add",
    });
    if (result.ok) {
      setActionError(undefined);
      reviewFocus.cancel();
      onPreparedMutation({
        generation: snapshot.target.generation,
        operationId: result.value.operationId,
        targetId: snapshot.target.id,
      });
    } else setActionError(result.error);
  };
  const requestReview = async (returnFocus: HTMLButtonElement) => {
    if (
      preparedMutationContext === undefined ||
      preparedMutationContext.targetId !== snapshot.target.id ||
      preparedMutationContext.generation !== snapshot.target.generation
    ) {
      return;
    }
    reviewFocus.cancel();
    reviewFocus.setReturnFocus(returnFocus);
    const intent = reviewFocus.startIntent();
    const result = await client.requestReview(preparedMutationContext.operationId);
    if (reviewFocus.currentIntent() !== intent) return;
    if (result.ok) setActionError(undefined);
    else {
      reviewFocus.cancel();
      setActionError(result.error);
      return;
    }
    reviewFocus.noteOpenedReview(intent, result.value.operationId);
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
    <>
      <main
        className="inventory-workspace"
        aria-busy={snapshot.inventory.phase === "loading"}
      >
        <section className="page-heading">
          <div>
            <h1>Inventory</h1>
            <p>{inventorySubtitle(filteredEntries.length, isFiltered)}</p>
            {targetStates.length > 1 ? (
              <label className="inventory-target-chooser">
                Target
                <select
                  onChange={(event) => {
                    onSelectTarget(event.currentTarget.value);
                  }}
                  value={snapshot.target.id}
                >
                  {targetStates.map((state) => (
                    <option key={state.target.id} value={state.target.id}>
                      {targetOptionLabel(state.target)}
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
                {snapshot.target.label} / {snapshot.target.workspaceLabel} /{" "}
                {snapshot.target.harnessIds.join(", ")}
              </p>
            )}
          </div>
          {snapshot.inventory.phase === "loading" &&
          activeOperationId !== null ? (
            <button
              aria-label="Cancel refresh"
              className="icon-button"
              onClick={() => void client.cancelInventory(activeOperationId)}
              title="Cancel refresh"
              type="button"
            >
              <Square aria-hidden="true" size={16} />
            </button>
          ) : (
            <button
              aria-label="Refresh inventory"
              className="icon-button"
              onClick={() => void client.refreshInventory(snapshot.target.id)}
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
              SSH · 未在 V1 开放。远程 Target
              仅保留只读痕迹，不能作为变更工作区。
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
          <div className="state-banner state-banner--warning" role="status">
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
          <div className="state-banner state-banner--loading" role="status">
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
          <div className="search-control">
            <Search aria-hidden="true" size={16} />
            <span className="sr-only">Search inventory</span>
            <input
              aria-label="Search inventory"
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query !== "") {
                  event.preventDefault();
                  setQuery("");
                }
              }}
              placeholder="Search skills or sources"
              ref={searchInputRef}
              type="search"
              value={query}
            />
            {query !== "" ? (
              <button
                aria-label="Clear inventory search"
                className="search-clear"
                onClick={() => setQuery("")}
                title="Clear inventory search"
                type="button"
              >
                <X aria-hidden="true" size={15} />
              </button>
            ) : null}
          </div>
          <span aria-live="polite" className="inventory-result-count">
            {filteredEntries.length} shown
          </span>
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
                {value === "all" ? "All scopes" : `${scopeLabel(value)} scope`}
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
              <MissingInventoryEvidence phase={snapshot.inventory.phase} />
            ) : (
              <EmptyInventory
                filtered={isFiltered}
                onClearFilters={clearInventoryFilters}
              />
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
                        {snapshot.target.harnessIds.every((harnessId) =>
                          isInventoryEntryAvailableToHarness(entry, harnessId),
                        )
                          ? snapshot.target.harnessIds.join(", ")
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
            {(inventory.entries.length ?? 0) === 0 ? (
              <>
                <h2>No skills to inspect</h2>
                <p>Refresh this Target, or install a skill via npx skills.</p>
              </>
            ) : filteredEntries.length === 0 ? (
              <>
                <h2>No skill selected</h2>
                <p>No skills in the current filter.</p>
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
            <dl
              aria-label="Skill evidence details"
              className="evidence-list"
              tabIndex={0}
            >
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
                  <code className="wrapping-value">{sourceLabel(selected)}</code>
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
              aria-errormessage={
                addSourceError !== undefined
                  ? "add-skill-github-source-error"
                  : undefined
              }
              aria-invalid={addSourceError !== undefined}
              onChange={(event) => {
                setAddSource(event.currentTarget.value);
                setAddSourceError(undefined);
              }}
              placeholder="owner/repository"
              required
              value={addSource}
            />
          </label>
          {addSourceError !== undefined ? (
            <p
              className="field-error"
              id="add-skill-github-source-error"
              role="alert"
            >
              {addSourceError}
            </p>
          ) : null}
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
                onClick={(event) => void requestReview(event.currentTarget)}
                type="button"
              >
                <ShieldCheck aria-hidden="true" size={15} />
                Open Trusted Review
              </button>
            ) : (
              <p
                className="mutation-outcome"
                ref={reviewFocus.mutationOutcomeRef}
                role="status"
                tabIndex={-1}
              >
                {snapshot.mutation.outcome.process.disposition} /{" "}
                {snapshot.mutation.outcome.effects.status}
              </p>
            )}
          </section>
        ) : null}
      </aside>
    </>
  );
}
