import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileDown,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import type { MessageKey } from "../../../contracts/i18n/translate.js";
import type {
  PublicStudioDraft,
  PublicStudioFinding as StudioFinding,
  PublicStudioGrant,
  PublicStudioPreviewBlock as StudioPreviewBlock,
  PublicStudioPreviewInline as StudioPreviewInline,
  PublicStudioState,
  PublicStudioValidation as StudioValidation,
  RendererError,
  WorkspaceBridge,
} from "../../../contracts/workspace.js";
import { useTranslator } from "../../i18n/LocaleProvider.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";

/**
 * ADR 0018 Studio surface. This window never learns a path: folders are
 * opaque grants, Drafts are ids plus revisions, and every finding or preview
 * block is a main projection. Preview is a closed semantic vocabulary
 * rendered by React; there is no HTML injection point and nothing here can
 * navigate or fetch. Autosave is compare-and-swap on the Draft revision.
 */

const AUTOSAVE_DELAY_MS = 400;

type RequestResult = Awaited<ReturnType<WorkspaceBridge["openStudioFolder"]>>;

const findingKey = (code: StudioFinding["code"]): MessageKey =>
  `studio.finding.${code}`;

function ValidationSummary({
  validation,
}: {
  readonly validation: StudioValidation;
}) {
  const { t, tc } = useTranslator();
  const errors = validation.findings.filter(
    ({ severity }) => severity === "error",
  ).length;
  const warnings = validation.findings.length - errors;
  return (
    <div
      className={`state-banner ${validation.ok ? "state-banner--loading" : "state-banner--danger"}`}
      data-testid="studio-validation"
      role="status"
    >
      {validation.ok ? (
        <CheckCircle2 aria-hidden="true" size={16} />
      ) : (
        <AlertCircle aria-hidden="true" size={16} />
      )}
      <span>
        {validation.ok
          ? t("studio.validation.ok")
          : tc("studio.validation.errors", errors)}
        {warnings > 0 ? ` · ${tc("studio.validation.warnings", warnings)}` : ""}
        {" · "}
        {tc("studio.validation.fileCount", validation.fileCount)}
      </span>
    </div>
  );
}

function FindingList({
  findings,
}: {
  readonly findings: readonly StudioFinding[];
}) {
  const { t } = useTranslator();
  if (findings.length === 0) return null;
  return (
    <ul className="recovery-list studio-findings" data-testid="studio-findings">
      {findings.map((finding, index) => (
        <li
          className="recovery-item"
          data-severity={finding.severity}
          key={`${finding.code}:${finding.path}:${finding.line ?? 0}:${index}`}
        >
          <AlertCircle aria-hidden="true" size={14} />
          <div>
            <strong>{t(findingKey(finding.code))}</strong>
            <small>
              <code>
                {finding.path}
                {finding.line === undefined ? "" : `:${finding.line}`}
              </code>
            </small>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Inlines({
  nodes,
}: {
  readonly nodes: readonly StudioPreviewInline[];
}) {
  const { t } = useTranslator();
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case "text":
            return <span key={index}>{node.text}</span>;
          case "code":
            return <code key={index}>{node.text}</code>;
          case "emphasis":
            return (
              <em key={index}>
                <Inlines nodes={node.children} />
              </em>
            );
          case "strong":
            return (
              <strong key={index}>
                <Inlines nodes={node.children} />
              </strong>
            );
          case "link":
            return (
              <span className="studio-preview-link" key={index}>
                <Inlines nodes={node.children} />
                <small> ({node.target})</small>
              </span>
            );
          case "image":
            return (
              <span className="studio-preview-image" key={index}>
                {t("studio.preview.image", {
                  alt: node.alt,
                  target: node.target,
                })}
              </span>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function Blocks({
  blocks,
}: {
  readonly blocks: readonly StudioPreviewBlock[];
}) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const Tag = `h${block.level}` as const;
            return (
              <Tag key={index}>
                <Inlines nodes={block.children} />
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={index}>
                <Inlines nodes={block.children} />
              </p>
            );
          case "code":
            return (
              <pre data-language={block.language} key={index}>
                <code>{block.text}</code>
              </pre>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inlines nodes={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={index}>
                <Blocks blocks={block.children} />
              </blockquote>
            );
          case "rule":
            return <hr key={index} />;
          default:
            return null;
        }
      })}
    </>
  );
}

function GrantCard({
  busy,
  client,
  grant,
  onError,
}: {
  readonly busy: boolean;
  readonly client: WorkspaceBridge;
  readonly grant: PublicStudioGrant;
  readonly onError: (error: RendererError | undefined) => void;
}) {
  const { locale, t } = useTranslator();
  const run = async (request: () => Promise<RequestResult>) => {
    onError(undefined);
    const result = await request();
    if (!result.ok) onError(result.error);
  };
  return (
    <li className="recovery-item studio-grant" data-testid="studio-grant">
      <FolderOpen aria-hidden="true" size={16} />
      <div className="studio-grant-body">
        <strong>{grant.label}</strong>
        <small>
          {t("studio.folders.grantedAt", {
            time: new Date(grant.grantedAt).toLocaleString(locale),
          })}
        </small>
        <ValidationSummary validation={grant.validation} />
        <FindingList findings={grant.validation.findings} />
        <div className="publish-actions">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void run(() => client.validateStudioGrant(grant.id))}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={15} />
            {t("studio.folders.revalidate")}
          </button>
          <button
            className="text-button"
            disabled={busy || !grant.validation.ok}
            onClick={() => void run(() => client.createStudioDraft(grant.id))}
            type="button"
          >
            <FilePlus2 aria-hidden="true" size={15} />
            {t("studio.folders.draftFrom")}
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void run(() => client.releaseStudioGrant(grant.id))}
            type="button"
          >
            <X aria-hidden="true" size={15} />
            {t("studio.folders.release")}
          </button>
        </div>
      </div>
    </li>
  );
}

