import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileDown,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import type { MessageKey } from "../../../contracts/i18n/translate.js";
import type {
  PublicPublicationState,
  RendererError,
  WorkspaceBridge,
} from "../../../contracts/workspace.js";
import { useTranslator } from "../../i18n/LocaleProvider.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";

/**
 * ADR 0019 / ADR 0020 Publish surface. The renderer never learns a path or a
 * Git argument: it names main-owned grants and plan ids and forwards exactly
 * two user strings (remote text, branch name) that main sanitizes. Every fact
 * shown here is a main projection; approval happens in the Trusted Review.
 */

const outcomeKey = (
  status: NonNullable<PublicPublicationState["lastOutcome"]>["status"],
): MessageKey => `publish.outcome.${status}`;

function shortCommit(commit: string): string {
  return commit.slice(0, 12);
}

export function PublishView({
  client,
  publication,
}: {
  readonly client: WorkspaceBridge;
  readonly publication: PublicPublicationState | undefined;
}) {
  const { locale, t, tc } = useTranslator();
  const [remote, setRemote] = useState("");
  const [branch, setBranch] = useState("main");
  const [error, setError] = useState<RendererError>();
  const [pending, setPending] = useState<string>();

  const formatTime = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed)
      ? value
      : new Date(parsed).toLocaleString(locale);
  };

  const run = async (
    label: string,
    request: () => Promise<
      Awaited<ReturnType<WorkspaceBridge["choosePublicationSource"]>>
    >,
  ) => {
    setPending(label);
    setError(undefined);
    const result = await request();
    setPending(undefined);
    if (!result.ok) setError(result.error);
  };

  if (publication === undefined || !publication.available) {
    return (
      <main className="recovery-workspace" id="workspace-main" tabIndex={-1}>
        <section className="page-heading">
          <div>
            <h1>{t("publish.title")}</h1>
            <p>{t("publish.unavailable")}</p>
          </div>
        </section>
      </main>
    );
  }

  const busy = publication.activeOperationId !== null || pending !== undefined;
  const { export: lastExport, guard, lastOutcome, plan, source } = publication;
  const shownError = error ?? publication.lastError ?? undefined;

  return (
    <main className="recovery-workspace" id="workspace-main" tabIndex={-1}>
      <section className="page-heading">
        <div>
          <h1>{t("publish.title")}</h1>
          <p>{t("publish.subtitle")}</p>
        </div>
      </section>

      {shownError !== undefined ? (
        <div className="state-banner state-banner--danger" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <UserFacingErrorCopy error={shownError} />
        </div>
      ) : null}

      {guard !== null ? (
        <section
          aria-labelledby="publish-guard-heading"
          className="recovery-section"
          data-testid="publish-guard"
        >
          <h2 id="publish-guard-heading">{t("publish.guard.heading")}</h2>
          <p>
            {t("publish.guard.body", {
              branch: guard.plan.branch,
              remote: guard.plan.remote.url,
            })}
          </p>
          <dl className="target-facts">
            <div>
              <dt>{t("publish.guard.committedAt")}</dt>
              <dd>{formatTime(guard.committedAt)}</dd>
            </div>
            <div>
              <dt>{t("publish.guard.lastReadback")}</dt>
              <dd>
                {guard.lastReadback === null
                  ? t("review.notReviewedYet")
                  : t(outcomeKey(guard.lastReadback))}
              </dd>
            </div>
            <div>
              <dt>{t("review.publication.candidateCommit")}</dt>
              <dd>
                <code>{guard.plan.candidateCommit}</code>
              </dd>
            </div>
          </dl>
          <button
            className="text-button text-button--primary"
            disabled={busy}
            onClick={() =>
              void run("reconcile", () => client.reconcilePublication())
            }
            type="button"
          >
            {publication.phase === "reconciling" ? (
              <LoaderCircle aria-hidden="true" className="spin" size={15} />
            ) : (
              <RotateCcw aria-hidden="true" size={15} />
            )}
            {t(
              publication.phase === "reconciling"
                ? "publish.guard.reconciling"
                : "publish.guard.reconcile",
            )}
          </button>
        </section>
      ) : null}

      {lastOutcome !== null ? (
        <section
          aria-labelledby="publish-outcome-heading"
          className="recovery-section"
          data-testid="publish-outcome"
        >
          <h2 id="publish-outcome-heading">{t("publish.outcome.heading")}</h2>
          <ul className="recovery-list">
            <li className="recovery-item">
              {lastOutcome.status === "published" ? (
                <CheckCircle2 aria-hidden="true" size={16} />
              ) : (
                <AlertCircle aria-hidden="true" size={16} />
              )}
              <div>
                <strong data-testid="publish-outcome-status">
                  {t(outcomeKey(lastOutcome.status))}
                </strong>
                <small>
                  {t("publish.outcome.detail", {
                    branch: lastOutcome.branch,
                    commit: shortCommit(lastOutcome.candidateCommit),
                    remote: lastOutcome.remote.url,
                    time: formatTime(lastOutcome.recordedAt),
                  })}
                </small>
                <small>
                  {lastOutcome.observedCommit === undefined
                    ? t("publish.outcome.observedUnknown")
                    : lastOutcome.observedCommit === null
                      ? t("publish.outcome.observedAbsent")
                      : t("publish.outcome.observed", {
                          commit: shortCommit(lastOutcome.observedCommit),
                        })}
                </small>
              </div>
            </li>
          </ul>
        </section>
      ) : null}

      <section
        aria-labelledby="publish-source-heading"
        className="recovery-section"
      >
        <h2 id="publish-source-heading">{t("publish.source.heading")}</h2>
        <p>{t("publish.source.body")}</p>
        {source === null ? (
          <p>{t("publish.source.none")}</p>
        ) : (
          <dl className="target-facts" data-testid="publish-source">
            <div>
              <dt>{t("common.skills")}</dt>
              <dd>{source.skills.join(", ")}</dd>
            </div>
            <div>
              <dt>{source.label}</dt>
              <dd>{tc("publish.source.fileCount", source.fileCount)}</dd>
            </div>
            <div>
              <dt>{t("review.publication.treeDigest")}</dt>
              <dd>
                <code>{source.treeDigest}</code>
              </dd>
            </div>
            <div>
              <dt>{t("publish.source.chosenAt")}</dt>
              <dd>{formatTime(source.chosenAt)}</dd>
            </div>
          </dl>
        )}
        <button
          className="text-button"
          data-testid="publish-choose-source"
          disabled={busy}
          onClick={() =>
            void run("choose", () => client.choosePublicationSource())
          }
          type="button"
        >
          {publication.phase === "choosing" ? (
            <LoaderCircle aria-hidden="true" className="spin" size={15} />
          ) : (
            <FolderOpen aria-hidden="true" size={15} />
          )}
          {t(
            publication.phase === "choosing"
              ? "publish.source.choosing"
              : "publish.source.choose",
          )}
        </button>
      </section>

      <section
        aria-labelledby="publish-export-heading"
        className="recovery-section"
      >
        <h2 id="publish-export-heading">{t("publish.export.heading")}</h2>
        <p>{t("publish.export.body")}</p>
        {lastExport !== null ? (
          <div className="state-banner state-banner--loading" role="status">
            <CheckCircle2 aria-hidden="true" size={16} />
            <span>
              {t("publish.export.written", {
                label: lastExport.destinationLabel,
                time: formatTime(lastExport.writtenAt),
              })}
            </span>
          </div>
        ) : null}
        <button
          className="text-button"
          data-testid="publish-export"
          disabled={busy || source === null}
          onClick={() => void run("export", () => client.exportPublication())}
          type="button"
        >
          {publication.phase === "exporting" ? (
            <LoaderCircle aria-hidden="true" className="spin" size={15} />
          ) : (
            <FileDown aria-hidden="true" size={15} />
          )}
          {t(
            publication.phase === "exporting"
              ? "publish.export.exporting"
              : "publish.export.action",
          )}
        </button>
      </section>

      <section
        aria-labelledby="publish-git-heading"
        className="recovery-section"
      >
        <h2 id="publish-git-heading">{t("publish.git.heading")}</h2>
        <p>{t("publish.git.body")}</p>
        {plan === null ? (
          <form
            className="target-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run("prepare", () =>
                client.preparePublication(remote.trim(), branch.trim()),
              );
            }}
          >
            <label>
              <span>{t("publish.git.remote")}</span>
              <input
                autoComplete="off"
                data-testid="publish-remote"
                maxLength={512}
                onChange={(event) => setRemote(event.currentTarget.value)}
                placeholder="https://github.com/owner/repository.git"
                required
                spellCheck={false}
                value={remote}
              />
              <small>{t("publish.git.remoteHint")}</small>
            </label>
            <label>
              <span>{t("publish.git.branch")}</span>
              <input
                autoComplete="off"
                data-testid="publish-branch"
                maxLength={200}
                onChange={(event) => setBranch(event.currentTarget.value)}
                required
                spellCheck={false}
                value={branch}
              />
            </label>
            <button
              className="text-button text-button--primary"
              data-testid="publish-plan"
              disabled={busy || source === null || guard !== null}
              type="submit"
            >
              {publication.phase === "preparing" ? (
                <LoaderCircle aria-hidden="true" className="spin" size={15} />
              ) : (
                <GitBranch aria-hidden="true" size={15} />
              )}
              {t(
                publication.phase === "preparing"
                  ? "publish.git.planning"
                  : "publish.git.plan",
              )}
            </button>
          </form>
        ) : (
          <div data-testid="publish-plan-summary">
            <div className="state-banner state-banner--loading" role="status">
              <ShieldCheck aria-hidden="true" size={16} />
              <span>
                {t(
                  publication.phase === "pushing"
                    ? "publish.git.pushing"
                    : "publish.git.planReady",
                )}
              </span>
              <strong>
                {t("publish.git.planExpires", {
                  time: formatTime(plan.expiresAt),
                })}
              </strong>
            </div>
            <dl className="target-facts">
              <div>
                <dt>{t("review.publication.remote")}</dt>
                <dd>{plan.remote.url}</dd>
              </div>
              <div>
                <dt>{t("review.publication.branch")}</dt>
                <dd>{plan.branch}</dd>
              </div>
              <div>
                <dt>{t("review.publication.base")}</dt>
                <dd>
                  {plan.base.kind === "unborn" ? (
                    t("review.publication.base.unborn")
                  ) : (
                    <code>{shortCommit(plan.base.commit)}</code>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("review.publication.candidateCommit")}</dt>
                <dd>
                  <code>{shortCommit(plan.candidateCommit)}</code>
                </dd>
              </div>
              <div>
                <dt>{t("review.publication.planDigest")}</dt>
                <dd>
                  <code>{plan.planDigest}</code>
                </dd>
              </div>
            </dl>
            <div className="publish-actions">
              <button
                className="text-button text-button--primary"
                data-testid="publish-review"
                disabled={busy}
                onClick={() =>
                  void run("review", () =>
                    client.requestPublicationReview(plan.id),
                  )
                }
                type="button"
              >
                <ShieldCheck aria-hidden="true" size={15} />
                {t("publish.git.review")}
              </button>
              <button
                className="text-button text-button--danger"
                data-testid="publish-discard"
                disabled={busy}
                onClick={() =>
                  void run("discard", () => client.discardPublication(plan.id))
                }
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                {t("publish.git.discard")}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
