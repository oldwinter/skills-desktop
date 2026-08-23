import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const allowedFailureStages = new Set([
  "axe-semantics",
  "console-failures",
  "empty-state",
  "error-state",
  "finalization",
  "focus-order",
  "keyboard-workflow",
  "launch",
  "narrow-layout",
  "reduced-motion",
  "unknown",
]);
const allowedFailureChecks = new Set([
  "cli-list-invocation",
  "cli-remove-invocation",
  "empty-state-render",
  "error-state-render",
  "executable-launch",
  "fixture-cleanup",
  "fixture-inventory",
  "focus-visibility",
  "mutation-postflight",
  "mutation-prepare",
  "narrow-overflow",
  "primary-navigation-activation",
  "primary-navigation-order",
  "reduced-motion",
  "renderer-console",
  "review-approve",
  "review-axe",
  "review-close",
  "review-focus-order",
  "review-open",
  "review-settled",
  "session-cleanup",
  "settled-axe",
  "settled-focus",
  "unknown",
  "workspace-axe",
  "workspace-focus-restore",
  "workspace-semantics",
]);
const allowedErrorClasses = new Set([
  "AggregateError",
  "CdpDisconnectedError",
  "CdpRequestTimeoutError",
  "Error",
  "PackagedUiQaScenarioError",
]);

export function failureReceipt(error, fallbackStage = "unknown") {
  const proposedClass = error instanceof Error ? error.name : "Error";
  const proposedStage =
    error !== null && typeof error === "object" && "qaStage" in error
      ? error.qaStage
      : fallbackStage;
  const proposedCheck =
    error !== null && typeof error === "object" && "qaCheck" in error
      ? error.qaCheck
      : "unknown";
  return {
    architecture: process.arch,
    check:
      typeof proposedCheck === "string" &&
      allowedFailureChecks.has(proposedCheck)
        ? proposedCheck
        : "unknown",
    errorClass: allowedErrorClasses.has(proposedClass) ? proposedClass : "Error",
    platform: process.platform,
    schemaVersion: 1,
    stage:
      typeof proposedStage === "string" && allowedFailureStages.has(proposedStage)
        ? proposedStage
        : "unknown",
  };
}

export function safeFailureSummary(error, fallbackStage = "unknown") {
  const receipt = failureReceipt(error, fallbackStage);
  return `Packaged UI QA failed during ${receipt.stage}/${receipt.check} (${receipt.errorClass}).`;
}

export async function persistFailureArtifacts(error, destination, fallbackStage) {
  if (typeof destination !== "string" || destination.length === 0) return false;
  await mkdir(destination, { recursive: true });
  const failurePath = join(destination, "failure.json");
  await writeFile(
    failurePath,
    `${JSON.stringify(failureReceipt(error, fallbackStage), null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(failurePath, 0o600);
  return true;
}
