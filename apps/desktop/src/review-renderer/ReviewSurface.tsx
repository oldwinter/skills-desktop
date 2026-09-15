import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Check, Clock3, ShieldCheck, X } from "lucide-react";

import {
  REVIEW_PROTOCOL_VERSION,
  type ReviewBridge,
  type ReviewSnapshot,
} from "../contracts/review.js";
import { describeHarnessEffect } from "../contracts/harness-effect.js";
import { describeCommandPlanSource } from "../contracts/source-disclosure.js";
import type { MessageKey, Translator } from "../contracts/i18n/translate.js";
import type { Locale } from "../contracts/preferences.js";
import { userFacingErrorMessage } from "../contracts/user-facing-error.js";
import type {
  CommandPlan,
  PublicCollectionPlan,
  RendererError,
} from "../contracts/workspace.js";
import {
  LocaleProvider,
  useDocumentPreferences,
  useTranslator,
} from "../renderer/i18n/LocaleProvider.js";

function scopeLabel(t: Translator["t"], scope: "global" | "project") {
  return t(
    scope === "project" ? "common.scope.project" : "common.scope.global",
  );
}

function formatReviewInstant(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return iso;
  }
}

function ReviewInstant({ value }: { readonly value: string | null }) {
  const { locale, t } = useTranslator();
  if (value === null) return <span>{t("review.notReviewedYet")}</span>;
  return <time dateTime={value}>{formatReviewInstant(locale, value)}</time>;
}

function HarnessEffectDisclosure({
  commandPlan,
}: {
  readonly commandPlan: CommandPlan;
}) {
  const { locale } = useTranslator();
  const effect = describeHarnessEffect(commandPlan, locale);
  return (
    <section
      aria-labelledby="review-effect-heading"
      className={`review-effect review-effect--${effect.kind}`}
      data-testid="review-harness-effect"
    >
      <h2 id="review-effect-heading">{effect.title}</h2>
      <p>{effect.summary}</p>
    </section>
  );
}

/**
 * ADR 0015: an add plan discloses its source and whether that source can
 * still move before execution, so a mutable listing is never mistaken for a
 * pinned one at the moment of approval.
 */
function SourceDisclosure({
  commandPlan,
}: {
  readonly commandPlan: CommandPlan;
}) {
  const { locale, t } = useTranslator();
  if (commandPlan.source === null) return null;
  const disclosure = describeCommandPlanSource(commandPlan.source, locale);
  return (
    <section
      aria-labelledby="review-source-heading"
      className={`review-effect review-source review-source--${disclosure.mutability}`}
      data-testid="review-source-disclosure"
    >
      <h2 id="review-source-heading">
        {t("inventory.plan.source")}: {disclosure.familyLabel} ·{" "}
        {disclosure.title}
      </h2>
      <p>
        <code>{disclosure.source}</code>
      </p>
      <p>{disclosure.summary}</p>
    </section>
  );
}

type CollectionPlanProjection = PublicCollectionPlan;

/**
 * ADR 0017: Official releases show their independent review receipt; an
 * Imported Package shows its origin and canonical digest instead and is never
 * presented as reviewed. The source line names an unpinned repository as such.
 */
