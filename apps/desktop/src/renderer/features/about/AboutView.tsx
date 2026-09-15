import { useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Download,
  Info,
  PackageOpen,
  RefreshCw,
  RotateCw,
} from "lucide-react";

import type {
  AboutBridge,
  AboutUpdateResult,
  AboutUpdateSnapshot,
  RestartGuardReason,
} from "../../../contracts/about.js";
import type { MessageKey, Translator } from "../../../contracts/i18n/translate.js";
import { useTranslator } from "../../i18n/LocaleProvider.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";

type AboutActionError = Extract<AboutUpdateResult, { ok: false }>["error"];

function resultError(result: AboutUpdateResult): AboutActionError | undefined {
  return result.ok ? undefined : result.error;
}

function automaticStatus(t: Translator["t"], snapshot: AboutUpdateSnapshot) {
  switch (snapshot.state.kind) {
    case "idle":
      return {
        heading: t("about.status.idle.heading"),
        message: t("about.status.idle.message"),
      };
    case "checking":
      return {
        heading: t("about.status.checking.heading"),
        message: t("about.status.checking.message"),
      };
    case "up-to-date":
      return {
        heading: t("about.status.upToDate.heading"),
        message: t("about.status.upToDate.message"),
      };
    case "update-available":
      return {
        heading: t("about.status.available.heading"),
        message: t("about.status.available.message"),
      };
    case "update-downloaded":
      return {
        heading: t("about.status.downloaded.heading"),
        message: t("about.status.downloaded.message"),
      };
    case "error":
      return { heading: t("about.status.error.heading"), message: "" };
    case "manual":
    case "unavailable":
      return undefined;
  }
}

const guardKeys: Record<RestartGuardReason, MessageKey> = {
  "mutation-active": "about.guard.mutation-active",
  "protected-process-active": "about.guard.protected-process-active",
  "trusted-review-active": "about.guard.trusted-review-active",
  "reconciliation-required": "about.guard.reconciliation-required",
  "recovery-uncertain": "about.guard.recovery-uncertain",
};

