import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  Laptop,
  LibraryBig,
  LoaderCircle,
  PackagePlus,
  RotateCcw,
  Server,
  ShieldCheck,
} from "lucide-react";

import type {
  PublicCollectionsState,
  RendererError,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";

type Release = PublicCollectionsState["releases"][number];
type TargetState = NonNullable<WorkspaceSnapshot["targets"]>[number];
type Scope = "global" | "project";
type SelectionMode = "add" | "reapply";
type TargetInput = {
  readonly included: boolean;
  readonly scope: Scope;
  readonly selected: Readonly<Record<string, SelectionMode>>;
};

const statusLabels = {
  incompatible: "Incompatible",
  missing: "Missing",
  "present-content-unknown": "Present, content unknown",
  "removal-candidate": "Removal candidate",
  "source-conflict": "Source conflict",
  unchanged: "Unchanged",
} as const;

function releaseKey(release: Release) {
  return `${release.collectionId}:${release.releaseNumber}:${release.manifestDigest}`;
}

function targetStatesFor(snapshot: WorkspaceSnapshot): TargetState[] {
  return (
    snapshot.targets ?? [
      {
        collections: snapshot.collections,
        deletionBlocked: false,
        inventory: snapshot.inventory,
        mutation: snapshot.mutation,
        target: snapshot.target,
      },
    ]
  );
}

function inputFor(targetId: string, activeTargetId: string): TargetInput {
  return {
    included: targetId === activeTargetId,
    scope: "project",
    selected: {},
  };
}

export function CollectionsView({
  client,
  snapshot,
}: {
  readonly client: WorkspaceBridge;
  readonly snapshot: WorkspaceSnapshot;
}) {
  const collections = snapshot.collections;
  const targetStates = useMemo(() => targetStatesFor(snapshot), [snapshot]);
  const targetKey = targetStates
    .map(({ target }) => `${target.id}:${target.generation}`)
    .join("|");
  const [releaseSelection, setReleaseSelection] = useState(
    collections?.releases[0] === undefined
      ? ""
      : releaseKey(collections.releases[0]),
  );
  const [inputs, setInputs] = useState<Record<string, TargetInput>>(() =>
    Object.fromEntries(
      targetStates.map(({ target }) => [
        target.id,
        inputFor(target.id, snapshot.target.id),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RendererError>();
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);

  const release =
    collections?.releases.find(
      (candidate) => releaseKey(candidate) === releaseSelection,
    ) ?? collections?.releases[0];

  useEffect(() => {
    setInputs(
      Object.fromEntries(
        targetStates.map(({ target }) => [
          target.id,
          inputFor(target.id, snapshot.target.id),
        ]),
      ),
    );
  }, [releaseSelection, snapshot.target.id, targetKey]);

  useEffect(() => {
    if (
      collections !== undefined &&
      (collections.plan !== null || collections.execution !== null)
    ) {
      statusHeadingRef.current?.focus();
    }
  }, [collections?.execution?.id, collections?.plan?.id]);

  const releaseFor = (targetState: TargetState) =>
    targetState.collections?.releases.find(
      (candidate) =>
        release !== undefined && releaseKey(candidate) === releaseKey(release),
    );

  const assessmentFor = (targetState: TargetState, scope: Scope) =>
    releaseFor(targetState)?.assessments.find(
      (candidate) =>
        candidate.scope === scope &&
        candidate.targetId === targetState.target.id &&
        candidate.targetGeneration === targetState.target.generation,
    );

  const selectionsFor = (targetState: TargetState, input: TargetInput) => {
    const assessment = assessmentFor(targetState, input.scope);
    return (assessment?.entries ?? []).flatMap((entry) => {
      const mode = input.selected[entry.name];
      return mode === undefined ? [] : [{ mode, name: entry.name }];
    });
  };

  const targetBlockers = (targetState: TargetState, input: TargetInput) => {
    const targetRelease = releaseFor(targetState);
    const assessment = assessmentFor(targetState, input.scope);
    const blockers: string[] = [];
    if (targetRelease === undefined || !targetRelease.executable) {
      blockers.push("No executable reviewed release for this Target.");
    }
    if (assessment?.compatibility !== "compatible") {
      blockers.push("Release is incompatible with this Target.");
    }
    if (assessment?.inventoryFreshness !== "fresh") {
      blockers.push("Fresh inventory evidence is required.");
    }
    if (targetState.mutation.phase === "reconciliation-required") {
      blockers.push("Mutation reconciliation is required.");
    }
    return blockers;
  };

  const selectedTargets = targetStates.flatMap((targetState) => {
    const input = inputs[targetState.target.id];
    if (input === undefined || !input.included) return [];
    return [{ input, selections: selectionsFor(targetState, input), targetState }];
  });
  const canPrepare =
    !busy &&
    collections?.plan === null &&
    release !== undefined &&
    selectedTargets.length > 0 &&
    selectedTargets.every(
      ({ input, selections, targetState }) =>
        selections.length > 0 && targetBlockers(targetState, input).length === 0,
    );

  const updateInput = (
    targetId: string,
    update: (current: TargetInput) => TargetInput,
  ) => {
    setInputs((current) => {
      const value = current[targetId];
      return value === undefined
        ? current
        : { ...current, [targetId]: update(value) };
    });
  };

  const prepare = async () => {
    if (release === undefined || !canPrepare) return;
    setBusy(true);
    try {
      const result = await client.prepareCollectionAcrossTargets({
        collectionId: release.collectionId,
        manifestDigest: release.manifestDigest,
        releaseNumber: release.releaseNumber,
        targets: selectedTargets.map(({ input, selections, targetState }) => ({
          scope: input.scope,
          selections,
          targetId: targetState.target.id,
        })),
      });
      if (result.ok) setError(undefined);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  const requestReview = async () => {
    if (collections?.plan === null || collections?.plan === undefined) return;
    setBusy(true);
    try {
      const result = await client.requestCollectionReview(collections.plan.id);
      if (result.ok) setError(undefined);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async (targetId: string) => {
    setBusy(true);
    try {
      const result = await client.reconcileMutation(targetId);
      if (result.ok) setError(undefined);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  if (collections === undefined || collections.releases.length === 0) {
    return (
      <main className="collections-workspace">
        <section className="page-heading">
          <div>
            <h1>Official Collections</h1>
            <p>No reviewed releases are bundled</p>
          </div>
        </section>
        <div className="empty-state" role="status">
          <CircleHelp aria-hidden="true" size={22} />
          <h2>No Official Collections</h2>
        </div>
      </main>
    );
  }

  const execution = collections.execution;
  const plan = collections.plan;

  return (
    <>
      <main className="collections-workspace">
        <section className="page-heading">
          <div>
            <h1>Official Collections</h1>
            <p>{collections.releases.length} bundled releases</p>
          </div>
        </section>

        <div className="collection-controls">
          <label>
            <span>Release</span>
            <select
              disabled={busy || plan !== null || execution?.phase === "running"}
              onChange={(event) =>
                setReleaseSelection(event.currentTarget.value)
              }
              value={release === undefined ? "" : releaseKey(release)}
            >
              {collections.releases.map((candidate) => (
                <option key={releaseKey(candidate)} value={releaseKey(candidate)}>
                  {candidate.title} / release {candidate.releaseNumber}
                </option>
              ))}
            </select>
          </label>
          <button
            className="text-button text-button--primary"
            disabled={!canPrepare}
            onClick={() => void prepare()}
            type="button"
          >
            <PackagePlus aria-hidden="true" size={15} />
            Prepare plan
          </button>
        </div>

        {release?.blockers.map((blocker) => (
          <div className="state-banner state-banner--warning" key={blocker} role="status">
            <AlertCircle aria-hidden="true" size={16} />
            <span>{blocker}</span>
          </div>
        ))}
        {error !== undefined ? (
          <div className="state-banner state-banner--danger" role="alert">
            <AlertCircle aria-hidden="true" size={16} />
            <span>{error.message}</span>
          </div>
        ) : null}

        {execution === null || execution === undefined ? null : (
          <section className="collection-execution" aria-live="polite">
            <header>
              {execution.phase === "running" ? (
                <LoaderCircle className="spin" aria-hidden="true" size={17} />
              ) : execution.phase === "completed" ? (
                <CheckCircle2 aria-hidden="true" size={17} />
              ) : (
                <AlertCircle aria-hidden="true" size={17} />
              )}
              <div>
                <h2 ref={statusHeadingRef} tabIndex={-1}>
                  {execution.phase === "running"
                    ? "Collection run in progress"
                    : execution.phase === "completed"
                      ? "Collection run completed"
                      : "Collection run stopped"}
                </h2>
                <p>Sequential, non-transactional execution</p>
              </div>
            </header>
            <ol className="collection-progress-list">
              {execution.children.map((child) => (
                <li key={`${child.position}:${child.target.id}`}>
                  <div className="collection-progress-heading">
                    <strong>{child.position}. {child.target.label}</strong>
                    <span>{child.status}</span>
                  </div>
                  <ul>
                    {child.skills.map((skill) => (
                      <li key={`${skill.mode}:${skill.name}`}>
                        <span>{skill.name} / {skill.mode}</span>
                        <span>
                          {skill.status}
                          {skill.effects === null ? "" : ` / ${skill.effects}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {child.error === null ? null : (
                    <p className="collection-child-error">{child.error.message}</p>
                  )}
                  {child.status === "reconciliation-required" ? (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void reconcile(child.target.id)}
                      type="button"
                    >
                      <RotateCcw aria-hidden="true" size={15} />
                      Reconcile {child.target.label}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="collection-machine-list">
          {targetStates.map((targetState) => {
            const input = inputs[targetState.target.id] ??
              inputFor(targetState.target.id, snapshot.target.id);
            const assessment = assessmentFor(targetState, input.scope);
            const blockers = targetBlockers(targetState, input);
            const targetRelease = releaseFor(targetState);
            const included = input.included;
            const locked = busy || plan !== null || execution?.phase === "running";
            const TargetIcon = targetState.target.kind === "ssh" ? Server : Laptop;
            return (
              <section className="collection-machine" key={targetState.target.id}>
                <header>
                  <label className="collection-machine-toggle">
                    <input
                      aria-label={`Include ${targetState.target.label}`}
                      checked={included}
                      disabled={locked || blockers.length > 0}
                      onChange={(event) => {
                        const included = event.currentTarget.checked;
                        updateInput(targetState.target.id, (current) => ({
                          ...current,
                          included,
                        }));
                      }}
                      type="checkbox"
                    />
                    <TargetIcon aria-hidden="true" size={17} />
                    <span>
                      <strong>{targetState.target.label}</strong>
                      <small>{targetState.target.kind === "ssh" ? "SSH" : "Local"} / {targetState.target.harness}</small>
                    </span>
                  </label>
                  <label className="collection-scope-select">
                    <span>Scope</span>
                    <select
                      disabled={locked || !included}
                      onChange={(event) => {
                        const scope = event.currentTarget.value as Scope;
                        updateInput(targetState.target.id, (current) => ({
                          ...current,
                          scope,
                          selected: {},
                        }));
                      }}
                      value={input.scope}
                    >
                      <option value="project">Project</option>
                      <option value="global">Global</option>
                    </select>
                  </label>
                </header>
                {blockers.length === 0 ? null : (
                  <ul className="collection-target-blockers">
                    {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                )}
                <div className="collection-table-wrap">
                  <table className="collection-table">
                    <caption className="sr-only">
                      Official Collection assessment for {targetState.target.label}
                    </caption>
                    <thead>
                      <tr>
                        <th aria-label="Select" />
                        <th>Skill</th>
                        <th>Assessment</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(assessment?.entries ?? []).map((entry) => {
                        const mode = entry.selectionModes[0];
                        const selectionLabel = targetStates.length === 1
                          ? `Select ${entry.name}`
                          : `Select ${entry.name} on ${targetState.target.label}`;
                        return (
                          <tr key={`${input.scope}:${entry.name}`}>
                            <td data-label="Select">
                              <input
                                aria-label={selectionLabel}
                                checked={input.selected[entry.name] !== undefined}
                                disabled={locked || !included || !targetRelease?.executable || !entry.selectable || mode === undefined}
                                onChange={(event) => {
                                  const checked = event.currentTarget.checked;
                                  updateInput(targetState.target.id, (current) => {
                                    const selected = { ...current.selected };
                                    if (!checked) delete selected[entry.name];
                                    else if (mode !== undefined) selected[entry.name] = mode;
                                    return { ...current, selected };
                                  });
                                }}
                                type="checkbox"
                              />
                            </td>
                            <td data-label="Skill"><strong>{entry.name}</strong></td>
                            <td data-label="Assessment">
                              <span className={`collection-status collection-status--${entry.status}`}>
                                {statusLabels[entry.status]}
                              </span>
                            </td>
                            <td data-label="Action">
                              {mode === undefined ? "Not selectable" : mode === "add" ? "Add" : "Reapply"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      </main>

      <aside className="inspector collection-inspector" aria-label="Official Collection details">
        {release === undefined ? null : (
          <>
            <header className="inspector-heading">
              <LibraryBig aria-hidden="true" size={18} />
              <div><p>{release.collectionId}</p><h2>{release.title}</h2></div>
            </header>
            <p className="collection-description">{release.description}</p>
            <dl className="evidence-list">
              <div><dt>Status</dt><dd>{release.status}</dd></div>
              <div><dt>Independent review</dt><dd>{release.receipt.status}</dd></div>
              <div><dt>Pinned source</dt><dd><code>{release.source.repository}</code></dd></div>
              <div><dt>Reviewed revision</dt><dd><code>{release.source.reviewedRevision}</code></dd></div>
              <div><dt>Manifest digest</dt><dd><code>{release.manifestDigest}</code></dd></div>
              <div><dt>Targets selected</dt><dd>{selectedTargets.length}</dd></div>
            </dl>
            {plan === null ? null : (
              <section className="collection-plan-summary">
                <header>
                  <CheckCircle2 aria-hidden="true" size={16} />
                  <h3 ref={statusHeadingRef} tabIndex={-1}>Collection Plan</h3>
                </header>
                <p>Sequential, non-transactional</p>
                <ol>
                  {plan.order.map((child) => (
                    <li key={`${child.position}:${child.targetId}`}>
                      {child.position}. {child.names.join(", ")} / {"scope" in child ? child.scope : plan.schemaVersion === 1 ? plan.scope : "project"}
                    </li>
                  ))}
                </ol>
                <code>{plan.reviewDigest}</code>
                <button className="text-button text-button--primary" disabled={busy} onClick={() => void requestReview()} type="button">
                  <ShieldCheck aria-hidden="true" size={15} />
                  Open Trusted Review
                </button>
              </section>
            )}
          </>
        )}
      </aside>
    </>
  );
}
