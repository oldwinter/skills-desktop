import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  LifeBuoy,
  RefreshCw,
  Wrench,
} from "lucide-react";

import { HARNESS_OPTIONS } from "../../../contracts/harness-options.js";
import type {
  BlockedTargetDefinition,
  RendererError,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";

type TargetState = NonNullable<WorkspaceSnapshot["targets"]>[number];

export interface RecoveryItems {
  readonly blockedTargets: readonly BlockedTargetDefinition[];
  readonly reconciliationTargets: readonly TargetState[];
  readonly restartRequired: boolean;
}

/**
 * Derives the Recovery Center work list from the main-owned Snapshot. Only
 * states with a typed repair or reconcile action are listed; nothing here is
 * a generic clear or retry.
 */
export function recoveryItemsFor(
  snapshot: WorkspaceSnapshot,
  targets: readonly TargetState[],
): RecoveryItems {
  return {
    blockedTargets: snapshot.blockedTargets ?? [],
    reconciliationTargets: targets.filter(
      ({ mutation }) => mutation.phase === "reconciliation-required",
    ),
    restartRequired: snapshot.recovery?.restartRequired ?? false,
  };
}

export function recoveryItemCount(items: RecoveryItems): number {
  return (
    items.blockedTargets.length +
    items.reconciliationTargets.length +
    (items.restartRequired ? 1 : 0)
  );
}

function formatDeadline(deadline: string | null): string {
  if (deadline === null) return "No deadline recorded";
  const parsed = Date.parse(deadline);
  if (Number.isNaN(parsed)) return deadline;
  return `Deadline ${new Date(parsed).toLocaleString()}`;
}

export function RecoveryView({
  client,
  onSelectTarget,
  snapshot,
  targets,
}: {
  readonly client: WorkspaceBridge;
  readonly onSelectTarget: (targetId: string) => void;
  readonly snapshot: WorkspaceSnapshot;
  readonly targets: readonly TargetState[];
}) {
  const items = recoveryItemsFor(snapshot, targets);
  const [error, setError] = useState<RendererError>();
  const [notice, setNotice] = useState<string>();
  const [repairChoices, setRepairChoices] = useState<Record<string, string>>(
    {},
  );
  const [busyId, setBusyId] = useState<string>();
  const repaired = snapshot.recovery?.repairedTargets ?? [];

  const reconcile = async (targetId: string) => {
    setBusyId(targetId);
    const result = await client.reconcileMutation(targetId);
    setBusyId(undefined);
    if (result.ok) {
      setError(undefined);
      setNotice("Reconciliation started. The Target re-observes its Inventory.");
      onSelectTarget(targetId);
    } else setError(result.error);
  };

  const repair = async (blocked: BlockedTargetDefinition) => {
    const harnessId = repairChoices[blocked.id] ?? "";
    if (harnessId === "") {
      setNotice(undefined);
      setError({
        code: "invalid_request",
        effects: "none",
        message: "Choose a registry harness before repairing this Target.",
        phase: "validate",
        retryable: false,
      });
      return;
    }
    setBusyId(blocked.id);
    const result = await client.repairTarget(blocked.id, harnessId);
    setBusyId(undefined);
    if (result.ok) {
      setError(undefined);
      setNotice(`Saved ${blocked.label} with harness ${harnessId}.`);
    } else setError(result.error);
  };

  const total = recoveryItemCount(items);

  return (
    <main className="recovery-workspace" id="workspace-main" tabIndex={-1}>
      <section className="page-heading">
        <div>
          <h1>Recovery</h1>
          <p>
            {total === 0
              ? "Nothing needs recovery"
              : `${total} item${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} a typed action`}
          </p>
        </div>
      </section>
      {error !== undefined ? (
        <div className="state-banner state-banner--danger" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <UserFacingErrorCopy error={error} />
        </div>
      ) : null}
      {notice !== undefined ? (
        <div className="state-banner state-banner--loading" role="status">
          <CheckCircle2 aria-hidden="true" size={16} />
          <span>{notice}</span>
        </div>
      ) : null}

      {items.restartRequired ? (
        <section
          aria-labelledby="recovery-restart-heading"
          className="recovery-section"
        >
          <h2 id="recovery-restart-heading">Restart required</h2>
          <p>
            Repaired Target Definitions are saved. Restart Skills Desktop to
            rebuild Target authority and resume Inventory for them.
          </p>
          <ul className="recovery-list">
            {repaired.map((target) => (
              <li className="recovery-item" key={target.id}>
                <CheckCircle2 aria-hidden="true" size={16} />
                <div>
                  <strong>{target.label}</strong>
                  <small>
                    harness <code>{target.harnessId}</code>
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {items.reconciliationTargets.length > 0 ? (
        <section
          aria-labelledby="recovery-reconcile-heading"
          className="recovery-section"
        >
          <h2 id="recovery-reconcile-heading">Reconciliation required</h2>
          <p>
            A confirmed mutation ended without certainty about its effects.
            Reconciliation waits for the original deadline and then observes a
            new Fresh Inventory; refresh alone cannot clear it.
          </p>
          <ul className="recovery-list">
            {items.reconciliationTargets.map((state) => (
              <li className="recovery-item" key={state.target.id}>
                <AlertCircle aria-hidden="true" size={16} />
                <div>
                  <strong>{state.target.label}</strong>
                  <small>
                    {formatDeadline(state.mutation.reconciliationDeadline)}
                  </small>
                  {state.mutation.lastError !== null ? (
                    <UserFacingErrorCopy error={state.mutation.lastError} />
                  ) : null}
                </div>
                <button
                  className="text-button text-button--primary"
                  disabled={busyId === state.target.id}
                  onClick={() => void reconcile(state.target.id)}
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={15} />
                  Reconcile {state.target.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {items.blockedTargets.length > 0 ? (
        <section
          aria-labelledby="recovery-blocked-heading"
          className="recovery-section"
        >
          <h2 id="recovery-blocked-heading">Blocked Target Definitions</h2>
          <p>
            These saved Targets name a harness the pinned registry does not
            recognise, so the Target store stays read-only. Pick the registry
            harness that replaces the legacy value; nothing is guessed for you.
          </p>
          <ul className="recovery-list">
            {items.blockedTargets.map((blocked) => {
              const selectId = `recovery-repair-${blocked.id}`;
              return (
                <li className="recovery-item" key={blocked.id}>
                  <Wrench aria-hidden="true" size={16} />
                  <div>
                    <strong>{blocked.label}</strong>
                    <small>
                      legacy harness <code>{blocked.legacyHarness}</code> ·
                      generation {blocked.generation}
                    </small>
                    <label className="recovery-repair-choice" htmlFor={selectId}>
                      <span>Replacement harness</span>
                      <select
                        id={selectId}
                        onChange={(event) =>
                          setRepairChoices({
                            ...repairChoices,
                            [blocked.id]: event.currentTarget.value,
                          })
                        }
                        value={repairChoices[blocked.id] ?? ""}
                      >
                        <option value="">Choose a harness</option>
                        {HARNESS_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label} ({option.id})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    className="text-button text-button--primary"
                    disabled={busyId === blocked.id}
                    onClick={() => void repair(blocked)}
                    type="button"
                  >
                    <Wrench aria-hidden="true" size={15} />
                    Repair {blocked.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {total === 0 ? (
        <section className="recovery-empty" aria-label="Recovery empty state">
          <LifeBuoy aria-hidden="true" size={28} />
          <h2>No recovery work</h2>
          <p>
            This page lists Targets that need reconciliation after an uncertain
            mutation and saved Targets blocked by an unknown harness. Each entry
            offers exactly one typed action; there is no generic clear or
            retry.
          </p>
        </section>
      ) : null}
    </main>
  );
}
