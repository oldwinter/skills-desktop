import type {
  PublicInventoryEntry,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";

export function freshnessLabel(
  freshness: WorkspaceSnapshot["inventory"]["freshness"],
) {
  if (freshness === "fresh") return "Fresh evidence";
  if (freshness === "stale") return "Stale evidence";
  return "No evidence";
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

export function statusLabel(snapshot: WorkspaceSnapshot) {
  const { freshness, phase } = snapshot.inventory;
  if (phase === "loading") return `Refreshing - ${freshnessLabel(freshness)}`;
  if (phase === "cancelled")
    return `Refresh cancelled - ${freshnessLabel(freshness)}`;
  if (phase === "error" && isTargetOffline(snapshot))
    return `Offline - ${freshnessLabel(freshness)}`;
  if (phase === "error")
    return freshness === "stale" ? "Stale after error" : "Refresh error";
  return freshnessLabel(freshness);
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

export function scopeLabel(scope: PublicInventoryEntry["scope"]) {
  return scope === "project" ? "Project" : "Global";
}

export function sourceLabel(entry: PublicInventoryEntry) {
  return entry.declaredSource.source ?? "Provenance unavailable";
}
