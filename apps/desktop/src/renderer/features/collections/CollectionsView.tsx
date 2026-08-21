import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  LibraryBig,
  PackagePlus,
  ShieldCheck,
} from "lucide-react";

import type {
  PublicCollectionsState,
  RendererError,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";

type Release = PublicCollectionsState["releases"][number];
type Scope = "global" | "project";

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

export function CollectionsView({
  client,
  snapshot,
}: {
  readonly client: WorkspaceBridge;
  readonly snapshot: WorkspaceSnapshot;
}) {
  const collections = snapshot.collections;
  const [releaseSelection, setReleaseSelection] = useState(
    collections?.releases[0] === undefined
      ? ""
      : releaseKey(collections.releases[0]),
  );
  const [scope, setScope] = useState<Scope>("project");
  const [selected, setSelected] = useState<Record<string, "add" | "reapply">>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RendererError>();

  const release =
    collections?.releases.find(
      (candidate) => releaseKey(candidate) === releaseSelection,
    ) ?? collections?.releases[0];
  const assessment = release?.assessments.find(
    (candidate) =>
      candidate.scope === scope &&
      candidate.targetId === snapshot.target.id &&
      candidate.targetGeneration === snapshot.target.generation,
  );
  const selections = useMemo(
    () => Object.entries(selected).map(([name, mode]) => ({ mode, name })),
    [selected],
  );

  useEffect(() => setSelected({}), [releaseSelection, scope]);

  const prepare = async () => {
    if (release === undefined) return;
    setBusy(true);
    try {
      const result = await client.prepareCollection({
        collectionId: release.collectionId,
        manifestDigest: release.manifestDigest,
        releaseNumber: release.releaseNumber,
        scope,
        selections,
        targetId: snapshot.target.id,
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
              onChange={(event) =>
                setReleaseSelection(event.currentTarget.value)
              }
              value={release === undefined ? "" : releaseKey(release)}
            >
              {collections.releases.map((candidate) => (
                <option
                  key={releaseKey(candidate)}
                  value={releaseKey(candidate)}
                >
                  {candidate.title} / release {candidate.releaseNumber}
                </option>
              ))}
            </select>
          </label>
          <div
            className="segmented-control segmented-control--compact"
            aria-label="Collection scope"
          >
            {(["project", "global"] as const).map((value) => (
              <button
                aria-pressed={scope === value}
                key={value}
                onClick={() => setScope(value)}
                type="button"
              >
                {value === "project" ? "Project" : "Global"}
              </button>
            ))}
          </div>
        </div>

        {release?.blockers.map((blocker) => (
          <div
            className="state-banner state-banner--warning"
            key={blocker}
            role="status"
          >
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

        <div className="collection-table-wrap">
          <table className="collection-table">
            <caption className="sr-only">
              Official Collection assessment for the selected scope
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
                return (
                  <tr key={`${scope}:${entry.name}`}>
                    <td data-label="Select">
                      <input
                        aria-label={`Select ${entry.name}`}
                        checked={selected[entry.name] !== undefined}
                        disabled={
                          !release?.executable ||
                          !entry.selectable ||
                          mode === undefined
                        }
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelected((current) => {
                            if (!checked) {
                              const next = { ...current };
                              delete next[entry.name];
                              return next;
                            }
                            return mode === undefined
                              ? current
                              : { ...current, [entry.name]: mode };
                          });
                        }}
                        type="checkbox"
                      />
                    </td>
                    <td data-label="Skill">
                      <strong>{entry.name}</strong>
                    </td>
                    <td data-label="Assessment">
                      <span
                        className={`collection-status collection-status--${entry.status}`}
                      >
                        {statusLabels[entry.status]}
                      </span>
                    </td>
                    <td data-label="Action">
                      {mode === undefined
                        ? "Not selectable"
                        : mode === "add"
                          ? "Add"
                          : "Reapply"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      <aside
        className="inspector collection-inspector"
        aria-label="Official Collection details"
      >
        {release === undefined ? null : (
          <>
            <header className="inspector-heading">
              <LibraryBig aria-hidden="true" size={18} />
              <div>
                <p>{release.collectionId}</p>
                <h2>{release.title}</h2>
              </div>
            </header>
            <p className="collection-description">{release.description}</p>
            <dl className="evidence-list">
              <div>
                <dt>Status</dt>
                <dd>{release.status}</dd>
              </div>
              <div>
                <dt>Independent review</dt>
                <dd>{release.receipt.status}</dd>
              </div>
              <div>
                <dt>Pinned source</dt>
                <dd>
                  <code>{release.source.repository}</code>
                </dd>
              </div>
              <div>
                <dt>Reviewed revision</dt>
                <dd>
                  <code>{release.source.reviewedRevision}</code>
                </dd>
              </div>
              <div>
                <dt>Manifest digest</dt>
                <dd>
                  <code>{release.manifestDigest}</code>
                </dd>
              </div>
              <div>
                <dt>Inventory</dt>
                <dd>{assessment?.inventoryFreshness ?? "none"}</dd>
              </div>
            </dl>
            {collections.plan === null ? (
              <button
                className="text-button text-button--primary collection-primary-action"
                disabled={
                  busy ||
                  !release.executable ||
                  assessment?.compatibility !== "compatible" ||
                  assessment.inventoryFreshness !== "fresh" ||
                  selections.length === 0
                }
                onClick={() => void prepare()}
                type="button"
              >
                <PackagePlus aria-hidden="true" size={15} />
                Prepare plan
              </button>
            ) : (
              <section className="collection-plan-summary">
                <header>
                  <CheckCircle2 aria-hidden="true" size={16} />
                  <h3>Collection Plan</h3>
                </header>
                <code>{collections.plan.reviewDigest}</code>
                <button
                  className="text-button text-button--primary"
                  disabled={busy}
                  onClick={() => void requestReview()}
                  type="button"
                >
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
