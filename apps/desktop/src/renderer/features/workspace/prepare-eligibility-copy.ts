import type { PrepareEligibility } from "../../../contracts/workspace.js";

const blockedReasonCopy: Record<
  NonNullable<PrepareEligibility["reason"]>,
  string
> = {
  "mutation-running": "变更进行中，请等待",
  "reconciliation-required": "需要先完成 reconciliation",
  "ssh-not-in-v1": "SSH · 未在 V1 开放，无法准备变更",
  "stale-inventory": "需要先刷新 inventory 证据",
};

export function isSshNotInV1(eligibility: PrepareEligibility): boolean {
  return eligibility.reason === "ssh-not-in-v1";
}

export function prepareBlockedReasonCopy(
  eligibility: PrepareEligibility,
): string | undefined {
  return eligibility.reason === null
    ? undefined
    : blockedReasonCopy[eligibility.reason];
}

export function prepareBlockedDescribedBy(
  eligibility: PrepareEligibility,
): string | undefined {
  if (eligibility.allowed) return undefined;
  if (isSshNotInV1(eligibility)) return "inventory-ssh-unavailable-reason";
  return [
    "inventory-mutation-blocked-reason",
    eligibility.nextAction === "refresh"
      ? "inventory-refresh-cta"
      : eligibility.nextAction === "reconcile"
        ? "inventory-reconcile-cta"
        : undefined,
  ]
    .filter((id): id is string => id !== undefined)
    .join(" ");
}
