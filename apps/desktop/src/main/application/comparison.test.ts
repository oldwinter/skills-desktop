import { describe, expect, it } from "vitest";

import {
  publicComparisonSchema,
  type PublicComparison,
  type PublicInventoryEntry,
  type PublicInventoryState,
  type TargetDefinition,
} from "../../contracts/workspace.js";
import { compareTargetInventories } from "./comparison.js";

type ComparisonRow = PublicComparison["rows"][number];
type Evidence = PublicInventoryEntry["revision"];

const leftTarget: TargetDefinition = {
  connectionReference: null,
  dialectId: "skills-1.5.23",
  executionBindingDigest: null,
  generation: 1,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "Left device",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/work/left",
  workspaceLabel: "left",
};

const rightTarget: TargetDefinition = {
  ...leftTarget,
  harnessIds: ["claude-code"],
  id: "00000000-0000-4000-8000-000000000002",
  label: "Right device",
  workspace: "/work/right",
  workspaceLabel: "right",
};

const unknownEvidence: Evidence = { status: "unknown" };

function revision(value: string, kind = "git-commit"): Evidence {
  return { authority: "npx-skills", kind, status: "known", value };
}

function fingerprint(value: string): Evidence {
  return revision(value, "sha256");
}

function source(
  value: string | null,
  sourceType: string | null = null,
): PublicInventoryEntry["declaredSource"] {
  return { source: value, sourceType: value === null ? null : sourceType };
}

function entry(
  name: string,
  overrides: Partial<PublicInventoryEntry> = {},
): PublicInventoryEntry {
  return {
    agents: ["Codex"],
    contentFingerprint: unknownEvidence,
    declaredSource: source("example/source", "github"),
    name,
    revision: unknownEvidence,
    scope: "project",
    ...overrides,
  };
}

function inventory(
  entries: readonly PublicInventoryEntry[],
  freshness: PublicInventoryState["freshness"] = "fresh",
): PublicInventoryState {
  return {
    activeOperationId: null,
    cliVersion: "1.5.23",
    entries: [...entries],
    freshness,
    lastError: null,
    observedAt: "2026-08-21T10:00:00.000Z",
    persistenceWarning: null,
    phase: "ready",
  };
}

function compare(
  leftEntries: readonly PublicInventoryEntry[],
  rightEntries: readonly PublicInventoryEntry[],
  options: {
    readonly leftFreshness?: PublicInventoryState["freshness"];
    readonly leftTarget?: TargetDefinition;
    readonly rightFreshness?: PublicInventoryState["freshness"];
    readonly rightTarget?: TargetDefinition;
  } = {},
): PublicComparison {
  return compareTargetInventories({
    id: "comparison-under-test",
    leftInventory: inventory(leftEntries, options.leftFreshness),
    leftTarget: options.leftTarget ?? leftTarget,
    rightInventory: inventory(rightEntries, options.rightFreshness),
    rightTarget: options.rightTarget ?? rightTarget,
  });
}

function rowsByKey(comparison: PublicComparison) {
  return new Map(comparison.rows.map((row) => [row.key, row]));
}