export function AboutView({
  children,
  client,
}: {
  /** Workspace-level settings rendered above the update status. */
  readonly children?: ReactNode;
  readonly client: AboutBridge;
}) {
  const { t } = useTranslator();
  const [snapshot, setSnapshot] = useState<AboutUpdateSnapshot>();
  const [error, setError] = useState<AboutActionError>();

  const requestCheck = async () => {
    const result = await client.requestCheck();
    if (result.ok) {
      setError(undefined);
      setSnapshot(result.value);
    } else setError(resultError(result));
  };

  const requestRestart = async (candidateId: string) => {
    const result = await client.requestRestart(candidateId);
    if (result.ok) {
      setError(undefined);
      setSnapshot(result.value);
    } else setError(resultError(result));
  };

  const exportDiagnostics = async () => {
    const result = await client.exportDiagnostics();
    if (result.ok) setError(undefined);
    else setError(result.error);
  };

  useEffect(() => {
    let active = true;
    let receivedPush = false;
    const unsubscribe = client.subscribe((next) => {
      receivedPush = true;
      if (active) {
        setError(undefined);
        setSnapshot(next);
      }
    });
    void client.getSnapshot().then((result) => {
      if (!active || receivedPush) return;
      if (result.ok) {
        setError(undefined);
        setSnapshot(result.value);
      } else setError(resultError(result));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const restartCandidate =
    snapshot?.schemaVersion === 2 ? snapshot.candidate : null;
  const guardLabel = (reason: RestartGuardReason) => t(guardKeys[reason]);

  return (
    <main className="about-workspace" id="workspace-main" tabIndex={-1}>
      <section className="page-heading">
        <div>
          <h1>{t("about.title")}</h1>
          <p>{t("app.name")}</p>
        </div>
      </section>

      {children}

      {error !== undefined ? (
        <div className="state-banner state-banner--danger" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <UserFacingErrorCopy error={error} />
        </div>
      ) : null}

      {snapshot === undefined ? (
        <div className="about-loading" aria-busy="true">
          <Info aria-hidden="true" size={20} />
          <span>{t("about.loading")}</span>
        </div>
      ) : (
        <div className="about-content">
          <section className="about-product" aria-labelledby="about-product-name">
            <span className="about-product-mark">
              <PackageOpen aria-hidden="true" size={22} />
            </span>
            <div>
              <h2 id="about-product-name">{t("app.name")}</h2>
              <p>{t("about.version", { version: snapshot.application.version })}</p>
              <code>
                {snapshot.application.platform} / {snapshot.application.architecture}
              </code>
            </div>
          </section>

          <dl className="about-facts">
            <div>
              <dt>{t("about.lastCheck")}</dt>
              <dd>
                {snapshot.lastCheckAt === null ? (
                  t("about.neverChecked")
                ) : (
                  <time dateTime={snapshot.lastCheckAt}>
                    {snapshot.lastCheckAt}
                  </time>
                )}
              </dd>
            </div>
            <div>
              <dt>{t("about.nextEligibility")}</dt>
              <dd>
                {snapshot.nextAutomaticCheckAt === null ? (
                  t("about.notScheduled")
                ) : (
                  <time dateTime={snapshot.nextAutomaticCheckAt}>
                    {snapshot.nextAutomaticCheckAt}
                  </time>
                )}
              </dd>
            </div>
          </dl>

          {snapshot.policy.mode === "automatic" ? (
            <section
              className="about-update-status"
              aria-labelledby="update-status-heading"
              role={snapshot.state.kind === "error" ? "alert" : "status"}
            >
              <div>
                <p className="about-status-label">{t("about.updateStatus")}</p>
                <h2 id="update-status-heading">
                  {automaticStatus(t, snapshot)?.heading}
                </h2>
              </div>
              {snapshot.state.kind === "error" ? (
                <UserFacingErrorCopy error={snapshot.state.error} />
              ) : (
                <p>{automaticStatus(t, snapshot)?.message}</p>
              )}
              {snapshot.schemaVersion === 2 && restartCandidate !== null ? (
                <div className="about-restart-control">
                  <p className="about-candidate">
                    {t("about.candidateReady", {
                      version: restartCandidate.version,
                    })}
                  </p>
                  {snapshot.restart.guardReasons.length > 0 ? (
                    <ul
                      className="about-guard-reasons"
                      aria-label={t("about.restartGuards")}
                      id="about-restart-unavailable-reason"
                    >
                      {snapshot.restart.guardReasons.map((reason) => (
                        <li key={reason}>{guardLabel(reason)}</li>
                      ))}
                    </ul>
                  ) : !snapshot.restart.immediateRestartAvailable ? (
                    <p
                      className="sr-only"
                      id="about-restart-unavailable-reason"
                    >
                      {t("about.restartUnavailable")}
                    </p>
                  ) : null}
                  <button
                    aria-describedby={
                      snapshot.restart.immediateRestartAvailable
                        ? undefined
                        : "about-restart-unavailable-reason"
                    }
                    className="text-button text-button--primary"
                    disabled={!snapshot.restart.immediateRestartAvailable}
                    onClick={() => void requestRestart(restartCandidate.id)}
                    title={
                      snapshot.restart.immediateRestartAvailable
                        ? undefined
                        : snapshot.restart.guardReasons.length > 0
                          ? t("about.restartUnavailableBecause", {
                              reasons: snapshot.restart.guardReasons
                                .map(guardLabel)
                                .join(", "),
                            })
                          : t("about.restartUnavailable")
                    }
                    type="button"
                  >
                    <RotateCw aria-hidden="true" size={15} />
                    {t("about.restartToUpdate")}
                  </button>
                </div>
              ) : (
                <button
                  className="text-button text-button--primary"
                  disabled={snapshot.state.kind === "checking"}
                  onClick={() => void requestCheck()}
                  type="button"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={snapshot.state.kind === "checking" ? "spin" : undefined}
                    size={15}
                  />
                  {t("about.checkForUpdates")}
                </button>
              )}
            </section>
          ) : snapshot.policy.mode === "manual" ? (
            <section className="about-update-status" aria-labelledby="update-status-heading">
              <div>
                <p className="about-status-label">{t("about.updateStatus")}</p>
                <h2 id="update-status-heading">{t("about.manualUpgrade")}</h2>
              </div>
              <p>{snapshot.policy.message}</p>
              <code className="wrapping-value">
                {snapshot.policy.releasePageUrl}
              </code>
            </section>
          ) : snapshot.policy.mode === "unavailable" ? (
            <section className="about-update-status" aria-labelledby="update-status-heading">
              <div>
                <p className="about-status-label">{t("about.updateStatus")}</p>
                <h2 id="update-status-heading">{t("about.checksUnavailable")}</h2>
              </div>
              <p>{snapshot.policy.message}</p>
            </section>
          ) : null}
          <div className="about-actions">
            <button
              className="text-button"
              onClick={() => void exportDiagnostics()}
              type="button"
            >
              <Download aria-hidden="true" size={15} />
              {t("about.exportDiagnostics")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
