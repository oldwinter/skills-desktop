import { useEffect, useState } from "react";
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
import { userFacingErrorMessage } from "../../../contracts/user-facing-error.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";

type AboutActionError = Extract<AboutUpdateResult, { ok: false }>["error"];

function resultError(result: AboutUpdateResult): AboutActionError | undefined {
  return result.ok ? undefined : result.error;
}

function automaticStatus(snapshot: AboutUpdateSnapshot) {
  switch (snapshot.state.kind) {
    case "idle":
      return { heading: "Ready to check", message: "No update check is running." };
    case "checking":
      return {
        heading: "Checking for updates",
        message: "Checking the stable release channel.",
      };
    case "up-to-date":
      return {
        heading: "Up to date",
        message: "This is the latest available stable version.",
      };
    case "update-available":
      return {
        heading: "Update available",
        message: "Electron is downloading the available update.",
      };
    case "update-downloaded":
      return {
        heading: "Update ready for next launch",
        message: "The downloaded update will apply on a later normal launch.",
      };
    case "error":
      return {
        heading: "Update check failed",
        message: userFacingErrorMessage(snapshot.state.error),
      };
    case "manual":
    case "unavailable":
      return undefined;
  }
}

const guardLabels: Record<RestartGuardReason, string> = {
  "mutation-active": "Mutation active",
  "protected-process-active": "Protected process active",
  "trusted-review-active": "Trusted Review active",
  "reconciliation-required": "Reconciliation required",
  "recovery-uncertain": "Recovery state uncertain",
};

export function AboutView({ client }: { readonly client: AboutBridge }) {
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

  return (
    <main className="about-workspace">
      <section className="page-heading">
        <div>
          <h1>About</h1>
          <p>Skills Desktop</p>
        </div>
      </section>

      {error !== undefined ? (
        <div className="state-banner state-banner--danger" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <UserFacingErrorCopy error={error} />
        </div>
      ) : null}

      {snapshot === undefined ? (
        <div className="about-loading" aria-busy="true">
          <Info aria-hidden="true" size={20} />
          <span>Loading application details</span>
        </div>
      ) : (
        <div className="about-content">
          <section className="about-product" aria-labelledby="about-product-name">
            <span className="about-product-mark">
              <PackageOpen aria-hidden="true" size={22} />
            </span>
            <div>
              <h2 id="about-product-name">Skills Desktop</h2>
              <p>Version {snapshot.application.version}</p>
              <code>
                {snapshot.application.platform} / {snapshot.application.architecture}
              </code>
            </div>
          </section>

          <dl className="about-facts">
            <div>
              <dt>Last check</dt>
              <dd>
                {snapshot.lastCheckAt === null ? (
                  "Never checked"
                ) : (
                  <time dateTime={snapshot.lastCheckAt}>
                    {snapshot.lastCheckAt}
                  </time>
                )}
              </dd>
            </div>
            <div>
              <dt>Next eligibility</dt>
              <dd>
                {snapshot.nextAutomaticCheckAt === null ? (
                  "Not scheduled"
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
                <p className="about-status-label">Update status</p>
                <h2 id="update-status-heading">
                  {automaticStatus(snapshot)?.heading}
                </h2>
              </div>
              <p>{automaticStatus(snapshot)?.message}</p>
              {snapshot.schemaVersion === 2 && restartCandidate !== null ? (
                <div className="about-restart-control">
                  <p className="about-candidate">
                    Candidate {restartCandidate.version}
                  </p>
                  {snapshot.restart.guardReasons.length > 0 ? (
                    <ul className="about-guard-reasons" aria-label="Restart guards">
                      {snapshot.restart.guardReasons.map((reason) => (
                        <li key={reason}>{guardLabels[reason]}</li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    className="text-button text-button--primary"
                    disabled={!snapshot.restart.immediateRestartAvailable}
                    onClick={() => void requestRestart(restartCandidate.id)}
                    type="button"
                  >
                    <RotateCw aria-hidden="true" size={15} />
                    Restart to update
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
                  Check for updates
                </button>
              )}
            </section>
          ) : snapshot.policy.mode === "manual" ? (
            <section className="about-update-status" aria-labelledby="update-status-heading">
              <div>
                <p className="about-status-label">Update status</p>
                <h2 id="update-status-heading">Manual upgrade</h2>
              </div>
              <p>{snapshot.policy.message}</p>
              <code className="wrapping-value">
                {snapshot.policy.releasePageUrl}
              </code>
            </section>
          ) : snapshot.policy.mode === "unavailable" ? (
            <section className="about-update-status" aria-labelledby="update-status-heading">
              <div>
                <p className="about-status-label">Update status</p>
                <h2 id="update-status-heading">Checks unavailable</h2>
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
              Export release diagnostics
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