function RecipeEvidenceFacts({
  plan,
  showCompatibility = false,
}: {
  readonly plan: CollectionPlanProjection;
  readonly showCompatibility?: boolean;
}) {
  const { t } = useTranslator();
  const evidence = plan.releaseEvidence;
  const sourceFact = (
    <div className="review-facts__wide">
      <dt>
        {t(
          plan.source.reviewedRevision === null
            ? "review.collection.unpinnedSource"
            : "review.collection.pinnedSource",
        )}
      </dt>
      <dd data-testid="review-collection-source">
        {plan.source.repository}
        {plan.source.reviewedRevision === null
          ? ""
          : `@${plan.source.reviewedRevision}`}
      </dd>
    </div>
  );
  if ("origin" in evidence) {
    return (
      <>
        {sourceFact}
        <div>
          <dt>{t("review.collection.origin")}</dt>
          <dd data-testid="review-collection-origin">
            {t("collections.origin.imported")}
          </dd>
        </div>
        <div>
          <dt>{t("review.collection.independentReviewer")}</dt>
          <dd>{t("review.collection.noOfficialReview")}</dd>
        </div>
        <div>
          <dt>{t("review.collection.importedAt")}</dt>
          <dd>
            <ReviewInstant value={evidence.importedAt} />
          </dd>
        </div>
        {showCompatibility ? (
          <div>
            <dt>{t("review.collection.compatibility")}</dt>
            <dd>
              {evidence.compatibility.dialectId} /{" "}
              {evidence.compatibility.harnessIds.join(", ")}
            </dd>
          </div>
        ) : null}
        <div className="review-facts__wide">
          <dt>{t("collections.inspector.documentDigest")}</dt>
          <dd>{evidence.documentDigest}</dd>
        </div>
      </>
    );
  }
  return (
    <>
      {sourceFact}
      <div>
        <dt>{t("review.collection.releaseStatus")}</dt>
        <dd>{evidence.status}</dd>
      </div>
      {showCompatibility ? (
        <div>
          <dt>{t("review.collection.compatibility")}</dt>
          <dd>
            CLI {evidence.compatibility.cliVersion} /{" "}
            {evidence.compatibility.platforms.join(", ")} /{" "}
            {evidence.compatibility.harnesses.join(", ")}
          </dd>
        </div>
      ) : null}
      {showCompatibility ? (
        <div>
          <dt>{t("review.collection.manifestAuthor")}</dt>
          <dd>{evidence.receipt.author}</dd>
        </div>
      ) : null}
      <div>
        <dt>{t("review.collection.independentReviewer")}</dt>
        <dd>{evidence.receipt.reviewer}</dd>
      </div>
      <div>
        <dt>{t("review.collection.reviewedAt")}</dt>
        <dd>
          <ReviewInstant value={evidence.receipt.reviewedAt} />
        </dd>
      </div>
      <div>
        <dt>{t("review.collection.reviewPolicy")}</dt>
        <dd>{evidence.receipt.reviewPolicy}</dd>
      </div>
      <div className="review-facts__wide">
        <dt>{t("review.collection.reviewLocation")}</dt>
        <dd>{evidence.receipt.reviewLocation}</dd>
      </div>
    </>
  );
}

function ReviewHeading({ title }: { readonly title: string }) {
  const { t } = useTranslator();
  return (
    <header className="review-heading">
      <span className="review-mark">
        <ShieldCheck aria-hidden="true" size={20} />
      </span>
      <div>
        <p>{t("review.brand")}</p>
        <h1>{title}</h1>
      </div>
    </header>
  );
}

function DigestDetails({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslator();
  return (
    <details className="review-digest-details">
      <summary>{t("common.details")}</summary>
      {children}
    </details>
  );
}

type Decision = "approve" | "reject";

/**
 * Trusted Review renders under the main-owned locale carried by the Review
 * Snapshot so a language change in the workspace is honoured on the next
 * review without any renderer-to-renderer coupling.
 */
export function ReviewSurface({ client }: { readonly client: ReviewBridge }) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>();
  const [error, setError] = useState<RendererError>();
  useDocumentPreferences(snapshot?.preferences);

  useEffect(() => {
    void client.getReview().then((result) => {
      if (result.ok) setSnapshot(result.value);
      else setError(result.error);
    });
  }, [client]);

  return (
    <LocaleProvider locale={snapshot?.preferences?.locale}>
      <ReviewContent
        client={client}
        error={error}
        onError={setError}
        onSnapshot={setSnapshot}
        snapshot={snapshot}
      />
    </LocaleProvider>
  );
}

