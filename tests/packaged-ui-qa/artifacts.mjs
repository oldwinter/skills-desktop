import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const allowedFailureStages = new Set([
  "appearance-modes",
  "axe-semantics",
  "console-failures",
  "empty-state",
  "error-state",
  "finalization",
  "focus-order",
  "keyboard-workflow",
  "launch",
  "locale-switch",
  "narrow-layout",
  "reduced-motion",
  "unknown",
]);
const allowedFailureChecks = new Set([
  "about-open",
  "appearance-dark",
  "appearance-forced-colors",
  "appearance-high-contrast",
  "appearance-light",
  "appearance-system",
  "cli-list-invocation",
  "cli-remove-invocation",
  "empty-state-render",
  "error-state-render",
  "executable-launch",
  "fixture-cleanup",
  "fixture-inventory",
  "focus-visibility",
  "locale-initial",
  "locale-persisted",
  "locale-switch-en",
  "locale-switch-zh-cn",
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
  "workspace-focus-precondition",
  "workspace-focus-restore",
  "workspace-outcome-focus-restore",
  "workspace-review-focus-restore",
  "workspace-semantics",
]);
const allowedErrorClasses = new Set([
  "AggregateError",
  "CdpDisconnectedError",
  "CdpRequestTimeoutError",
  "Error",
  "PackagedUiQaScenarioError",
]);
const axeDiagnostics = new Set([
  "axe-install-evaluation-failed",
  "axe-install-unavailable",
  "axe-result-invalid",
  "axe-run-evaluation-failed",
  "axe-run-unavailable",
]);
const axeRuleDiagnostic = /^axe-rule-[a-z0-9-]{1,64}$/;
const allowedDiagnosticsByCheck = new Map([
  ["appearance-dark", new Set([...axeDiagnostics, "wait-timeout"])],
  ["appearance-high-contrast", new Set([...axeDiagnostics, "wait-timeout"])],
  ["appearance-light", axeDiagnostics],
  ["appearance-system", axeDiagnostics],
  ["review-axe", axeDiagnostics],
  ["settled-axe", axeDiagnostics],
  ["workspace-axe", axeDiagnostics],
  [
    "workspace-focus-restore",
    new Set([
      "focus-state-unavailable",
      "review-action-disabled",
      "review-action-missing",
      "review-action-not-active",
      "workspace-unfocused",
    ]),
  ],
  [
    "workspace-outcome-focus-restore",
    new Set([
      "focus-state-unavailable",
      "mutation-outcome-missing",
      "mutation-outcome-not-active",
      "workspace-unfocused",
    ]),
  ],
  [
    "workspace-review-focus-restore",
    new Set([
      "focus-state-unavailable",
      "review-action-disabled",
      "review-action-missing",
      "review-action-not-active",
      "workspace-unfocused",
    ]),
  ],
]);

const hexColor = /^#[0-9A-Fa-f]{3,8}$/;

function sanitizeAxeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\/(?:Users|home|tmp)\/\S+/gi, "")
    .slice(0, maxLength);
}

function sanitizeAxeViolations(value) {
  if (!Array.isArray(value)) return undefined;
  const cleaned = [];
  for (const violation of value.slice(0, 4)) {
    if (violation === null || typeof violation !== "object") continue;
    const id = typeof violation.id === "string" ? violation.id.slice(0, 64) : "";
    if (id.length === 0) continue;
    const samples = [];
    const rawSamples = Array.isArray(violation.samples) ? violation.samples : [];
    for (const sample of rawSamples.slice(0, 6)) {
      if (sample === null || typeof sample !== "object") continue;
      const target = Array.isArray(sample.target)
        ? sample.target
            .filter((part) => typeof part === "string")
            .map((part) => part.slice(0, 96))
            .slice(0, 4)
        : [];
      const html = sanitizeAxeText(sample.html, 160);
      const failureSummary = sanitizeAxeText(sample.failureSummary, 240);
      const fgColor =
        typeof sample.fgColor === "string" && hexColor.test(sample.fgColor)
          ? sample.fgColor
          : undefined;
      const bgColor =
        typeof sample.bgColor === "string" && hexColor.test(sample.bgColor)
          ? sample.bgColor
          : undefined;
      const contrastRatio =
        typeof sample.contrastRatio === "number" &&
        Number.isFinite(sample.contrastRatio)
          ? sample.contrastRatio
          : undefined;
      samples.push({
        ...(bgColor !== undefined ? { bgColor } : {}),
        ...(contrastRatio !== undefined ? { contrastRatio } : {}),
        ...(failureSummary.length > 0 ? { failureSummary } : {}),
        ...(fgColor !== undefined ? { fgColor } : {}),
        ...(html.length > 0 ? { html } : {}),
        ...(target.length > 0 ? { target } : {}),
      });
    }
    cleaned.push({
      id,
      ...(typeof violation.impact === "string"
        ? { impact: violation.impact.slice(0, 32) }
        : {}),
      nodes:
        typeof violation.nodes === "number" && Number.isFinite(violation.nodes)
          ? violation.nodes
          : samples.length,
      ...(samples.length > 0 ? { samples } : {}),
    });
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

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
  const proposedDiagnostic =
    error !== null && typeof error === "object" && "qaDiagnostic" in error
      ? error.qaDiagnostic
      : "unknown";
  const check =
    typeof proposedCheck === "string" && allowedFailureChecks.has(proposedCheck)
      ? proposedCheck
      : "unknown";
  const axe = sanitizeAxeViolations(
    error !== null && typeof error === "object" && "qaAxeViolations" in error
      ? error.qaAxeViolations
      : undefined,
  );
  return {
    architecture: process.arch,
    ...(axe !== undefined ? { axe } : {}),
    check,
    diagnostic:
      typeof proposedDiagnostic === "string" &&
      (proposedDiagnostic === "unknown" ||
        allowedDiagnosticsByCheck.get(check)?.has(proposedDiagnostic) === true ||
        ((check.endsWith("-axe") ||
          (check.startsWith("appearance-") &&
            check !== "appearance-forced-colors")) &&
          axeRuleDiagnostic.test(proposedDiagnostic)))
        ? proposedDiagnostic
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
  const head = `Packaged UI QA failed during ${receipt.stage}/${receipt.check} (${receipt.errorClass}; ${receipt.diagnostic}).`;
  const samples = (receipt.axe ?? [])
    .flatMap((violation) =>
      (violation.samples ?? []).map((sample) => {
        const target = Array.isArray(sample.target)
          ? sample.target.join(" ")
          : "";
        const pair = [sample.fgColor, sample.bgColor].filter(Boolean).join("/");
        const ratio =
          typeof sample.contrastRatio === "number"
            ? String(sample.contrastRatio)
            : "";
        return [target, pair, ratio].filter((part) => part.length > 0).join(" ");
      }),
    )
    .filter((part) => part.length > 0)
    .slice(0, 6);
  return samples.length > 0 ? `${head} ${samples.join("; ")}.` : head;
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