describe("compareTargetInventories (ADR 0004)", () => {
  const cases: ReadonlyArray<{
    readonly dimensions: ComparisonRow["dimensions"];
    readonly left: readonly PublicInventoryEntry[];
    readonly name: string;
    readonly right: readonly PublicInventoryEntry[];
    readonly summary: ComparisonRow["summary"];
  }> = [
    {
      dimensions: {
        contentFingerprint: "matched",
        declaredSource: "matched",
        presence: "both",
        revision: "matched",
      },
      left: [
        entry("skill", {
          contentFingerprint: fingerprint("fp"),
          revision: revision("rev"),
        }),
      ],
      name: "matched when source, revision, and fingerprint all agree",
      right: [
        entry("skill", {
          contentFingerprint: fingerprint("fp"),
          revision: revision("rev"),
        }),
      ],
      summary: "matched",
    },
    {
      dimensions: {
        contentFingerprint: "not-applicable",
        declaredSource: "not-applicable",
        presence: "left-only",
        revision: "not-applicable",
      },
      left: [entry("skill", { revision: revision("rev") })],
      name: "missing when the key exists only on the left",
      right: [],
      summary: "missing",
    },
    {
      dimensions: {
        contentFingerprint: "not-applicable",
        declaredSource: "not-applicable",
        presence: "right-only",
        revision: "not-applicable",
      },
      left: [],
      name: "missing when the key exists only on the right",
      right: [entry("skill")],
      summary: "missing",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "mismatch",
        presence: "both",
        revision: "matched",
      },
      left: [
        entry("skill", {
          declaredSource: source("example/left", "github"),
          revision: revision("rev"),
        }),
      ],
      name: "source-mismatch when declared sources differ",
      right: [
        entry("skill", {
          declaredSource: source("example/right", "github"),
          revision: revision("rev"),
        }),
      ],
      summary: "source-mismatch",
    },
    {
      dimensions: {
        contentFingerprint: "matched",
        declaredSource: "matched",
        presence: "both",
        revision: "drift",
      },
      left: [
        entry("skill", {
          contentFingerprint: fingerprint("fp"),
          revision: revision("one"),
        }),
      ],
      name: "version-drift when known revisions differ",
      right: [
        entry("skill", {
          contentFingerprint: fingerprint("fp"),
          revision: revision("two"),
        }),
      ],
      summary: "version-drift",
    },
    {
      dimensions: {
        contentFingerprint: "drift",
        declaredSource: "matched",
        presence: "both",
        revision: "matched",
      },
      left: [
        entry("skill", {
          contentFingerprint: fingerprint("left"),
          revision: revision("rev"),
        }),
      ],
      name: "version-drift when only content fingerprints differ",
      right: [
        entry("skill", {
          contentFingerprint: fingerprint("right"),
          revision: revision("rev"),
        }),
      ],
      summary: "version-drift",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "matched",
        presence: "both",
        revision: "unknown",
      },
      left: [entry("skill")],
      name: "unknown-evidence when revisions are unknown on both sides",
      right: [entry("skill")],
      summary: "unknown-evidence",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "matched",
        presence: "both",
        revision: "unknown",
      },
      left: [entry("skill", { revision: revision("rev") })],
      name: "unknown-evidence when one side's revision is unknown",
      right: [entry("skill")],
      summary: "unknown-evidence",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "matched",
        presence: "both",
        revision: "matched",
      },
      left: [entry("skill", { revision: revision("rev") })],
      name: "unknown-evidence when only fingerprints are absent",
      right: [entry("skill", { revision: revision("rev") })],
      summary: "unknown-evidence",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "unknown",
        presence: "both",
        revision: "matched",
      },
      left: [
        entry("skill", {
          declaredSource: source("example/source", "github"),
          revision: revision("rev"),
        }),
      ],
      name: "unknown-evidence when one side's declared source is null",
      right: [
        entry("skill", {
          declaredSource: source(null),
          revision: revision("rev"),
        }),
      ],
      summary: "unknown-evidence",
    },
    {
      dimensions: {
        contentFingerprint: "matched",
        declaredSource: "matched",
        presence: "both",
        revision: "unknown",
      },
      left: [
        entry("skill", {
          contentFingerprint: fingerprint("fp"),
          revision: revision("rev", "git-commit"),
        }),
      ],
      name: "unknown-evidence when revision kinds are incomparable",
      right: [
        entry("skill", {
          contentFingerprint: fingerprint("fp"),
          revision: revision("rev", "etag"),
        }),
      ],
      summary: "unknown-evidence",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "mismatch",
        presence: "both",
        revision: "drift",
      },
      left: [
        entry("skill", {
          declaredSource: source("example/left", "github"),
          revision: revision("one"),
        }),
      ],
      name: "source-mismatch outranks version-drift",
      right: [
        entry("skill", {
          declaredSource: source("example/right", "github"),
          revision: revision("two"),
        }),
      ],
      summary: "source-mismatch",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "unknown",
        presence: "both",
        revision: "drift",
      },
      left: [
        entry("skill", {
          declaredSource: source(null),
          revision: revision("one"),
        }),
      ],
      name: "version-drift outranks unknown declared source",
      right: [
        entry("skill", {
          declaredSource: source(null),
          revision: revision("two"),
        }),
      ],
      summary: "version-drift",
    },
    {
      dimensions: {
        contentFingerprint: "drift",
        declaredSource: "matched",
        presence: "both",
        revision: "unknown",
      },
      left: [
        entry("skill", {
          contentFingerprint: fingerprint("left"),
          revision: revision("rev"),
        }),
      ],
      name: "version-drift outranks unknown revision evidence",
      right: [
        entry("skill", {
          contentFingerprint: fingerprint("right"),
        }),
      ],
      summary: "version-drift",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "mismatch",
        presence: "both",
        revision: "unknown",
      },
      left: [entry("skill", { revision: revision("rev") })],
      name: "source-mismatch when entry counts differ for one key",
      right: [
        entry("skill", { revision: revision("rev"), scope: "global" }),
        entry("skill", { revision: revision("rev"), scope: "project" }),
      ],
      summary: "source-mismatch",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "unknown",
        presence: "both",
        revision: "unknown",
      },
      left: [
        entry("skill", {
          declaredSource: source("example/a", "github"),
          revision: revision("one"),
          scope: "global",
        }),
        entry("skill", {
          declaredSource: source(null),
          scope: "project",
        }),
      ],
      name: "unknown-evidence when unknown entries can absorb the difference",
      right: [
        entry("skill", {
          declaredSource: source("example/a", "github"),
          revision: revision("one"),
          scope: "global",
        }),
        entry("skill", {
          declaredSource: source("example/b", "github"),
          revision: revision("two"),
          scope: "project",
        }),
      ],
      summary: "unknown-evidence",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "matched",
        presence: "both",
        revision: "drift",
      },
      left: [
        entry("skill", { revision: revision("same"), scope: "global" }),
        entry("skill", { revision: revision("same"), scope: "project" }),
      ],
      name: "version-drift when one unknown cannot cover two differing revisions",
      right: [
        entry("skill", { revision: revision("other"), scope: "global" }),
        entry("skill", { scope: "project" }),
      ],
      summary: "version-drift",
    },
    {
      dimensions: {
        contentFingerprint: "unknown",
        declaredSource: "matched",
        presence: "both",
        revision: "unknown",
      },
      left: [
        entry("skill", { revision: revision("same"), scope: "global" }),
        entry("skill", { scope: "project" }),
      ],
      name: "unknown-evidence when the unknown entry can take the seen value",
      right: [
        entry("skill", { revision: revision("same"), scope: "global" }),
        entry("skill", { revision: revision("same"), scope: "project" }),
      ],
      summary: "unknown-evidence",
    },
  ];

  it.each(cases)("$name", ({ dimensions, left, right, summary }) => {
    const comparison = compare(left, right);
    expect(comparison.rows).toHaveLength(1);
    expect(comparison.rows[0]).toMatchObject({
      dimensions,
      key: "skill",
      summary,
    });
    expect(publicComparisonSchema.safeParse(comparison).success).toBe(true);
  });

  it("sorts rows by key and orders each side's entries by scope then source", () => {
    const comparison = compare(
      [
        entry("zeta"),
        entry("multi", {
          declaredSource: source("b.example", "github"),
          scope: "project",
        }),
        entry("multi", {
          declaredSource: source("a.example", "github"),
          scope: "global",
        }),
        entry("alpha"),
      ],
      [
        entry("multi", {
          declaredSource: source("a.example", "local"),
          scope: "project",
        }),
        entry("multi", {
          declaredSource: source("z.example", "github"),
          scope: "project",
        }),
        entry("multi", {
          declaredSource: source("a.example", "github"),
          scope: "project",
        }),
      ],
    );

    expect(comparison.rows.map((row) => row.key)).toEqual([
      "alpha",
      "multi",
      "zeta",
    ]);
    const multi = comparison.rows[1];
    expect(
      multi?.left.entries.map(
        ({ declaredSource, scope }) => `${scope}:${declaredSource.source}`,
      ),
    ).toEqual(["global:a.example", "project:b.example"]);
    expect(
      multi?.right.entries.map(
        ({ declaredSource, scope }) =>
          `${scope}:${declaredSource.sourceType}:${declaredSource.source}`,
      ),
    ).toEqual([
      "project:github:a.example",
      "project:github:z.example",
      "project:local:a.example",
    ]);
  });

  it("echoes ids and per-side freshness", () => {
    const comparison = compare([entry("skill")], [entry("skill")], {
      leftFreshness: "stale",
      rightFreshness: "fresh",
    });

    expect(comparison).toMatchObject({
      id: "comparison-under-test",
      leftFreshness: "stale",
      leftTargetId: leftTarget.id,
      rightFreshness: "fresh",
      rightTargetId: rightTarget.id,
    });
    expect(comparison.rows[0]).toMatchObject({
      left: { freshness: "stale" },
      right: { freshness: "fresh" },
    });
  });

  it("reports absent, available, and unavailable harness availability per side", () => {
    const bothHarnesses: TargetDefinition = {
      ...leftTarget,
      harnessIds: ["claude-code", "codex"],
    };
    const comparison = compare(
      [
        entry("covered", { agents: ["Claude Code"], scope: "global" }),
        entry("covered", { agents: ["Codex"], scope: "project" }),
        entry("partial", { agents: ["Codex"] }),
        entry("left-only", { agents: ["Claude Code", "Codex"] }),
      ],
      [
        entry("covered", { agents: ["Claude Code"], scope: "project" }),
        entry("partial", { agents: ["Codex"], scope: "global" }),
      ],
      { leftTarget: bothHarnesses },
    );

    const rows = rowsByKey(comparison);
    expect(rows.get("covered")).toMatchObject({
      left: { harnessAvailability: "available" },
      right: { harnessAvailability: "available" },
    });
    expect(rows.get("partial")).toMatchObject({
      left: { harnessAvailability: "unavailable" },
      right: { harnessAvailability: "unavailable" },
    });
    expect(rows.get("left-only")).toMatchObject({
      left: { harnessAvailability: "available" },
      right: { harnessAvailability: "absent" },
    });
  });
});