function ReviewContent({
  client,
  error,
  onError,
  onSnapshot,
  snapshot,
}: {
  readonly client: ReviewBridge;
  readonly error: RendererError | undefined;
  readonly onError: (error: RendererError | undefined) => void;
  readonly onSnapshot: (
    update: (current: ReviewSnapshot | undefined) => ReviewSnapshot,
  ) => void;
  readonly snapshot: ReviewSnapshot | undefined;
}) {
  const { locale, t } = useTranslator();
  const [pendingDecision, setPendingDecision] = useState<Decision>();
  const [settledMessage, setSettledMessage] = useState<MessageKey>();

  const decide = async (decision: Decision) => {
    setPendingDecision(decision);
    onError(undefined);
    const result =
      decision === "approve" ? await client.approve() : await client.reject();
    setPendingDecision(undefined);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    if (decision === "approve") {
      setSettledMessage(
        snapshot?.status === "pending" && "fingerprint" in snapshot.projection
          ? "review.hostTrustConfirmed"
          : "review.mutationStarted",
      );
    } else setSettledMessage("review.rejected");
    onSnapshot((current) => ({
      ...(current?.preferences === undefined
        ? {}
        : { preferences: current.preferences }),
      decision,
      schemaVersion: REVIEW_PROTOCOL_VERSION,
      status: "settled",
    }));
    if (decision === "reject") window.close();
  };

  if (error !== undefined) {
    return (
      <main className="review-surface">
        <div className="review-alert" role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          <span className="user-facing-error">
            <span>{userFacingErrorMessage(error, locale)}</span>
            <details className="user-facing-error-details">
              <summary>{t("common.details")}</summary>
              <code>{error.message}</code>
            </details>
          </span>
        </div>
      </main>
    );
  }
  if (snapshot === undefined) {
    return (
      <main className="review-surface" aria-busy="true">
        <div className="review-loading" role="status">
          <Clock3 aria-hidden="true" size={18} />
          {t("review.loading")}
        </div>
      </main>
    );
  }
  if (snapshot.status === "unavailable") {
    return (
      <main className="review-surface">
        <div className="review-alert" role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          {t("review.unavailable")}
        </div>
      </main>
    );
  }
  if (snapshot.status === "settled") {
    return (
      <main className="review-surface">
        <div className="review-settled">
          <span className="review-settled__message" role="status">
            <Check aria-hidden="true" size={20} />
            {t(
              settledMessage ??
                (snapshot.decision === "approve"
                  ? "review.approved"
                  : "review.rejected"),
            )}
          </span>
          <button
            aria-label={t("review.closeReview")}
            autoFocus
            className="review-button"
            onClick={() => window.close()}
            type="button"
          >
            <X aria-hidden="true" size={16} />
            {t("common.close")}
          </button>
        </div>
      </main>
    );
  }

  const rejectButton = (
    <button
      autoFocus
      className="review-button"
      disabled={pendingDecision !== undefined}
      onClick={() => void decide("reject")}
      type="button"
    >
      <X aria-hidden="true" size={16} />
      {t("review.reject")}
    </button>
  );
  const approveButton = (label: string, pendingKey: MessageKey) => (
    <button
      aria-label={label}
      className="review-button review-button--primary"
      disabled={pendingDecision !== undefined}
      onClick={() => void decide("approve")}
      type="button"
    >
      <Check aria-hidden="true" size={16} />
      {t(pendingDecision === "approve" ? pendingKey : "review.approve")}
    </button>
  );

  if ("fingerprint" in snapshot.projection) {
    const { algorithm, fingerprint, identity, target, trustAction } =
      snapshot.projection;
    return (
      <main className="review-surface">
        <ReviewHeading
          title={t(
            trustAction === "rotation"
              ? "review.hostKey.rotationTitle"
              : "review.hostKey.title",
          )}
        />
        <dl className="review-facts">
          <div>
            <dt>{t("common.target")}</dt>
            <dd>{target.label}</dd>
          </div>
          <div>
            <dt>{t("review.hostKey.identity")}</dt>
            <dd>{identity}</dd>
          </div>
          <div>
            <dt>{t("review.hostKey.algorithm")}</dt>
            <dd>{algorithm}</dd>
          </div>
          <div className="review-facts__wide">
            <dt>{t("review.hostKey.fingerprint")}</dt>
            <dd>{fingerprint}</dd>
          </div>
        </dl>
        <div className="review-actions">
          {rejectButton}
          {approveButton(
            t(
              trustAction === "rotation"
                ? "review.hostKey.approveRotation"
                : "review.hostKey.trust",
            ),
            "review.confirming",
          )}
        </div>
      </main>
    );
  }

  if ("collectionPlan" in snapshot.projection) {
    const { collectionPlan, target } = snapshot.projection;
    const imported = "origin" in collectionPlan.releaseEvidence;
    const collectionTitle = t(
      imported ? "review.collection.importedTitle" : "review.collection.title",
    );
    const approveLabel = t(
      imported
        ? "review.collection.approveImported"
        : "review.collection.approve",
    );
    if (collectionPlan.schemaVersion === 2) {
      return (
        <main className="review-surface">
          <ReviewHeading title={collectionTitle} />
          <dl className="review-facts">
            <div>
              <dt>{t("review.collection.collection")}</dt>
              <dd>{collectionPlan.collectionId}</dd>
            </div>
            <div>
              <dt>{t("review.collection.release")}</dt>
              <dd>{collectionPlan.releaseNumber}</dd>
            </div>
            <div>
              <dt>{t("common.targets")}</dt>
              <dd>{collectionPlan.children.length}</dd>
            </div>
            <div>
              <dt>{t("review.collection.execution")}</dt>
              <dd>{t("collections.plan.semantics")}</dd>
            </div>
            <RecipeEvidenceFacts plan={collectionPlan} />
            <div>
              <dt>{t("review.collection.expires")}</dt>
              <dd>
                <ReviewInstant value={collectionPlan.expiresAt} />
              </dd>
            </div>
          </dl>
          <DigestDetails>
            <dl className="review-facts">
              <div className="review-facts__wide">
                <dt>{t("review.collection.manifestDigest")}</dt>
                <dd>{collectionPlan.manifestDigest}</dd>
              </div>
              <div className="review-facts__wide">
                <dt>{t("review.collection.reviewDigest")}</dt>
                <dd>{collectionPlan.reviewDigest}</dd>
              </div>
            </dl>
          </DigestDetails>
          <section
            className="review-plan"
            aria-labelledby="review-plan-heading"
          >
            <h2 id="review-plan-heading">
              {t("review.collection.childOrder")}
            </h2>
            <ol className="review-child-list">
              {collectionPlan.children.map((child) => (
                <li key={child.target.id}>
                  <header>
                    <strong>
                      {child.position}. {child.target.label}
                    </strong>
                    <span>
                      {t("review.collection.childMeta", {
                        generation: child.target.generation,
                        kind: child.target.kind.toUpperCase(),
                        scope: scopeLabel(t, child.scope),
                      })}
                    </span>
                  </header>
                  <p>
                    {child.selections
                      .map(({ mode, name }) => `${name} (${mode})`)
                      .join(", ")}
                  </p>
                  <code>{child.commandPlan.preview}</code>
                  <DigestDetails>
                    <dl className="review-child-evidence">
                      <div>
                        <dt>{t("review.collection.binding")}</dt>
                        <dd>{child.bindingDigest}</dd>
                      </div>
                      <div>
                        <dt>{t("review.collection.inventory")}</dt>
                        <dd>{child.inventoryDigest}</dd>
                      </div>
                      <div>
                        <dt>{t("review.collection.assessment")}</dt>
                        <dd>{child.assessmentDigest}</dd>
                      </div>
                      <div>
                        <dt>{t("review.collection.preparedChild")}</dt>
                        <dd>{child.preparedDigest}</dd>
                      </div>
                    </dl>
                  </DigestDetails>
                </li>
              ))}
            </ol>
          </section>
          <div className="review-actions">
            {rejectButton}
            {approveButton(approveLabel, "review.applying")}
          </div>
        </main>
      );
    }
    return (
      <main className="review-surface">
        <ReviewHeading title={collectionTitle} />
        <dl className="review-facts">
          <div>
            <dt>{t("review.collection.collection")}</dt>
            <dd>{collectionPlan.collectionId}</dd>
          </div>
          <div>
            <dt>{t("review.collection.release")}</dt>
            <dd>{collectionPlan.releaseNumber}</dd>
          </div>
          <div>
            <dt>{t("common.target")}</dt>
            <dd>
              {t("review.collection.targetGeneration", {
                generation: collectionPlan.targetGeneration,
                label: target.label,
              })}
            </dd>
          </div>
          <div>
            <dt>{t("common.scope")}</dt>
            <dd>{scopeLabel(t, collectionPlan.scope)}</dd>
          </div>
          <RecipeEvidenceFacts plan={collectionPlan} showCompatibility />
          <div className="review-facts__wide">
            <dt>{t("review.collection.selectedSkills")}</dt>
            <dd>
              {collectionPlan.selections
                .map(({ mode, name }) => `${name} (${mode})`)
                .join(", ")}
            </dd>
          </div>
          <div>
            <dt>{t("review.collection.executionOrder")}</dt>
            <dd>
              {collectionPlan.order.map(({ position }) => position).join(", ")}
            </dd>
          </div>
          <div>
            <dt>{t("review.collection.expires")}</dt>
            <dd>
              <ReviewInstant value={collectionPlan.expiresAt} />
            </dd>
          </div>
        </dl>
        <DigestDetails>
          <dl className="review-facts">
            <div className="review-facts__wide">
              <dt>{t("review.collection.manifestDigest")}</dt>
              <dd>{collectionPlan.manifestDigest}</dd>
            </div>
            <div className="review-facts__wide">
              <dt>{t("review.collection.reviewDigest")}</dt>
              <dd>{collectionPlan.reviewDigest}</dd>
            </div>
            <div className="review-facts__wide">
              <dt>{t("review.collection.assessmentDigest")}</dt>
              <dd>{collectionPlan.assessmentDigest}</dd>
            </div>
            <div className="review-facts__wide">
              <dt>{t("review.collection.inventoryDigest")}</dt>
              <dd>{collectionPlan.inventoryDigest}</dd>
            </div>
            <div className="review-facts__wide">
              <dt>{t("review.collection.childPreparedDigest")}</dt>
              <dd>{collectionPlan.childPreparedDigest}</dd>
            </div>
          </dl>
        </DigestDetails>
        <section className="review-plan" aria-labelledby="review-plan-heading">
          <h2 id="review-plan-heading">{t("review.collection.childPlan")}</h2>
          <code>{collectionPlan.childCommandPlan.preview}</code>
        </section>
        <div className="review-actions">
          {rejectButton}
          {approveButton(approveLabel, "review.applying")}
        </div>
      </main>
    );
  }

  const { commandPlan, purpose, target } = snapshot.projection;
  const titleKey: MessageKey =
    purpose === "cancel"
      ? "review.mutation.title.cancellation"
      : commandPlan.operation === "remove"
        ? "review.mutation.title.removal"
        : commandPlan.operation === "add"
          ? "review.mutation.title.add"
          : "review.mutation.title.update";
  return (
    <main className="review-surface">
      <ReviewHeading title={t(titleKey)} />

      <dl className="review-facts">
        <div>
          <dt>{t("common.target")}</dt>
          <dd>{target.label}</dd>
        </div>
        <div>
          <dt>{t("review.mutation.workspace")}</dt>
          <dd>{target.workspaceLabel}</dd>
        </div>
        <div>
          <dt>{t("common.harness")}</dt>
          <dd>{commandPlan.harness}</dd>
        </div>
        <div>
          <dt>{t("common.scope")}</dt>
          <dd>{scopeLabel(t, commandPlan.scope)}</dd>
        </div>
        <div className="review-facts__wide">
          <dt>{t("common.skills")}</dt>
          <dd>{commandPlan.names.join(", ")}</dd>
        </div>
      </dl>

      <section className="review-plan" aria-labelledby="review-plan-heading">
        <h2 id="review-plan-heading">{t("inventory.plan.heading")}</h2>
        <code>{commandPlan.preview}</code>
      </section>

      <SourceDisclosure commandPlan={commandPlan} />
      <HarnessEffectDisclosure commandPlan={commandPlan} />

      <div className="review-actions">
        {rejectButton}
        {approveButton(
          t(
            purpose === "cancel"
              ? "review.mutation.approveCancellation"
              : "review.mutation.approveMutation",
          ),
          purpose === "cancel" ? "review.cancelling" : "review.applying",
        )}
      </div>
    </main>
  );
}
