import { useEffect, useState } from "react";
import { AlertCircle, Check, Clock3, ShieldCheck, X } from "lucide-react";

import type {
  ReviewBridge,
  ReviewSnapshot,
} from "../contracts/review.js";
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
  const [started, setStarted] = useState(false);

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
    if (decision === "approve") setStarted(true);
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
          {started ? "Mutation started" : "Review rejected"}
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
