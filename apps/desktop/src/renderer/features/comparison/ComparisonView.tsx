import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  CircleHelp,
  PackagePlus,
  RefreshCw,
} from "lucide-react";

import type {
  PublicComparison,
  RendererError,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";

type TargetState = NonNullable<WorkspaceSnapshot["targets"]>[number];

const summaryLabel: Record<
  PublicComparison["rows"][number]["summary"],
  string
> = {
  matched: "Matched",
  missing: "Missing",
  "source-mismatch": "Source mismatch",
  "unknown-evidence": "Unknown evidence",
  "version-drift": "Revision or content drift",
};

function sourceSummary(
  row: PublicComparison["rows"][number],
  side: "left" | "right",
) {
  const entries = row[side].entries;
  if (entries.length === 0) return "Absent";
  return entries
    .map(
      (entry) =>
        `${entry.scope}: ${entry.declaredSource.sourceType ?? "Unknown type"} / ${entry.declaredSource.source ?? "Unknown source"}`,
    )
    .join(" / ");
}

function evidenceSummary(
  entry: PublicComparison["rows"][number]["left"]["entries"][number],
  field: "contentFingerprint" | "revision",
) {
  const evidence = entry[field];
  return evidence.status === "unknown"
    ? "Unknown"
    : `${evidence.authority} / ${evidence.kind} / ${evidence.value}`;
}

function freshnessLabel(
  freshness: TargetState["inventory"]["freshness"],
) {
  if (freshness === "fresh") return "Fresh evidence";
  if (freshness === "stale") return "Stale evidence";
  return "No evidence";
}

function inventoryStatus(state: TargetState) {
  if (state.mutation.phase === "reconciliation-required") {
    return "Blocked: reconciliation required";
  }
  if (state.inventory.phase === "loading") return "Loading Inventory";
  return freshnessLabel(state.inventory.freshness);
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
  const selectedRow = useMemo(
    () =>
      comparison?.rows.find(({ key }) => key === selectedKey) ??
      comparison?.rows[0],
    [comparison, selectedKey],
  );
  const leftTarget = targets.find(({ target }) => target.id === leftTargetId);
  const rightTarget = targets.find(({ target }) => target.id === rightTargetId);

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

  return (
    <>
      <main className="comparison-workspace">
        <section className="page-heading">
          <div>
            <h1>Comparison</h1>
            <p>
              {plannableTargets.length < 2
                ? "Needs a second Local Target"
                : `${comparison?.rows.length ?? 0} aligned skill keys`}
            </p>
          </div>
        </section>

        <div className="comparison-controls" aria-label="Paired Targets">
          <label>
            <span>Left Target</span>
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
                    ? `${target.label} · 未开放`
                    : target.label}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label="Swap comparison Targets"
            className="icon-button"
            disabled={leftTargetId === rightTargetId}
            onClick={() => {
              setLeftTargetId(rightTargetId);
              setRightTargetId(leftTargetId);
              setSelectedKey(undefined);
            }}
            title="Swap comparison Targets"
            type="button"
          >
            <ArrowLeftRight aria-hidden="true" size={17} />
          </button>
          <label>
            <span>Right Target</span>
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
                    ? `${target.label} · 未开放`
                    : target.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="text-button text-button--primary"
            disabled={
              busy ||
              leftTargetId === rightTargetId ||
              plannableTargets.length < 2 ||
              sshSideSelected
            }
            onClick={() => void openComparison()}
            title={
              sshSideSelected
                ? "SSH · 未在 V1 开放，不能作为可规划对比侧"
                : plannableTargets.length < 2
                  ? "Comparison needs two Local Targets"
                  : undefined
            }
            type="button"
          >
            <ArrowLeftRight aria-hidden="true" size={15} />
            Compare
          </button>
        </div>

        {plannableTargets.length < 2 ? (
          <div className="state-banner state-banner--loading" role="status">
            <CircleHelp aria-hidden="true" size={16} />
            <span>
              {targets.some(({ target }) => target.kind === "ssh")
                ? "Comparison needs two Local Targets. SSH · 未在 V1 开放，不能作为可规划对比侧。Add another Local Target under Targets, then return here to compare inventories."
                : "Comparison needs two Local Targets. Add another Local Target under Targets, then return here to compare inventories."}
            </span>
          </div>
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
              <div key={state.target.id}>
                <span>{index === 0 ? "Left" : "Right"}</span>
                <strong>{state.target.label}</strong>
                <code>{state.target.workspaceLabel}</code>
                <span>{inventoryStatus(state)}</span>
                {state.inventory.lastError !== null ? (
                  <span className="paired-status-error" role="status">
                    <UserFacingErrorCopy error={state.inventory.lastError} />
                  </span>
                ) : null}
                <button
                  aria-label={`Refresh ${state.target.label}`}
                  className="icon-button"
                  disabled={busy || state.inventory.phase === "loading"}
                  onClick={() => void client.refreshInventory(state.target.id)}
                  title={`Refresh ${state.target.label}`}
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
              <h2>No comparison selected</h2>
              <p>Click Compare to build the aligned skill table.</p>
            </div>
          ) : comparison.rows.length === 0 ? (
            <div className="empty-state" role="status">
              <CircleHelp aria-hidden="true" size={22} />
              <h2>No skill evidence on either Target</h2>
            </div>
          ) : (
            <table className="comparison-table">
              <caption className="sr-only">
                Dimensioned Target comparison
              </caption>
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>{leftTarget?.target.label ?? "Left"}</th>
                  <th>Dimensions</th>
                  <th>{rightTarget?.target.label ?? "Right"}</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr
                    className={
                      selectedRow?.key === row.key ? "is-selected" : undefined
                    }
                    key={row.key}
                  >
                    <td data-label="Skill">
                      <button
                        className="skill-button"
                        onClick={() => setSelectedKey(row.key)}
                        type="button"
                      >
                        {row.key}
                      </button>
                    </td>
                    <td data-label="Left evidence">
                      <code className="wrapping-value">
                        {sourceSummary(row, "left")}
                      </code>
                    </td>
                    <td data-label="Dimensions">
                      {row.dimensions.declaredSource} /{" "}
                      {row.dimensions.revision} /{" "}
                      {row.dimensions.contentFingerprint}
                    </td>
                    <td data-label="Right evidence">
                      <code className="wrapping-value">
                        {sourceSummary(row, "right")}
                      </code>
                    </td>
                    <td data-label="Summary">
                      <span
                        className={`comparison-status comparison-status--${row.summary}`}
                      >
                        {summaryLabel[row.summary]}
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
        aria-label="Selected comparison evidence"
      >
        {selectedRow === undefined ? (
          <div className="inspector-empty">
            <CircleHelp aria-hidden="true" size={22} />
            <h2>No difference selected</h2>
          </div>
        ) : (
          <>
            <header className="inspector-heading">
              <ArrowLeftRight aria-hidden="true" size={18} />
              <div>
                <p>{summaryLabel[selectedRow.summary]}</p>
                <h2>{selectedRow.key}</h2>
              </div>
            </header>
            <dl className="evidence-list">
              <div>
                <dt>Presence</dt>
                <dd>{selectedRow.dimensions.presence}</dd>
              </div>
              <div>
                <dt>Declared source</dt>
                <dd>{selectedRow.dimensions.declaredSource}</dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd>{selectedRow.dimensions.revision}</dd>
              </div>
              <div>
                <dt>Content fingerprint</dt>
                <dd>{selectedRow.dimensions.contentFingerprint}</dd>
              </div>
              <div>
                <dt>Left Harness</dt>
                <dd>{selectedRow.left.harnessAvailability}</dd>
              </div>
              <div>
                <dt>Right Harness</dt>
                <dd>{selectedRow.right.harnessAvailability}</dd>
              </div>
            </dl>
            <div className="comparison-evidence-detail">
              {(["left", "right"] as const).map((side) => (
                <section key={side}>
                  <h3>
                    {side === "left" ? "Left evidence" : "Right evidence"}
                  </h3>
                  {selectedRow[side].entries.length === 0 ? (
                    <p>Absent</p>
                  ) : (
                    selectedRow[side].entries.map((entry, index) => (
                      <div
                        key={`${entry.scope}:${entry.declaredSource.sourceType}:${entry.declaredSource.source}:${index}`}
                      >
                        <strong>{entry.scope}</strong>
                        <span>
                          Source:{" "}
                          {entry.declaredSource.sourceType ?? "Unknown type"} /{" "}
                          {entry.declaredSource.source ?? "Unknown source"}
                        </span>
                        <code>
                          Revision: {evidenceSummary(entry, "revision")}
                        </code>
                        <code>
                          Fingerprint:{" "}
                          {evidenceSummary(entry, "contentFingerprint")}
                        </code>
                      </div>
                    ))
                  )}
                </section>
              ))}
            </div>
            {!comparisonFresh ? (
              <div className="state-banner state-banner--warning" role="status">
                <AlertCircle aria-hidden="true" size={16} />
                <span>
                  Fresh evidence is required on both Targets before planning.
                </span>
              </div>
            ) : null}
            {!leftMutationEligible || !rightMutationEligible ? (
              <div className="state-banner state-banner--danger" role="alert">
                <AlertCircle aria-hidden="true" size={16} />
                <span>
                  Reconciliation is required before this Target can receive a
                  comparison mutation.
                </span>
              </div>
            ) : null}
            <div className="comparison-actions">
              <button
                className="text-button"
                disabled={busy || !leftEligible}
                onClick={() => void prepare(leftTargetId)}
                title={
                  leftTarget?.target.kind === "ssh"
                    ? "SSH · 未在 V1 开放，无法准备变更"
                    : undefined
                }
                type="button"
              >
                <PackagePlus aria-hidden="true" size={15} />
                Prepare for Left
              </button>
              <button
                className="text-button"
                disabled={busy || !rightEligible}
                onClick={() => void prepare(rightTargetId)}
                title={
                  rightTarget?.target.kind === "ssh"
                    ? "SSH · 未在 V1 开放，无法准备变更"
                    : undefined
                }
                type="button"
              >
                <PackagePlus aria-hidden="true" size={15} />
                Prepare for Right
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}