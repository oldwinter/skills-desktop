import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  CircleHelp,
  PackagePlus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import type {
  MessageKey,
  Translator,
} from "../../../contracts/i18n/translate.js";
import type {
  PublicComparison,
  RendererError,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { useTranslator } from "../../i18n/LocaleProvider.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";

type TargetState = NonNullable<WorkspaceSnapshot["targets"]>[number];
type RowSummary = PublicComparison["rows"][number]["summary"];
type T = Translator["t"];

const summaryKey = (summary: RowSummary): MessageKey =>
  `comparison.summary.${summary}`;

function sourceSummary(
  t: T,
  row: PublicComparison["rows"][number],
  side: "left" | "right",
) {
  const entries = row[side].entries;
  if (entries.length === 0) return t("comparison.absent");
  return entries
    .map(
      (entry) =>
        `${entry.scope}: ${entry.declaredSource.sourceType ?? t("comparison.unknownType")} / ${entry.declaredSource.source ?? t("comparison.unknownSource")}`,
    )
    .join(" / ");
}

function evidenceSummary(
  t: T,
  entry: PublicComparison["rows"][number]["left"]["entries"][number],
  field: "contentFingerprint" | "revision",
) {
  const evidence = entry[field];
  return evidence.status === "unknown"
    ? t("common.unknown")
    : `${evidence.authority} / ${evidence.kind} / ${evidence.value}`;
}

function inventoryStatus(t: T, state: TargetState) {
  if (state.mutation.phase === "reconciliation-required") {
    return t("comparison.status.blocked");
  }
  if (state.inventory.phase === "loading") return t("comparison.status.loading");
  return t(`common.freshness.${state.inventory.freshness}`);
}

function compareDisabledReason(
  t: T,
  input: {
    readonly busy: boolean;
    readonly leftTargetId: string;
    readonly plannableCount: number;
    readonly rightTargetId: string;
    readonly sshSideSelected: boolean;
  },
): string | undefined {
  if (input.sshSideSelected) return t("comparison.disabled.ssh");
  if (input.plannableCount < 2) return t("comparison.disabled.needsTwo");
  if (input.leftTargetId === input.rightTargetId) {
    return t("comparison.disabled.sameSides");
  }
  if (input.busy) return t("comparison.disabled.busy");
  return undefined;
}

function comparisonEmptyNextStep(
  t: T,
  input: {
    readonly plannableCount: number;
    readonly sameSides: boolean;
  },
): string {
  if (input.plannableCount < 2) return t("comparison.next.addTarget");
  if (input.sameSides) return t("comparison.next.chooseDifferent");
  return t("comparison.next.clickCompare");
}

function prepareDisabledReason(
  t: T,
  input: {
    readonly busy: boolean;
    readonly comparisonFresh: boolean;
    readonly eligible: boolean;
    readonly mutationEligible: boolean;
    readonly row:
      | {
          readonly sideEntryCount: number;
          readonly summary: RowSummary;
        }
      | undefined;
    readonly side: "left" | "right";
    readonly ssh: boolean;
  },
): string | undefined {
  if (!input.busy && input.eligible) return undefined;
  if (input.ssh) return t("comparison.prepare.ssh");
  if (!input.comparisonFresh) return t("comparison.prepare.freshness");
  if (!input.mutationEligible) return t("comparison.prepare.reconciliation");
  if (input.busy) return t("comparison.disabled.busy");
  if (input.row === undefined) return t("comparison.prepare.selectRow");
  const side = t(input.side === "left" ? "comparison.left" : "comparison.right");
  if (input.row.summary === "missing") {
    return input.row.sideEntryCount > 0
      ? t("comparison.prepare.missingHasSkill", { side })
      : t("comparison.prepare.missingRequires", { side });
  }
  if (input.row.summary === "version-drift") {
    return t("comparison.prepare.drift", { side });
  }
  return t("comparison.prepare.unqualified", {
    summary: t(summaryKey(input.row.summary)),
  });
}

export function ComparisonView({
  client,
  onPrepared,
  snapshot,
  targets,
}: {
  readonly client: WorkspaceBridge;
  readonly onPrepared: (
    preparedId: string,
    destinationTargetId: string,
  ) => void;
  readonly snapshot: WorkspaceSnapshot;
  readonly targets: readonly TargetState[];
}) {
  const { t, tc } = useTranslator();
  const plannableTargets = useMemo(
    () => targets.filter(({ target }) => target.kind !== "ssh"),
    [targets],
  );
  const [leftTargetId, setLeftTargetId] = useState(
    plannableTargets[0]?.target.id ?? targets[0]?.target.id ?? "",
  );
  const [rightTargetId, setRightTargetId] = useState(
    plannableTargets[1]?.target.id ??
      plannableTargets[0]?.target.id ??
      targets[0]?.target.id ??
      "",
  );
  const [selectedKey, setSelectedKey] = useState<string>();
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const [error, setError] = useState<RendererError>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const locals = targets.filter(({ target }) => target.kind !== "ssh");
    const pickDefault = (excludeId?: string) =>
      locals.find(({ target }) => target.id !== excludeId)?.target.id ??
      locals[0]?.target.id ??
      "";
    const leftExists = targets.some(({ target }) => target.id === leftTargetId);
    const leftIsSsh = targets.some(
      ({ target }) => target.id === leftTargetId && target.kind === "ssh",
    );
    if (!leftExists || leftIsSsh) {
      setLeftTargetId(pickDefault(rightTargetId));
    }
    const rightExists = targets.some(
      ({ target }) => target.id === rightTargetId,
    );
    const rightIsSsh = targets.some(
      ({ target }) => target.id === rightTargetId && target.kind === "ssh",
    );
    if (!rightExists || rightIsSsh) {
      setRightTargetId(pickDefault(leftTargetId));
    }
  }, [leftTargetId, rightTargetId, targets]);

  const comparison =
    snapshot.comparison?.leftTargetId === leftTargetId &&
    snapshot.comparison.rightTargetId === rightTargetId
      ? snapshot.comparison
      : null;
  const visibleRows = useMemo(
    () =>
      comparison?.rows.filter(
        ({ key, summary }) =>
          (!differencesOnly || summary !== "matched") &&
          key.toLowerCase().includes(normalizedQuery),
      ) ?? [],
    [comparison, differencesOnly, normalizedQuery],
  );
  const differenceCount = useMemo(
    () =>
      comparison?.rows.filter(({ summary }) => summary !== "matched").length ??
      0,
    [comparison],
  );
  const selectedRow = useMemo(
    () =>
      visibleRows.find(({ key }) => key === selectedKey) ?? visibleRows[0],
    [selectedKey, visibleRows],
  );
  const leftTarget = targets.find(({ target }) => target.id === leftTargetId);
  const rightTarget = targets.find(({ target }) => target.id === rightTargetId);
  const clearSearch = () => {
    setSearchQuery("");
    searchRef.current?.focus();
  };

  const openComparison = async () => {
    const leftKind = targets.find(({ target }) => target.id === leftTargetId)
      ?.target.kind;
    const rightKind = targets.find(({ target }) => target.id === rightTargetId)
      ?.target.kind;
    if (leftKind === "ssh" || rightKind === "ssh") return;
    setBusy(true);
    try {
      const result = await client.compareTargets(leftTargetId, rightTargetId);
      if (result.ok) setError(undefined);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  };
  const prepare = async (destinationTargetId: string) => {
    if (comparison === null || selectedRow === undefined) return;
    const destination = targets.find(
      ({ target }) => target.id === destinationTargetId,
    );
    if (destination?.target.kind === "ssh") return;
    setBusy(true);
    try {
      const result = await client.prepareComparison(
        comparison.id,
        selectedRow.key,
        destinationTargetId,
      );
      if (result.ok) {
        setError(undefined);
        onPrepared(result.value.operationId, destinationTargetId);
      } else setError(result.error);
    } finally {
      setBusy(false);
    }
  };
  const comparisonFresh =
    comparison?.leftFreshness === "fresh" &&
    comparison.rightFreshness === "fresh";
  const leftMutationEligible =
    leftTarget?.target.kind !== "ssh" &&
    leftTarget?.mutation.phase !== "reconciliation-required";
  const rightMutationEligible =
    rightTarget?.target.kind !== "ssh" &&
    rightTarget?.mutation.phase !== "reconciliation-required";
  const leftEligible =
    comparisonFresh &&
    leftMutationEligible &&
    selectedRow !== undefined &&
    ((selectedRow.summary === "missing" &&
      selectedRow.left.entries.length === 0) ||
      selectedRow.summary === "version-drift");
  const rightEligible =
    comparisonFresh &&
    rightMutationEligible &&
    selectedRow !== undefined &&
    ((selectedRow.summary === "missing" &&
      selectedRow.right.entries.length === 0) ||
      selectedRow.summary === "version-drift");
  const sshSideSelected =
    leftTarget?.target.kind === "ssh" || rightTarget?.target.kind === "ssh";
  const compareReason = compareDisabledReason(t, {
    busy,
    leftTargetId,
    plannableCount: plannableTargets.length,
    rightTargetId,
    sshSideSelected,
  });
  const emptyNextStep = comparisonEmptyNextStep(t, {
    plannableCount: plannableTargets.length,
    sameSides: leftTargetId === rightTargetId,
  });
  const compareDescribedBy =
    compareReason === undefined
      ? undefined
      : sshSideSelected
        ? undefined
        : plannableTargets.length < 2
          ? "comparison-needs-two-targets"
          : leftTargetId === rightTargetId
            ? "comparison-same-sides-reason"
            : "comparison-busy-reason";
  const leftPrepareReason = prepareDisabledReason(t, {
    busy,
    comparisonFresh,
    eligible: leftEligible,
    mutationEligible: leftMutationEligible,
    row:
      selectedRow === undefined
        ? undefined
        : {
            sideEntryCount: selectedRow.left.entries.length,
            summary: selectedRow.summary,
          },
    side: "left",
    ssh: leftTarget?.target.kind === "ssh",
  });
  const rightPrepareReason = prepareDisabledReason(t, {
    busy,
    comparisonFresh,
    eligible: rightEligible,
    mutationEligible: rightMutationEligible,
    row:
      selectedRow === undefined
        ? undefined
        : {
            sideEntryCount: selectedRow.right.entries.length,
            summary: selectedRow.summary,
          },
    side: "right",
    ssh: rightTarget?.target.kind === "ssh",
  });
  const prepareDescribedBy = (
    reason: string | undefined,
    side: "left" | "right",
  ) => {
    if (reason === undefined) return undefined;
    const sideState = side === "left" ? leftTarget : rightTarget;
    if (sideState?.target.kind === "ssh") return undefined;
    if (!comparisonFresh) return "comparison-freshness-reason";
    if (
      (side === "left" && !leftMutationEligible) ||
      (side === "right" && !rightMutationEligible)
    ) {
      return "comparison-reconciliation-reason";
    }
    if (busy) return "comparison-busy-reason";
    return side === "left"
      ? "comparison-prepare-left-unqualified"
      : "comparison-prepare-right-unqualified";
  };

  return (
    <>
      <main className="comparison-workspace" id="workspace-main" tabIndex={-1}>
        <section className="page-heading">
          <div>
            <h1>{t("comparison.title")}</h1>
            <p>
              {plannableTargets.length < 2
                ? t("comparison.needsSecond")
                : (differencesOnly || normalizedQuery !== "") && comparison !== null
                  ? t("comparison.alignedKeysOf", {
                      shown: visibleRows.length,
                      total: comparison.rows.length,
                    })
                  : tc("comparison.alignedKeys", comparison?.rows.length ?? 0)}
            </p>
          </div>
          {comparison !== null && comparison.rows.length > 0 ? (
            <div className="comparison-filters">
              <div className="search-control">
                <Search aria-hidden="true" size={16} />
                <input
                  aria-label={t("comparison.search")}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      clearSearch();
                    }
                  }}
                  placeholder={t("comparison.searchPlaceholder")}
                  ref={searchRef}
                  type="search"
                  value={searchQuery}
                />
                {searchQuery !== "" ? (
                  <button
                    aria-label={t("comparison.clearSearch")}
                    className="search-clear"
                    onClick={clearSearch}
                    type="button"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                ) : null}
              </div>
              <label className="comparison-filter-toggle">
                <input
                  aria-describedby="comparison-difference-count"
                  aria-label={t("comparison.differencesOnly")}
                  checked={differencesOnly}
                  onChange={(event) => {
                    setDifferencesOnly(event.currentTarget.checked);
                    setSelectedKey(undefined);
                  }}
                  type="checkbox"
                />
                <span>{t("comparison.differencesOnly")}</span>
                <strong aria-hidden="true">{differenceCount}</strong>
                <span className="sr-only" id="comparison-difference-count">
                  {t(
                    normalizedQuery !== ""
                      ? "comparison.differenceCount.beforeSearch"
                      : differencesOnly
                        ? "comparison.differenceCount.remain"
                        : "comparison.differenceCount.wouldRemain",
                    { count: differenceCount, total: comparison.rows.length },
                  )}
                </span>
              </label>
            </div>
          ) : null}
        </section>

        <div
          className="comparison-controls"
          aria-label={t("comparison.pairedTargets")}
        >
          <label>
            <span>{t("comparison.leftTarget")}</span>
            <select
              onChange={(event) => setLeftTargetId(event.currentTarget.value)}
              value={leftTargetId}
            >
              {targets.map(({ target }) => (
                <option
                  disabled={
                    target.id === rightTargetId || target.kind === "ssh"
                  }
                  key={target.id}
                  value={target.id}
                >
                  {target.kind === "ssh"
                    ? t("common.ssh.targetOption", { label: target.label })
                    : target.label}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label={t("comparison.swap")}
            className="icon-button"
            disabled={leftTargetId === rightTargetId}
            onClick={() => {
              setLeftTargetId(rightTargetId);
              setRightTargetId(leftTargetId);
              setSelectedKey(undefined);
            }}
            title={t("comparison.swap")}
            type="button"
          >
            <ArrowLeftRight aria-hidden="true" size={17} />
          </button>
          <label>
            <span>{t("comparison.rightTarget")}</span>
            <select
              onChange={(event) => setRightTargetId(event.currentTarget.value)}
              value={rightTargetId}
            >
              {targets.map(({ target }) => (
                <option
                  disabled={
                    target.id === leftTargetId || target.kind === "ssh"
                  }
                  key={target.id}
                  value={target.id}
                >
                  {target.kind === "ssh"
                    ? t("common.ssh.targetOption", { label: target.label })
                    : target.label}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-describedby={compareDescribedBy}
            className="text-button text-button--primary"
            disabled={
              busy ||
              leftTargetId === rightTargetId ||
              plannableTargets.length < 2 ||
              sshSideSelected
            }
            onClick={() => void openComparison()}
            title={compareReason}
            type="button"
          >
            <ArrowLeftRight aria-hidden="true" size={15} />
            {t("comparison.compare")}
          </button>
        </div>

        {plannableTargets.length < 2 ? (
          <div
            className="state-banner state-banner--loading"
            id="comparison-needs-two-targets"
            role="status"
          >
            <CircleHelp aria-hidden="true" size={16} />
            <span>
              {t(
                targets.some(({ target }) => target.kind === "ssh")
                  ? "comparison.needsTwo.sshBody"
                  : "comparison.needsTwo.body",
              )}
            </span>
          </div>
        ) : null}
        {plannableTargets.length >= 2 && leftTargetId === rightTargetId ? (
          <div
            className="state-banner state-banner--loading"
            id="comparison-same-sides-reason"
            role="status"
          >
            <CircleHelp aria-hidden="true" size={16} />
            <span>{t("comparison.disabled.sameSides")}</span>
          </div>
        ) : null}
        {busy ? (
          <p className="sr-only" id="comparison-busy-reason">
            {t("comparison.disabled.busy")}
          </p>
        ) : null}

        {error !== undefined ? (
          <div className="state-banner state-banner--danger" role="alert">
            <AlertCircle aria-hidden="true" size={16} />
            <UserFacingErrorCopy error={error} />
          </div>
        ) : null}

        <div className="paired-status" aria-live="polite">
          {[leftTarget, rightTarget].map((state, index) =>
            state === undefined ? null : (
              <div key={`${index}:${state.target.id}`}>
                <span>
                  {t(index === 0 ? "comparison.left" : "comparison.right")}
                </span>
                <strong>{state.target.label}</strong>
                <code>{state.target.workspaceLabel}</code>
                <span>{inventoryStatus(t, state)}</span>
                {state.inventory.lastError !== null ? (
                  <span className="paired-status-error" role="status">
                    <UserFacingErrorCopy error={state.inventory.lastError} />
                  </span>
                ) : null}
                <button
                  aria-label={t("comparison.refreshTarget", {
                    label: state.target.label,
                  })}
                  className="icon-button"
                  disabled={busy || state.inventory.phase === "loading"}
                  onClick={() => void client.refreshInventory(state.target.id)}
                  title={t("comparison.refreshTarget", {
                    label: state.target.label,
                  })}
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={15} />
                </button>
              </div>
            ),
          )}
        </div>

        <div className="comparison-table-wrap">
          {comparison === null ? (
            <div className="empty-state" role="status">
              <CircleHelp aria-hidden="true" size={22} />
              <h2>{t("comparison.empty.none")}</h2>
              <p>{emptyNextStep}</p>
            </div>
          ) : comparison.rows.length === 0 ? (
            <div className="empty-state" role="status">
              <CircleHelp aria-hidden="true" size={22} />
              <h2>{t("comparison.empty.noEvidence")}</h2>
            </div>
          ) : visibleRows.length === 0 && normalizedQuery !== "" ? (
            <div className="empty-state" role="status">
              <Search aria-hidden="true" size={22} />
              <h2>{t("comparison.empty.noSearchMatch")}</h2>
              <p>
                {t(
                  differencesOnly
                    ? "comparison.empty.tryAnotherOrToggle"
                    : "comparison.empty.tryAnotherOrClear",
                )}
              </p>
              <button className="text-button" onClick={clearSearch} type="button">
                {t("comparison.clearSearch")}
              </button>
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="empty-state" role="status">
              <CircleHelp aria-hidden="true" size={22} />
              <h2>{t("comparison.empty.noDifferences")}</h2>
              <p>{tc("comparison.empty.allMatch", comparison.rows.length)}</p>
            </div>
          ) : (
            <table className="comparison-table" ref={tableRef}>
              <caption className="sr-only">
                {t("comparison.table.caption")}
              </caption>
              <thead>
                <tr>
                  <th>{t("common.skill")}</th>
                  <th>{leftTarget?.target.label ?? t("comparison.left")}</th>
                  <th>{t("comparison.table.dimensions")}</th>
                  <th>{rightTarget?.target.label ?? t("comparison.right")}</th>
                  <th>{t("comparison.table.summary")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr
                    className={
                      selectedRow?.key === row.key ? "is-selected" : undefined
                    }
                    key={row.key}
                  >
                    <td data-label={t("common.skill")}>
                      <button
                        className="skill-button"
                        onClick={() => setSelectedKey(row.key)}
                        onKeyDown={(event) => {
                          if (
                            event.altKey ||
                            event.ctrlKey ||
                            event.metaKey ||
                            event.shiftKey ||
                            event.nativeEvent.isComposing
                          ) return;
                          let nextIndex: number;
                          switch (event.key) {
                            case "ArrowDown":
                              nextIndex = Math.min(
                                index + 1, visibleRows.length - 1,
                              );
                              break;
                            case "ArrowUp":
                              nextIndex = Math.max(index - 1, 0);
                              break;
                            case "Home":
                              nextIndex = 0;
                              break;
                            case "End":
                              nextIndex = visibleRows.length - 1;
                              break;
                            default:
                              return;
                          }
                          const nextRow = visibleRows[nextIndex];
                          if (nextRow === undefined) return;
                          event.preventDefault();
                          setSelectedKey(nextRow.key);
                          tableRef.current?.querySelectorAll<HTMLButtonElement>(
                            ".skill-button",
                          )[nextIndex]?.focus();
                        }}
                        title={t("comparison.browseHint")}
                        type="button"
                      >
                        {row.key}
                      </button>
                    </td>
                    <td data-label={t("comparison.table.leftEvidence")}>
                      <code className="wrapping-value">
                        {sourceSummary(t, row, "left")}
                      </code>
                    </td>
                    <td data-label={t("comparison.table.dimensions")}>
                      {row.dimensions.declaredSource} /{" "}
                      {row.dimensions.revision} /{" "}
                      {row.dimensions.contentFingerprint}
                    </td>
                    <td data-label={t("comparison.table.rightEvidence")}>
                      <code className="wrapping-value">
                        {sourceSummary(t, row, "right")}
                      </code>
                    </td>
                    <td data-label={t("comparison.table.summary")}>
                      <span
                        className={`comparison-status comparison-status--${row.summary}`}
                      >
                        {t(summaryKey(row.summary))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <aside
        className="inspector comparison-inspector"
        aria-label={t("comparison.inspector.label")}
      >
        {selectedRow === undefined ? (
          <div className="inspector-empty">
            <CircleHelp aria-hidden="true" size={22} />
            <h2>{t("comparison.inspector.none")}</h2>
            <p>
              {comparison === null
                ? emptyNextStep
                : normalizedQuery !== "" && comparison.rows.length > 0
                  ? t("comparison.inspector.clearToInspect")
                : differencesOnly && comparison.rows.length > 0
                  ? tc("comparison.empty.allMatch", comparison.rows.length)
                : t("comparison.inspector.selectHint")}
            </p>
          </div>
        ) : (
          <>
            <header className="inspector-heading">
              <ArrowLeftRight aria-hidden="true" size={18} />
              <div>
                <p>{t(summaryKey(selectedRow.summary))}</p>
                <h2>{selectedRow.key}</h2>
              </div>
            </header>
            <dl className="evidence-list">
              <div>
                <dt>{t("comparison.inspector.presence")}</dt>
                <dd>{selectedRow.dimensions.presence}</dd>
              </div>
              <div>
                <dt>{t("inventory.table.declaredSource")}</dt>
                <dd>{selectedRow.dimensions.declaredSource}</dd>
              </div>
              <div>
                <dt>{t("inventory.inspector.revision")}</dt>
                <dd>{selectedRow.dimensions.revision}</dd>
              </div>
              <div>
                <dt>{t("inventory.inspector.contentFingerprint")}</dt>
                <dd>{selectedRow.dimensions.contentFingerprint}</dd>
              </div>
              <div>
                <dt>{t("comparison.inspector.leftHarness")}</dt>
                <dd>{selectedRow.left.harnessAvailability}</dd>
              </div>
              <div>
                <dt>{t("comparison.inspector.rightHarness")}</dt>
                <dd>{selectedRow.right.harnessAvailability}</dd>
              </div>
            </dl>
            <div className="comparison-evidence-detail">
              {(["left", "right"] as const).map((side) => (
                <section key={side}>
                  <h3>
                    {t(
                      side === "left"
                        ? "comparison.table.leftEvidence"
                        : "comparison.table.rightEvidence",
                    )}
                  </h3>
                  {selectedRow[side].entries.length === 0 ? (
                    <p>{t("comparison.absent")}</p>
                  ) : (
                    selectedRow[side].entries.map((entry, index) => (
                      <div
                        key={`${entry.scope}:${entry.declaredSource.sourceType}:${entry.declaredSource.source}:${index}`}
                      >
                        <strong>{entry.scope}</strong>
                        <span>
                          {t("comparison.inspector.source")}{" "}
                          {entry.declaredSource.sourceType ??
                            t("comparison.unknownType")}{" "}
                          / {entry.declaredSource.source ?? t("comparison.unknownSource")}
                        </span>
                        <code>
                          {t("comparison.inspector.revision")}{" "}
                          {evidenceSummary(t, entry, "revision")}
                        </code>
                        <code>
                          {t("comparison.inspector.fingerprint")}{" "}
                          {evidenceSummary(t, entry, "contentFingerprint")}
                        </code>
                      </div>
                    ))
                  )}
                </section>
              ))}
            </div>
            {!comparisonFresh ? (
              <div
                className="state-banner state-banner--warning"
                id="comparison-freshness-reason"
                role="status"
              >
                <AlertCircle aria-hidden="true" size={16} />
                <span>{t("comparison.prepare.freshness")}</span>
              </div>
            ) : null}
            {!leftMutationEligible || !rightMutationEligible ? (
              <div
                className="state-banner state-banner--danger"
                id="comparison-reconciliation-reason"
                role="alert"
              >
                <AlertCircle aria-hidden="true" size={16} />
                <span>{t("comparison.prepare.reconciliation")}</span>
              </div>
            ) : null}
            {prepareDescribedBy(leftPrepareReason, "left") ===
            "comparison-prepare-left-unqualified" ? (
              <p className="sr-only" id="comparison-prepare-left-unqualified">
                {leftPrepareReason}
              </p>
            ) : null}
            {prepareDescribedBy(rightPrepareReason, "right") ===
            "comparison-prepare-right-unqualified" ? (
              <p className="sr-only" id="comparison-prepare-right-unqualified">
                {rightPrepareReason}
              </p>
            ) : null}
            <div className="comparison-actions">
              <button
                aria-describedby={prepareDescribedBy(leftPrepareReason, "left")}
                className="text-button"
                disabled={busy || !leftEligible}
                onClick={() => void prepare(leftTargetId)}
                title={leftPrepareReason}
                type="button"
              >
                <PackagePlus aria-hidden="true" size={15} />
                {t("comparison.prepareLeft")}
              </button>
              <button
                aria-describedby={prepareDescribedBy(
                  rightPrepareReason,
                  "right",
                )}
                className="text-button"
                disabled={busy || !rightEligible}
                onClick={() => void prepare(rightTargetId)}
                title={rightPrepareReason}
                type="button"
              >
                <PackagePlus aria-hidden="true" size={15} />
                {t("comparison.prepareRight")}
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
