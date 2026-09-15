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
import type { MessageKey } from "../../../contracts/i18n/translate.js";
import { useTranslator } from "../../i18n/LocaleProvider.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";
import { HarnessPicker } from "./HarnessPicker.js";

type TargetState = NonNullable<WorkspaceSnapshot["targets"]>[number];

function inventoryPill(state: TargetState): {
  readonly label: MessageKey;
  readonly tone: "healthy" | "neutral" | "warning";
} {
  if (state.inventory.phase === "loading") {
    return { label: "targets.pill.loading", tone: "neutral" };
  }
  if (state.inventory.freshness === "fresh") {
    return { label: "targets.pill.fresh", tone: "healthy" };
  }
  if (state.inventory.freshness === "stale") {
    return { label: "targets.pill.stale", tone: "warning" };
  }
  return { label: "targets.pill.none", tone: "neutral" };
}


const blankTarget = (): TargetDraft => ({
  connectionReference: null,
  harnessIds: ["codex"],
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
  const { t, tc } = useTranslator();
  const [editingTargetId, setEditingTargetId] = useState<string>();
  const [draft, setDraft] = useState<TargetDraft>(blankTarget);
  const [error, setError] = useState<RendererError>();
  const [savedMessage, setSavedMessage] = useState<MessageKey>();

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
            harnessIds: [...state.target.harnessIds],
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
        editingTargetId === undefined ? "targets.created" : "targets.updated",
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
      setSavedMessage("targets.deleted");
      const remaining = targets.find(
        ({ target }) => target.id !== state.target.id,
      );
      if (remaining !== undefined) onSelected(remaining.target.id);
    } else setError(result.error);
  };

  return (
    <>
      <main className="targets-workspace" id="workspace-main" tabIndex={-1}>
        <section className="page-heading">
          <div>
            <h1>{t("targets.title")}</h1>
            <p>{tc("targets.subtitle", targets.length)}</p>
          </div>
          <button className="text-button" onClick={() => edit()} type="button">
            <Plus aria-hidden="true" size={15} />
            {t("targets.new")}
          </button>
        </section>
        {error !== undefined ? (
          <div className="state-banner state-banner--danger" role="alert">
            <AlertCircle aria-hidden="true" size={16} />
            <UserFacingErrorCopy error={error} />
          </div>
        ) : null}
        {savedMessage !== undefined ? (
          <div className="state-banner state-banner--loading" role="status">
            <Save aria-hidden="true" size={16} />
            <span>{t(savedMessage)}</span>
          </div>
        ) : null}
        <div className="target-list">
          {targets.map((state) => {
            const pill = inventoryPill(state);
            return (
            <article
              className={
                state.target.kind === "ssh"
                  ? "target-item target-item--ssh-demoted"
                  : "target-item"
              }
              key={state.target.id}
            >
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
                {state.target.kind === "ssh" ? (
                  <span
                    aria-label={t("common.ssh.badgeLabel")}
                    className="scope-badge"
                    title={t("common.ssh.notInV1")}
                  >
                    {t("common.ssh.badge")}
                  </span>
                ) : null}
                <span className={`status-pill status-pill--${pill.tone}`}>
                  {t(pill.label)}
                </span>
              </header>
              <dl>
                <div>
                  <dt>{t("targets.kind")}</dt>
                  <dd>
                    {state.target.kind === "local"
                      ? t("common.local")
                      : t("common.ssh.notInV1")}
                  </dd>
                </div>
                <div>
                  <dt>{t("common.harness")}</dt>
                  <dd>{state.target.harnessIds.join(", ")}</dd>
                </div>
                <div>
                  <dt>{t("targets.connection")}</dt>
                  <dd>
                    {state.target.kind === "ssh"
                      ? (state.target.connectionReference ?? t("targets.sshHost"))
                      : t("targets.thisDevice")}
                  </dd>
                </div>
              </dl>
              <details className="target-item-advanced">
                <summary>{t("targets.advanced")}</summary>
                <dl>
                  <div>
                    <dt>{t("targets.generation")}</dt>
                    <dd>{state.target.generation}</dd>
                  </div>
                </dl>
              </details>
              {state.inventory.lastError !== null ? (
                <div className="target-state-error" role="status">
                  <UserFacingErrorCopy error={state.inventory.lastError} />
                </div>
              ) : null}
              <div className="target-item-actions">
                <button
                  aria-label={t("targets.edit", { label: state.target.label })}
                  className="icon-button"
                  onClick={() => edit(state)}
                  title={t("targets.edit", { label: state.target.label })}
                  type="button"
                >
                  <Pencil aria-hidden="true" size={15} />
                </button>
                <button
                  aria-label={t("targets.delete", { label: state.target.label })}
                  className="icon-button icon-button--danger"
                  disabled={state.deletionBlocked}
                  onClick={() => void remove(state)}
                  title={
                    state.deletionBlocked
                      ? t("targets.deletionBlocked")
                      : t("targets.delete", { label: state.target.label })
                  }
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            </article>
            );
          })}
        </div>
      </main>

      <aside
        className="inspector target-editor"
        aria-label={t("targets.editor.label")}
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
                ? t("targets.editor.new")
                : t("targets.editor.edit")}
            </p>
            <h2>{draft.label || t("targets.editor.untitled")}</h2>
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
              <span>{t("targets.editor.sshBanner")}</span>
            </div>
          ) : null}
          <fieldset>
            <legend>{t("targets.editor.kind")}</legend>
            {draft.kind === "ssh" ? (
              <p className="target-kind-readonly">
                {t("targets.editor.kindSsh")}
              </p>
            ) : (
              <div className="segmented-control segmented-control--compact">
                <button aria-pressed={true} type="button">
                  {t("common.local")}
                </button>
              </div>
            )}
          </fieldset>
          <label>
            <span>{t("targets.editor.displayLabel")}</span>
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
            <span>{t("targets.editor.workspace")}</span>
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
          <HarnessPicker
            disabled={draft.kind === "ssh"}
            onChange={(harnessIds) =>
              setDraft({ ...draft, harnessIds: [...harnessIds] })
            }
            value={draft.harnessIds}
          />
          {draft.kind === "ssh" ? (
            <label>
              <span>{t("targets.editor.connectionReference")}</span>
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
              draft.kind === "ssh" ? t("targets.editor.sshCannotSave") : undefined
            }
            type="submit"
          >
            <Save aria-hidden="true" size={15} />
            {t("targets.editor.save")}
          </button>
        </form>
      </aside>
    </>
  );
}
