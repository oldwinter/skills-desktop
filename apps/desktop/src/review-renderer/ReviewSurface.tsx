import { useEffect, useState } from "react";
import { AlertCircle, Check, Clock3, ShieldCheck, X } from "lucide-react";

import type { ReviewBridge, ReviewSnapshot } from "../contracts/review.js";
import type { RendererError } from "../contracts/workspace.js";

function scopeLabel(scope: "global" | "project") {
  return scope === "project" ? "Project" : "Global";
}

export function ReviewSurface({ client }: { readonly client: ReviewBridge }) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>();
  const [error, setError] = useState<RendererError>();
  const [pendingDecision, setPendingDecision] = useState<
    "approve" | "reject"
  >();
  const [settledMessage, setSettledMessage] = useState("Review rejected");

  useEffect(() => {
    void client.getReview().then((result) => {
      if (result.ok) setSnapshot(result.value);
      else setError(result.error);
    });
  }, [client]);

  const decide = async (decision: "approve" | "reject") => {
    setPendingDecision(decision);
    setError(undefined);
    const result =
      decision === "approve" ? await client.approve() : await client.reject();
    setPendingDecision(undefined);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (decision === "approve") {
      setSettledMessage(
        snapshot?.status === "pending" && "fingerprint" in snapshot.projection
          ? "Host trust confirmed"
          : "Mutation started",
      );
    } else setSettledMessage("Review rejected");
    setSnapshot({ decision, schemaVersion: 1, status: "settled" });
  };

  if (error !== undefined) {
    return (
      <main className="review-surface">
        <div className="review-alert" role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error.message}</span>
        </div>
      </main>
    );
  }
  if (snapshot === undefined) {
    return (
      <main className="review-surface" aria-busy="true">
        <div className="review-loading" role="status">
          <Clock3 aria-hidden="true" size={18} />
          Loading review
        </div>
      </main>
    );
  }
  if (snapshot.status === "unavailable") {
    return (
      <main className="review-surface">
        <div className="review-alert" role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          No review is available
        </div>
      </main>
    );
  }
  if (snapshot.status === "settled") {
    return (
      <main className="review-surface">
        <div className="review-settled" role="status">
          <Check aria-hidden="true" size={20} />
          {settledMessage}
        </div>
      </main>
    );
  }

  if ("fingerprint" in snapshot.projection) {
    const { algorithm, fingerprint, identity, target, trustAction } =
      snapshot.projection;
    return (
      <main className="review-surface">
        <header className="review-heading">
          <span className="review-mark">
            <ShieldCheck aria-hidden="true" size={20} />
          </span>
          <div>
            <p>Trusted Review</p>
            <h1>
              Review{" "}
              {trustAction === "rotation" ? "changed host key" : "host key"}
            </h1>
          </div>
        </header>
        <dl className="review-facts">
          <div>
            <dt>Target</dt>
            <dd>{target.label}</dd>
          </div>
          <div>
            <dt>Effective identity</dt>
            <dd>{identity}</dd>
          </div>
          <div>
            <dt>Algorithm</dt>
            <dd>{algorithm}</dd>
          </div>
          <div className="review-facts__wide">
            <dt>SHA-256 fingerprint</dt>
            <dd>{fingerprint}</dd>
          </div>
        </dl>
        <div className="review-actions">
          <button
            className="review-button"
            disabled={pendingDecision !== undefined}
            onClick={() => void decide("reject")}
            type="button"
          >
            <X aria-hidden="true" size={16} />
            Reject
          </button>
          <button
            aria-label={
              trustAction === "rotation"
                ? "Approve host key rotation"
                : "Trust host key"
            }
            className="review-button review-button--primary"
            disabled={pendingDecision !== undefined}
            onClick={() => void decide("approve")}
            type="button"
          >
            <Check aria-hidden="true" size={16} />
            {pendingDecision === "approve" ? "Confirming" : "Approve"}
          </button>
        </div>
      </main>
    );
  }

  if ("collectionPlan" in snapshot.projection) {
    const { collectionPlan, target } = snapshot.projection;
    return (
      <main className="review-surface">
        <header className="review-heading">
          <span className="review-mark">
            <ShieldCheck aria-hidden="true" size={20} />
          </span>
          <div>
            <p>Trusted Review</p>
            <h1>Review Official Collection</h1>
          </div>
        </header>
        <dl className="review-facts">
          <div>
            <dt>Collection</dt>
            <dd>{collectionPlan.collectionId}</dd>
          </div>
          <div>
            <dt>Release</dt>
            <dd>{collectionPlan.releaseNumber}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>
              {target.label} / generation {collectionPlan.targetGeneration}
            </dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>{scopeLabel(collectionPlan.scope)}</dd>
          </div>
          <div className="review-facts__wide">
            <dt>Pinned source</dt>
            <dd>
              {collectionPlan.source.repository}@
              {collectionPlan.source.reviewedRevision}
            </dd>
          </div>
          <div>
            <dt>Release status</dt>
            <dd>{collectionPlan.releaseEvidence.status}</dd>
          </div>
          <div>
            <dt>Compatibility</dt>
            <dd>
              CLI {collectionPlan.releaseEvidence.compatibility.cliVersion} /{" "}
              {collectionPlan.releaseEvidence.compatibility.platforms.join(
                ", ",
              )}{" "}
              / {collectionPlan.releaseEvidence.compatibility.harnesses.join(", ")}
            </dd>
          </div>
          <div>
            <dt>Manifest author</dt>
            <dd>{collectionPlan.releaseEvidence.receipt.author}</dd>
          </div>
          <div>
            <dt>Independent reviewer</dt>
            <dd>{collectionPlan.releaseEvidence.receipt.reviewer}</dd>
          </div>
          <div>
            <dt>Reviewed at</dt>
            <dd>{collectionPlan.releaseEvidence.receipt.reviewedAt}</dd>
          </div>
          <div>
            <dt>Review policy</dt>
            <dd>{collectionPlan.releaseEvidence.receipt.reviewPolicy}</dd>
          </div>
          <div className="review-facts__wide">
            <dt>Review location</dt>
            <dd>{collectionPlan.releaseEvidence.receipt.reviewLocation}</dd>
          </div>
          <div className="review-facts__wide">
            <dt>Selected skills</dt>
            <dd>
              {collectionPlan.selections
                .map(({ mode, name }) => `${name} (${mode})`)
                .join(", ")}
            </dd>
          </div>
          <div className="review-facts__wide">
            <dt>Manifest digest</dt>
            <dd>{collectionPlan.manifestDigest}</dd>
          </div>
          <div className="review-facts__wide">
            <dt>Review digest</dt>
            <dd>{collectionPlan.reviewDigest}</dd>
          </div>
          <div className="review-facts__wide">
            <dt>Assessment digest</dt>
            <dd>{collectionPlan.assessmentDigest}</dd>
          </div>
          <div className="review-facts__wide">
            <dt>Inventory digest</dt>
            <dd>{collectionPlan.inventoryDigest}</dd>
          </div>
          <div className="review-facts__wide">
            <dt>Child prepared digest</dt>
            <dd>{collectionPlan.childPreparedDigest}</dd>
          </div>
          <div>
            <dt>Execution order</dt>
            <dd>
              {collectionPlan.order.map(({ position }) => position).join(", ")}
            </dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{collectionPlan.expiresAt}</dd>
          </div>
        </dl>
        <section className="review-plan" aria-labelledby="review-plan-heading">
          <h2 id="review-plan-heading">Child Command Plan</h2>
          <code>{collectionPlan.childCommandPlan.preview}</code>
        </section>
        <div className="review-actions">
          <button
            className="review-button"
            disabled={pendingDecision !== undefined}
            onClick={() => void decide("reject")}
            type="button"
          >
            <X aria-hidden="true" size={16} />
            Reject
          </button>
          <button
            aria-label="Approve Official Collection plan"
            className="review-button review-button--primary"
            disabled={pendingDecision !== undefined}
            onClick={() => void decide("approve")}
            type="button"
          >
            <Check aria-hidden="true" size={16} />
            {pendingDecision === "approve" ? "Applying" : "Approve"}
          </button>
        </div>
      </main>
    );
  }

  const { commandPlan, purpose, target } = snapshot.projection;
  const actionLabel =
    purpose === "cancel"
      ? "cancellation"
      : commandPlan.operation === "remove"
        ? "removal"
        : commandPlan.operation;
  return (
    <main className="review-surface">
      <header className="review-heading">
        <span className="review-mark">
          <ShieldCheck aria-hidden="true" size={20} />
        </span>
        <div>
          <p>Trusted Review</p>
          <h1>Review {actionLabel}</h1>
        </div>
      </header>

      <dl className="review-facts">
        <div>
          <dt>Target</dt>
          <dd>{target.label}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>{target.workspaceLabel}</dd>
        </div>
        <div>
          <dt>Harness</dt>
          <dd>{commandPlan.harness}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{scopeLabel(commandPlan.scope)}</dd>
        </div>
        <div className="review-facts__wide">
          <dt>Skills</dt>
          <dd>{commandPlan.names.join(", ")}</dd>
        </div>
      </dl>

      <section className="review-plan" aria-labelledby="review-plan-heading">
        <h2 id="review-plan-heading">Command Plan</h2>
        <code>{commandPlan.preview}</code>
      </section>

      <div className="review-actions">
        <button
          className="review-button"
          disabled={pendingDecision !== undefined}
          onClick={() => void decide("reject")}
          type="button"
        >
          <X aria-hidden="true" size={16} />
          Reject
        </button>
        <button
          aria-label={
            purpose === "cancel" ? "Approve cancellation" : "Approve mutation"
          }
          className="review-button review-button--primary"
          disabled={pendingDecision !== undefined}
          onClick={() => void decide("approve")}
          type="button"
        >
          <Check aria-hidden="true" size={16} />
          {pendingDecision === "approve"
            ? purpose === "cancel"
              ? "Cancelling"
              : "Applying"
            : "Approve"}
        </button>
      </div>
    </main>
  );
}