interface Editing {
  readonly draftId: string;
  readonly revision: number;
  readonly text: string;
}

function DraftEditor({
  busy,
  client,
  draft,
  hostAvailable,
  onError,
  preview,
}: {
  readonly busy: boolean;
  readonly client: WorkspaceBridge;
  readonly draft: PublicStudioDraft;
  readonly hostAvailable: boolean;
  readonly onError: (error: RendererError | undefined) => void;
  readonly preview: PublicStudioState["preview"];
}) {
  const { locale, t } = useTranslator();
  const [editing, setEditing] = useState<Editing>({
    draftId: draft.id,
    revision: draft.revision,
    text: draft.skillMd,
  });
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const savingRef = useRef(false);

  const reload = () => {
    setEditing({
      draftId: draft.id,
      revision: draft.revision,
      text: draft.skillMd,
    });
    setConflict(false);
    onError(undefined);
  };

  useEffect(() => {
    if (editing.draftId !== draft.id) {
      reload();
      return;
    }
    // Another window (or a restore) moved the Draft past what we hold.
    if (!savingRef.current && draft.revision !== editing.revision) {
      setConflict(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, draft.revision]);

  useEffect(() => {
    if (conflict || saving || editing.draftId !== draft.id) return;
    if (editing.text === draft.skillMd) return;
    const timer = setTimeout(() => {
      savingRef.current = true;
      setSaving(true);
      void client
        .saveStudioDraft(draft.id, editing.revision, editing.text)
        .then((result) => {
          if (result.ok) {
            setEditing((current) =>
              current.draftId === draft.id
                ? { ...current, revision: editing.revision + 1 }
                : current,
            );
            onError(undefined);
          } else if (result.error.code === "studio_draft_conflict") {
            setConflict(true);
          } else {
            onError(result.error);
          }
        })
        .finally(() => {
          savingRef.current = false;
          setSaving(false);
        });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editing.text,
    editing.revision,
    conflict,
    saving,
    draft.id,
    draft.skillMd,
  ]);

  const act = async (request: () => Promise<RequestResult>) => {
    onError(undefined);
    const result = await request();
    if (!result.ok) onError(result.error);
  };

  const dirty = editing.text !== draft.skillMd;
  const exportBlocked = !draft.validation.ok || draft.name === "";

  return (
    <div className="studio-editor" data-testid="studio-editor">
      {conflict ? (
        <div className="state-banner state-banner--danger" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <span>{t("studio.drafts.conflict")}</span>
          <button className="text-button" onClick={reload} type="button">
            <RotateCcw aria-hidden="true" size={15} />
            {t("studio.drafts.reload")}
          </button>
        </div>
      ) : null}
      <dl className="target-facts">
        <div>
          <dt>{t("studio.drafts.name")}</dt>
          <dd>
            {draft.name === "" ? t("studio.drafts.untitled") : draft.name}
          </dd>
        </div>
        <div>
          <dt>{t("studio.drafts.revision")}</dt>
          <dd data-testid="studio-draft-revision">{editing.revision}</dd>
        </div>
        <div>
          <dt>{t("studio.drafts.updatedAt")}</dt>
          <dd>{new Date(draft.updatedAt).toLocaleString(locale)}</dd>
        </div>
      </dl>
      <label className="studio-editor-field">
        <span>{t("studio.editor.label")}</span>
        <textarea
          aria-describedby="studio-editor-hint"
          className="studio-editor-textarea"
          data-testid="studio-editor-textarea"
          disabled={conflict}
          onChange={(event) =>
            setEditing((current) => ({ ...current, text: event.target.value }))
          }
          rows={18}
          spellCheck={false}
          value={editing.text}
        />
      </label>
      <p className="studio-editor-status" id="studio-editor-hint" role="status">
        {saving
          ? t("studio.drafts.saving")
          : dirty
            ? t("studio.drafts.unsaved")
            : t("studio.drafts.saved")}
      </p>
      <ValidationSummary validation={draft.validation} />
      <FindingList findings={draft.validation.findings} />
      <div className="publish-actions">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void act(() => client.previewStudioDraft(draft.id))}
          type="button"
        >
          <Eye aria-hidden="true" size={15} />
          {t("studio.preview.show")}
        </button>
        <button
          className="text-button text-button--primary"
          data-testid="studio-export"
          disabled={busy || exportBlocked || !hostAvailable || dirty}
          onClick={() => void act(() => client.exportStudioDraft(draft.id))}
          title={exportBlocked ? t("studio.export.blocked") : undefined}
          type="button"
        >
          <FileDown aria-hidden="true" size={15} />
          {t("studio.export.action")}
        </button>
        <button
          className="text-button text-button--danger"
          disabled={busy}
          onClick={() =>
            void act(() => client.deleteStudioDraft(draft.id, editing.revision))
          }
          type="button"
        >
          <Trash2 aria-hidden="true" size={15} />
          {t("studio.drafts.delete")}
        </button>
      </div>
      {preview !== null && preview.draftId === draft.id ? (
        <section
          aria-labelledby="studio-preview-heading"
          className="studio-preview"
          data-testid="studio-preview"
        >
          <h3 id="studio-preview-heading">
            {t("studio.preview.heading")}
            {preview.revision !== editing.revision ? (
              <small> · {t("studio.preview.stale")}</small>
            ) : null}
          </h3>
          <div className="studio-preview-body">
            <Blocks blocks={preview.preview.blocks} />
            {preview.preview.truncated ? (
              <p className="studio-preview-truncated">
                {t("studio.preview.truncated")}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function StudioView({
  client,
  studio,
}: {
  readonly client: WorkspaceBridge;
  readonly studio: PublicStudioState | undefined;
}) {
  const { locale, t, tc } = useTranslator();
  const [error, setError] = useState<RendererError>();
  const [selectedId, setSelectedId] = useState<string>();
  const [pending, setPending] = useState(false);

  if (studio === undefined) {
    return (
      <main className="recovery-workspace" id="workspace-main" tabIndex={-1}>
        <section className="page-heading">
          <div>
            <h1>{t("studio.title")}</h1>
            <p>{t("studio.unavailable")}</p>
          </div>
        </section>
      </main>
    );
  }

  const busy = studio.activeOperationId !== null || pending;
  const shownError = error ?? studio.lastError ?? undefined;
  const selected =
    studio.drafts.find(({ id }) => id === selectedId) ?? studio.drafts[0];

  const run = async (request: () => Promise<RequestResult>) => {
    setPending(true);
    setError(undefined);
    const result = await request();
    setPending(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <main className="recovery-workspace" id="workspace-main" tabIndex={-1}>
      <section className="page-heading">
        <div>
          <h1>{t("studio.title")}</h1>
          <p>{t("studio.subtitle")}</p>
        </div>
      </section>

      {shownError !== undefined ? (
        <div className="state-banner state-banner--danger" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <UserFacingErrorCopy error={shownError} />
        </div>
      ) : null}

      {!studio.available ? (
        <div className="state-banner" role="status">
          <AlertCircle aria-hidden="true" size={16} />
          <span>{t("studio.hostUnavailable")}</span>
        </div>
      ) : null}

      {studio.lastExport !== null ? (
        <div
          className="state-banner state-banner--loading"
          data-testid="studio-export-written"
          role="status"
        >
          <CheckCircle2 aria-hidden="true" size={16} />
          <span>
            {t("studio.export.written", {
              label: studio.lastExport.destinationLabel,
              name: studio.lastExport.name,
              time: new Date(studio.lastExport.writtenAt).toLocaleString(
                locale,
              ),
            })}
          </span>
        </div>
      ) : null}

      <section
        aria-labelledby="studio-folders-heading"
        className="recovery-section"
      >
        <h2 id="studio-folders-heading">{t("studio.folders.heading")}</h2>
        <p>{t("studio.folders.body")}</p>
        {studio.grants.length === 0 ? (
          <p>{t("studio.folders.none")}</p>
        ) : (
          <ul className="recovery-list">
            {studio.grants.map((grant) => (
              <GrantCard
                busy={busy}
                client={client}
                grant={grant}
                key={grant.id}
                onError={setError}
              />
            ))}
          </ul>
        )}
        <button
          className="text-button"
          data-testid="studio-open-folder"
          disabled={busy || !studio.available}
          onClick={() => void run(() => client.openStudioFolder())}
          type="button"
        >
          {busy && studio.activeOperationId !== null ? (
            <LoaderCircle aria-hidden="true" className="spin" size={15} />
          ) : (
            <FolderOpen aria-hidden="true" size={15} />
          )}
          {t("studio.folders.open")}
        </button>
      </section>

      <section
        aria-labelledby="studio-drafts-heading"
        className="recovery-section"
      >
        <h2 id="studio-drafts-heading">{t("studio.drafts.heading")}</h2>
        <p>{t("studio.drafts.body")}</p>
        {studio.draftFailures.length > 0 ? (
          <div className="state-banner state-banner--danger" role="status">
            <AlertCircle aria-hidden="true" size={16} />
            <span>
              {tc("studio.drafts.quarantined", studio.draftFailures.length)}
            </span>
          </div>
        ) : null}
        <div className="publish-actions">
          <button
            className="text-button"
            data-testid="studio-new-draft"
            disabled={busy}
            onClick={() => void run(() => client.createStudioDraft())}
            type="button"
          >
            <FilePlus2 aria-hidden="true" size={15} />
            {t("studio.drafts.new")}
          </button>
          {studio.drafts.length > 0 ? (
            <label className="studio-draft-select">
              <span>{t("studio.drafts.select")}</span>
              <select
                data-testid="studio-draft-select"
                onChange={(event) => setSelectedId(event.target.value)}
                value={selected?.id ?? ""}
              >
                {studio.drafts.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.name === ""
                      ? t("studio.drafts.untitled")
                      : draft.name}
                    {` · r${draft.revision}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {selected === undefined ? (
          <p>{t("studio.drafts.none")}</p>
        ) : (
          <DraftEditor
            busy={busy}
            client={client}
            draft={selected}
            hostAvailable={studio.available}
            key={selected.id}
            onError={setError}
            preview={studio.preview}
          />
        )}
      </section>
    </main>
  );
}
