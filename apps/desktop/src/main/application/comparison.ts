import type {
  PublicComparison,
  PublicInventoryEntry,
  PublicInventoryState,
  TargetDefinition,
} from "../../contracts/workspace.js";
import { isInventoryEntryAvailableToHarness } from "../../contracts/inventory-availability.js";

type ComparisonRow = PublicComparison["rows"][number];
type EvidenceDimension = ComparisonRow["dimensions"]["revision"];

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderedEntries(entries: readonly PublicInventoryEntry[]) {
  return [...entries].sort(
    (left, right) =>
      compareText(left.scope, right.scope) ||
      compareText(
        left.declaredSource.sourceType ?? "",
        right.declaredSource.sourceType ?? "",
      ) ||
      compareText(
        left.declaredSource.source ?? "",
        right.declaredSource.source ?? "",
      ),
  );
}

function hasDefiniteValueConflict(
  leftValues: readonly string[],
  leftUnknownCount: number,
  rightValues: readonly string[],
  rightUnknownCount: number,
) {
  if (
    leftValues.length === rightValues.length &&
    !leftValues.every((value, index) => value === rightValues[index])
  ) {
    return true;
  }
  const counts = (values: readonly string[]) => {
    const result = new Map<string, number>();
    for (const value of values) {
      result.set(value, (result.get(value) ?? 0) + 1);
    }
    return result;
  };
  const leftCounts = counts(leftValues);
  const rightCounts = counts(rightValues);
  const keys = new Set([...leftCounts.keys(), ...rightCounts.keys()]);
  for (const key of keys) {
    if (
      (leftCounts.get(key) ?? 0) >
        (rightCounts.get(key) ?? 0) + rightUnknownCount ||
      (rightCounts.get(key) ?? 0) >
        (leftCounts.get(key) ?? 0) + leftUnknownCount
    ) {
      return true;
    }
  }
  return false;
}

function sourceDimension(
  left: readonly PublicInventoryEntry[],
  right: readonly PublicInventoryEntry[],
): ComparisonRow["dimensions"]["declaredSource"] {
  if (left.length === 0 || right.length === 0) return "not-applicable";
  if (left.length !== right.length) return "mismatch";
  const values = (entries: readonly PublicInventoryEntry[]) =>
    entries.map(({ declaredSource }) => {
      if (
        declaredSource.source === null ||
        declaredSource.sourceType === null
      ) {
        return null;
      }
      return `${declaredSource.sourceType}\0${declaredSource.source}`;
    });
  const leftValues = values(left);
  const rightValues = values(right);
  const orderedLeft = leftValues
    .filter((value): value is string => value !== null)
    .sort(compareText);
  const orderedRight = rightValues
    .filter((value): value is string => value !== null)
    .sort(compareText);
  if (
    hasDefiniteValueConflict(
      orderedLeft,
      leftValues.length - orderedLeft.length,
      orderedRight,
      rightValues.length - orderedRight.length,
    )
  ) {
    return "mismatch";
  }
  return orderedLeft.length === leftValues.length &&
    orderedRight.length === rightValues.length
    ? "matched"
    : "unknown";
}

