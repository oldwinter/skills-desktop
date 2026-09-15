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
  MessageKey,
  Translator,
} from "../../../contracts/i18n/translate.js";
import type {
  BlockedTargetDefinition,
  RendererError,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { useTranslator } from "../../i18n/LocaleProvider.js";
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

function formatDeadline(
  { locale, t }: Translator,
  deadline: string | null,
): string {
  if (deadline === null) return t("recovery.noDeadline");
  const parsed = Date.parse(deadline);
  if (Number.isNaN(parsed)) return deadline;
  return t("recovery.deadline", {
    when: new Date(parsed).toLocaleString(locale),
  });
}

interface Notice {
  readonly key: MessageKey;
  readonly params?: Record<string, string | number>;
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
  const translator = useTranslator();
  const { t, tc } = translator;
  const items = recoveryItemsFor(snapshot, targets);
  const [error, setError] = useState<RendererError>();
  const [notice, setNotice] = useState<Notice>();
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
      setNotice({ key: "recovery.reconcileStarted" });
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
        message: t("recovery.chooseHarness"),
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
      setNotice({
        key: "recovery.repaired",
        params: { harnessId, label: blocked.label },
      });
    } else setError(result.error);
  };

  const total = recoveryItemCount(items);

  return (
    <main className="recovery-workspace" id="workspace-main" tabIndex={-1}>
      <section className="page-heading">
        <div>
          <h1>{t("recovery.title")}</h1>
          <p>
            {total === 0
              ? t("recovery.nothing")
              : tc("recovery.count", total)}
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
          <span>{t(notice.key, notice.params)}</span>
        </div>
      ) : null}

      {items.restartRequired ? (
        <section
          aria-labelledby="recovery-restart-heading"
          className="recovery-section"
        >
          <h2 id="recovery-restart-heading">{t("recovery.restart.heading")}</h2>
          <p>{t("recovery.restart.body")}</p>
          <ul className="recovery-list">
            {repaired.map((target) => (
              <li className="recovery-item" key={target.id}>
                <CheckCircle2 aria-hidden="true" size={16} />
                <div>
                  <strong>{target.label}</strong>
                  <small>
                    {t("recovery.restart.harness")}{" "}
                    <code>{target.harnessId}</code>
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
          <h2 id="recovery-reconcile-heading">
            {t("recovery.reconcile.heading")}
          </h2>
          <p>{t("recovery.reconcile.body")}</p>
          <ul className="recovery-list">
            {items.reconciliationTargets.map((state) => (
              <li className="recovery-item" key={state.target.id}>
                <AlertCircle aria-hidden="true" size={16} />
                <div>
                  <strong>{state.target.label}</strong>
                  <small>
                    {formatDeadline(
                      translator,
                      state.mutation.reconciliationDeadline,
                    )}
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
                  {t("recovery.reconcile.action", { label: state.target.label })}
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
          <h2 id="recovery-blocked-heading">{t("recovery.blocked.heading")}</h2>
          <p>{t("recovery.blocked.body")}</p>
          <ul className="recovery-list">
            {items.blockedTargets.map((blocked) => {
              const selectId = `recovery-repair-${blocked.id}`;
              return (
                <li className="recovery-item" key={blocked.id}>
                  <Wrench aria-hidden="true" size={16} />
                  <div>
                    <strong>{blocked.label}</strong>
                    <small>
                      {t("recovery.blocked.legacy")}{" "}
                      <code>{blocked.legacyHarness}</code> ·{" "}
                      {t("recovery.blocked.generation", {
                        generation: blocked.generation,
                      })}
                    </small>
                    <label className="recovery-repair-choice" htmlFor={selectId}>
                      <span>{t("recovery.blocked.replacement")}</span>
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
                        <option value="">{t("recovery.blocked.choose")}</option>
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
                    {t("recovery.blocked.repair", { label: blocked.label })}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {total === 0 ? (
        <section
          className="recovery-empty"
          aria-label={t("recovery.empty.label")}
        >
          <LifeBuoy aria-hidden="true" size={28} />
          <h2>{t("recovery.empty.heading")}</h2>
          <p>{t("recovery.empty.body")}</p>
        </section>
      ) : null}
    </main>
  );
}
