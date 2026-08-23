import { useEffect, useState } from "react";
import {
  AlertCircle,
  HardDrive,
  Pencil,
  Plus,
  Save,
  Server,
  Trash2,
} from "lucide-react";

import type {
  RendererError,
  TargetDraft,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";

type TargetState = NonNullable<WorkspaceSnapshot["targets"]>[number];

const blankTarget = (): TargetDraft => ({
  connectionReference: null,
  harness: "Codex",
  kind: "local",
  label: "",
  workspace: "",
});

export function TargetsView({
  client,
  onSelected,
  targets,
}: {
  readonly client: WorkspaceBridge;
  readonly onSelected: (targetId: string) => void;
  readonly targets: readonly TargetState[];
}) {
  const [editingTargetId, setEditingTargetId] = useState<string>();
  const [draft, setDraft] = useState<TargetDraft>(blankTarget);
  const [error, setError] = useState<RendererError>();
  const [savedMessage, setSavedMessage] = useState<string>();

  useEffect(() => {
    if (
      editingTargetId !== undefined &&
      !targets.some(({ target }) => target.id === editingTargetId)
    ) {
      setEditingTargetId(undefined);
      setDraft(blankTarget());
    }
  }, [editingTargetId, targets]);

  const edit = (state?: TargetState) => {
    setError(undefined);
    setSavedMessage(undefined);
    setEditingTargetId(state?.target.id);
    setDraft(
      state === undefined
        ? blankTarget()
        : {
            connectionReference: state.target.connectionReference ?? null,
            harness: state.target.harness,
            kind: state.target.kind,
            label: state.target.label,
            workspace: state.target.workspace ?? "",
          },
    );
  };

  const save = async () => {
    const result =
      editingTargetId === undefined
        ? await client.createTarget(draft)
        : await client.updateTarget(editingTargetId, draft);
    if (result.ok) {
      setError(undefined);
      setSavedMessage(
        editingTargetId === undefined ? "Target created" : "Target updated",
      );
      onSelected(result.value.operationId);
      if (editingTargetId === undefined)
        setEditingTargetId(result.value.operationId);
    } else setError(result.error);
  };

  const remove = async (state: TargetState) => {
    const result = await client.deleteTarget(state.target.id);
    if (result.ok) {
      setError(undefined);
      setSavedMessage("Target deleted");
      const remaining = targets.find(
        ({ target }) => target.id !== state.target.id,
      );
      if (remaining !== undefined) onSelected(remaining.target.id);
    } else setError(result.error);
  };

  return (
    <>
      <main className="targets-workspace">
        <section className="page-heading">
          <div>
            <h1>Targets</h1>
            <p>{targets.length} Target Definitions · V1 is Local-only</p>
          </div>
          <button className="text-button" onClick={() => edit()} type="button">
            <Plus aria-hidden="true" size={15} />
            New Target
          </button>
        </section>
        {error !== undefined ? (
          <div className="state-banner state-banner--danger" role="alert">
            <AlertCircle aria-hidden="true" size={16} />
            <span>{error.message}</span>
          </div>
        ) : null}
        {savedMessage !== undefined ? (
          <div className="state-banner state-banner--loading" role="status">
            <Save aria-hidden="true" size={16} />
            <span>{savedMessage}</span>
          </div>
        ) : null}
        <div className="target-list">
          {targets.map((state) => (
            <article className="target-item" key={state.target.id}>
              <header>
                {state.target.kind === "local" ? (
                  <HardDrive aria-hidden="true" size={18} />
                ) : (
                  <Server aria-hidden="true" size={18} />
                )}
                <div>
                  <h2>{state.target.label}</h2>
                  <code>{state.target.workspace}</code>
                </div>
                <span
                  className={`status-pill status-pill--${state.inventory.freshness === "fresh" ? "healthy" : "neutral"}`}
                >
                  {state.inventory.phase === "loading"
                    ? "loading"
                    : state.inventory.freshness}
                </span>
              </header>
              <dl>
                <div>
                  <dt>Kind</dt>
                  <dd>{state.target.kind === "local" ? "Local" : "SSH · next-scope"}</dd>
                </div>
                <div>
                  <dt>Harness</dt>
                  <dd>{state.target.harness}</dd>
                </div>
                <div>
                  <dt>Generation</dt>
                  <dd>{state.target.generation}</dd>
                </div>
                <div>
                  <dt>Connection</dt>
                  <dd>{state.target.connectionReference ?? "Local process"}</dd>
                </div>
              </dl>
              {state.inventory.lastError !== null ? (
                <p className="target-state-error" role="status">
                  {state.inventory.lastError.message}
                </p>
              ) : null}
              <div className="target-item-actions">
                <button
                  aria-label={`Edit ${state.target.label}`}
                  className="icon-button"
                  onClick={() => edit(state)}
                  title={`Edit ${state.target.label}`}
                  type="button"
                >
                  <Pencil aria-hidden="true" size={15} />
                </button>
                <button
                  aria-label={`Delete ${state.target.label}`}
                  className="icon-button icon-button--danger"
                  disabled={state.deletionBlocked}
                  onClick={() => void remove(state)}
                  title={
                    state.deletionBlocked
                      ? "Target deletion is blocked"
                      : `Delete ${state.target.label}`
                  }
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </main>

      <aside
        className="inspector target-editor"
        aria-label="Target Definition editor"
      >
        <header className="inspector-heading">
          {draft.kind === "local" ? (
            <HardDrive aria-hidden="true" size={18} />
          ) : (
            <Server aria-hidden="true" size={18} />
          )}
          <div>
            <p>
              {editingTargetId === undefined
                ? "New Definition"
                : "Edit Definition"}
            </p>
            <h2>{draft.label || "Untitled Target"}</h2>
          </div>
        </header>
        <form
          className="target-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {draft.kind === "ssh" ? (
            <div className="state-banner state-banner--loading" role="status">
              <Server aria-hidden="true" size={16} />
              <span>
                SSH targets are next-scope and outside the V1 Local
                commitment.
              </span>
            </div>
          ) : null}
          <fieldset>
            <legend>Target kind</legend>
            {draft.kind === "ssh" ? (
              <p className="target-kind-readonly">
                Kind: SSH (next-scope, not V1)
              </p>
            ) : (
              <div className="segmented-control segmented-control--compact">
                <button aria-pressed={true} type="button">
                  Local
                </button>
              </div>
            )}
          </fieldset>
          <label>
            <span>Display label</span>
            <input
              maxLength={256}
              onChange={(event) =>
                setDraft({ ...draft, label: event.currentTarget.value })
              }
              readOnly={draft.kind === "ssh"}
              required
              value={draft.label}
            />
          </label>
          <label>
            <span>Canonical workspace</span>
            <input
              maxLength={4096}
              onChange={(event) =>
                setDraft({ ...draft, workspace: event.currentTarget.value })
              }
              readOnly={draft.kind === "ssh"}
              required
              value={draft.workspace}
            />
          </label>
          <label>
            <span>Harness</span>
            <select
              disabled={draft.kind === "ssh"}
              onChange={(event) =>
                setDraft({ ...draft, harness: event.currentTarget.value })
              }
              value={draft.harness}
            >
              <option value="Codex">Codex</option>
            </select>
          </label>
          {draft.kind === "ssh" ? (
            <label>
              <span>OpenSSH connection reference</span>
              <input
                maxLength={256}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    connectionReference: event.currentTarget.value,
                  })
                }
                readOnly
                required
                value={draft.connectionReference ?? ""}
              />
            </label>
          ) : null}
          <button
            className="text-button text-button--primary"
            disabled={draft.kind === "ssh"}
            title={
              draft.kind === "ssh"
                ? "SSH Targets are next-scope and cannot be saved in V1"
                : undefined
            }
            type="submit"
          >
            <Save aria-hidden="true" size={15} />
            Save Target
          </button>
        </form>
      </aside>
    </>
  );
}