function evidenceDimension(
  left: readonly PublicInventoryEntry[],
  right: readonly PublicInventoryEntry[],
  field: "contentFingerprint" | "revision",
): EvidenceDimension {
  if (left.length === 0 || right.length === 0) return "not-applicable";
  if (left.length !== right.length) return "unknown";
  const known = (entries: readonly PublicInventoryEntry[]) => {
    const groups = new Map<string, string[]>();
    let unknownCount = 0;
    for (const entry of entries) {
      const evidence = entry[field];
      if (evidence.status === "unknown") {
        unknownCount += 1;
        continue;
      }
      const key = `${evidence.authority}\0${evidence.kind}`;
      groups.set(key, [...(groups.get(key) ?? []), evidence.value]);
    }
    return { groups, unknownCount };
  };
  const leftEvidence = known(left);
  const rightEvidence = known(right);
  const leftKeys = [...leftEvidence.groups.keys()].sort(compareText);
  const rightKeys = [...rightEvidence.groups.keys()].sort(compareText);
  if (
    leftKeys.length !== rightKeys.length ||
    !leftKeys.every((key, index) => key === rightKeys[index])
  ) {
    return "unknown";
  }
  for (const key of leftKeys) {
    const leftValues = leftEvidence.groups.get(key)!.sort(compareText);
    const rightValues = rightEvidence.groups.get(key)!.sort(compareText);
    if (
      hasDefiniteValueConflict(
        leftValues,
        leftEvidence.unknownCount,
        rightValues,
        rightEvidence.unknownCount,
      )
    ) {
      return "drift";
    }
  }
  return leftEvidence.unknownCount > 0 || rightEvidence.unknownCount > 0
    ? "unknown"
    : "matched";
}

function harnessAvailability(
  entries: readonly PublicInventoryEntry[],
  harness: string,
): ComparisonRow["left"]["harnessAvailability"] {
  if (entries.length === 0) return "absent";
  return entries.some((entry) =>
    isInventoryEntryAvailableToHarness(entry, harness),
  )
    ? "available"
    : "unavailable";
}

export function compareTargetInventories(input: {
  readonly id: string;
  readonly leftInventory: PublicInventoryState;
  readonly leftTarget: TargetDefinition;
  readonly rightInventory: PublicInventoryState;
  readonly rightTarget: TargetDefinition;
}): PublicComparison {
  const leftByName = new Map<string, PublicInventoryEntry[]>();
  const rightByName = new Map<string, PublicInventoryEntry[]>();
  for (const entry of input.leftInventory.entries) {
    leftByName.set(entry.name, [...(leftByName.get(entry.name) ?? []), entry]);
  }
  for (const entry of input.rightInventory.entries) {
    rightByName.set(entry.name, [
      ...(rightByName.get(entry.name) ?? []),
      entry,
    ]);
  }

  const keys = [...new Set([...leftByName.keys(), ...rightByName.keys()])].sort(
    compareText,
  );
  const rows = keys.map((key): ComparisonRow => {
    const left = orderedEntries(leftByName.get(key) ?? []);
    const right = orderedEntries(rightByName.get(key) ?? []);
    const presence =
      left.length === 0
        ? ("right-only" as const)
        : right.length === 0
          ? ("left-only" as const)
          : ("both" as const);
    const declaredSource = sourceDimension(left, right);
    const revision = evidenceDimension(left, right, "revision");
    const contentFingerprint = evidenceDimension(
      left,
      right,
      "contentFingerprint",
    );
    const summary =
      presence !== "both"
        ? ("missing" as const)
        : declaredSource === "mismatch"
          ? ("source-mismatch" as const)
          : revision === "drift" || contentFingerprint === "drift"
            ? ("version-drift" as const)
            : declaredSource === "unknown" ||
                revision === "unknown" ||
                contentFingerprint === "unknown"
              ? ("unknown-evidence" as const)
              : ("matched" as const);
    return {
      dimensions: {
        contentFingerprint,
        declaredSource,
        presence,
        revision,
      },
      key,
      left: {
        entries: left,
        freshness: input.leftInventory.freshness,
        harnessAvailability: harnessAvailability(
          left,
          input.leftTarget.harness,
        ),
      },
      right: {
        entries: right,
        freshness: input.rightInventory.freshness,
        harnessAvailability: harnessAvailability(
          right,
          input.rightTarget.harness,
        ),
      },
      summary,
    };
  });

  return {
    id: input.id,
    leftFreshness: input.leftInventory.freshness,
    leftTargetId: input.leftTarget.id,
    rightFreshness: input.rightInventory.freshness,
    rightTargetId: input.rightTarget.id,
    rows,
  };
}
