import type { Translator } from "../../../contracts/i18n/translate.js";
import type {
  PublicInventoryEntry,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";

export function freshnessLabel(
  t: Translator["t"],
  freshness: WorkspaceSnapshot["inventory"]["freshness"],
) {
  if (freshness === "fresh") return t("common.freshness.fresh");
  if (freshness === "stale") return t("common.freshness.stale");
  return t("common.freshness.none");
}

export function isTargetOffline(snapshot: WorkspaceSnapshot) {
  return (
    snapshot.target.kind === "ssh" &&
    snapshot.inventory.lastError !== null &&
    ["transport_failed", "transport_lost", "transport_unavailable"].includes(
      snapshot.inventory.lastError.code,
    )
  );
}

export function statusLabel(t: Translator["t"], snapshot: WorkspaceSnapshot) {
  const { freshness, phase } = snapshot.inventory;
  const label = freshnessLabel(t, freshness);
  if (phase === "loading") return t("status.refreshing", { freshness: label });
  if (phase === "cancelled")
    return t("status.refreshCancelled", { freshness: label });
  if (phase === "error" && isTargetOffline(snapshot))
    return t("status.offline", { freshness: label });
  if (phase === "error")
    return freshness === "stale"
      ? t("status.staleAfterError")
      : t("status.refreshError");
  return label;
}

export function statusTone(snapshot: WorkspaceSnapshot) {
  if (snapshot.inventory.phase === "error") return "danger";
  if (
    snapshot.inventory.phase === "cancelled" ||
    snapshot.inventory.freshness === "stale"
  ) {
    return "warning";
  }
  return snapshot.inventory.freshness === "fresh" ? "healthy" : "neutral";
}

export function scopeLabel(
  t: Translator["t"],
  scope: PublicInventoryEntry["scope"],
) {
  return scope === "project"
    ? t("common.scope.project")
    : t("common.scope.global");
}

export function scopeFilterLabel(
  t: Translator["t"],
  scope: PublicInventoryEntry["scope"],
) {
  return scope === "project"
    ? t("common.scope.projectScope")
    : t("common.scope.globalScope");
}

export function targetOptionLabel(
  t: Translator["t"],
  target: WorkspaceSnapshot["target"],
) {
  return target.kind === "ssh"
    ? t("common.ssh.targetOption", { label: target.label })
    : target.label;
}

export function sourceLabel(t: Translator["t"], entry: PublicInventoryEntry) {
  return entry.declaredSource.source ?? t("inventory.provenanceUnavailable");
}
