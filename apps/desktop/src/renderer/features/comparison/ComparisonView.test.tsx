// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PublicComparison,
  RendererError,
  TargetDefinition,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { ComparisonView } from "./ComparisonView.js";

afterEach(cleanup);

const leftId = "00000000-0000-4000-8000-000000000001";
const rightId = "00000000-0000-4000-8000-00000000000a";
const sshId = "00000000-0000-4000-8000-000000000018";

const error: RendererError = {
  code: "target_unavailable",
  effects: "none",
  message: "Comparison failed.",
  phase: "comparison",
  retryable: true,
};

const inventory: WorkspaceSnapshot["inventory"] = {
  activeOperationId: null,
  cliVersion: "1.5.23",
  entries: [
    {
      agents: [],
      contentFingerprint: { status: "unknown" },
      declaredSource: { source: "example/skills", sourceType: "github" },
      name: "find-skills",
      revision: { status: "unknown" },
      scope: "project",
    },
  ],
  freshness: "fresh",
  lastError: null,
  observedAt: "2026-08-21T10:00:00.000Z",
  persistenceWarning: null,
  phase: "ready",
};

const mutation: WorkspaceSnapshot["mutation"] = {
  activeOperationId: null,
  commandPlan: null,
  lastError: null,
  outcome: null,
  phase: "idle",
  reconciliationDeadline: null,
};

const targetV4Metadata = {
  dialectId: "skills-1.5.23" as const,
  executionBindingDigest: null,
  harnessIds: ["codex"],
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de" as const,
  registryVersion: 1 as const,
};

const leftTarget: TargetDefinition = {
  connectionReference: null,
  ...targetV4Metadata,
  generation: 1,
  id: leftId,
  kind: "local",
  label: "Left device",
  workspace: "/work/left",
  workspaceLabel: "left",
};

const rightTarget: TargetDefinition = {
  connectionReference: null,
  ...targetV4Metadata,
  generation: 1,
  id: rightId,
  kind: "local",
  label: "Right device",
  workspace: "/work/right",
  workspaceLabel: "right",
};

const sshTarget: TargetDefinition = {
  connectionReference: "build-host",
  ...targetV4Metadata,
  generation: 1,
  id: sshId,
  kind: "ssh",
  label: "SSH device",
  workspace: "/srv/workspace",
  workspaceLabel: "ssh",
};

function targetState(
  target: TargetDefinition,
  overrides: Partial<{
    inventory: WorkspaceSnapshot["inventory"];
    mutation: WorkspaceSnapshot["mutation"];
  }> = {},
) {
  return {
    deletionBlocked: false,
    inventory: overrides.inventory ?? inventory,
    mutation: overrides.mutation ?? mutation,
    target,
  };
}

function bridge(overrides: Partial<WorkspaceBridge> = {}): WorkspaceBridge {
  return {
    async cancelInventory(operationId) {
      return { ok: true, value: { operationId } };
    },
    async compareTargets() {
      return { ok: true, value: { operationId: "comparison-1" } };
    },
    async createTarget() {
      return { ok: true, value: { operationId: "created-target" } };
    },
    async deleteTarget(targetId) {
      return { ok: true, value: { operationId: targetId } };
    },
    async getSnapshot() {
      return {
        ok: false,
        error: {
          code: "internal_error",
          effects: "none",
          message: "unused",
          phase: "snapshot",
          retryable: true,
        },
      };
    },
    async prepareCollection() {
      return { ok: true, value: { operationId: "collection-plan-1" } };
    },
    async prepareCollectionAcrossTargets() {
      return { ok: true, value: { operationId: "collection-plan-many" } };
    },
    async prepareComparison() {
      return { ok: true, value: { operationId: "prepared-comparison-1" } };
    },
    async prepareMutation() {
      return { ok: true, value: { operationId: "prepared-1" } };
    },
    async reconcileMutation() {
      return { ok: true, value: { operationId: "reconcile-1" } };
    },
    async refreshInventory() {
      return { ok: true, value: { operationId: "refresh-1" } };
    },
    async requestCancellationReview() {
      return { ok: true, value: { operationId: "cancel-review-1" } };
    },
    async requestCollectionReview() {
      return { ok: true, value: { operationId: "collection-review-1" } };
    },
    async requestHostTrustReview() {
      return { ok: true, value: { operationId: "host-trust-review-1" } };
    },
    async requestReview() {
      return { ok: true, value: { operationId: "review-1" } };
    },
    subscribe() {
      return () => undefined;
    },
    async updateTarget(targetId) {
      return { ok: true, value: { operationId: targetId } };
    },
    ...overrides,
  };
}

function baseSnapshot(
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return {
    eventSequence: 0,
    inventory,
    mutation,
    schemaVersion: 2,
    sessionEpoch: "epoch-1",
    stateRevision: 1,
    target: leftTarget,
    targets: [targetState(leftTarget), targetState(rightTarget)],
    ...overrides,
  };
}

const missingRow: PublicComparison["rows"][number] = {
  dimensions: {
    contentFingerprint: "not-applicable",
    declaredSource: "not-applicable",
    presence: "left-only",
    revision: "not-applicable",
  },
  key: "find-skills",
  left: {
    entries: inventory.entries,
    freshness: "fresh",
    harnessAvailability: "available",
  },
  right: {
    entries: [],
    freshness: "fresh",
    harnessAvailability: "absent",
  },
  summary: "missing",
};

const driftRow: PublicComparison["rows"][number] = {
  dimensions: {
    contentFingerprint: "drift",
    declaredSource: "matched",
    presence: "both",
    revision: "drift",
  },
  key: "tdd",
  left: {
    entries: [
      {
        agents: [],
        contentFingerprint: {
          authority: "cli",
          kind: "sha256",
          status: "known",
          value: "a".repeat(64),
        },
        declaredSource: { source: null, sourceType: null },
        name: "tdd",
        revision: {
          authority: "git",
          kind: "commit",
          status: "known",
          value: "0123456789abcdef0123456789abcdef01234567",
        },
        scope: "project",
      },
    ],
    freshness: "fresh",
    harnessAvailability: "available",
  },
  right: {
    entries: [
      {
        agents: [],
        contentFingerprint: { status: "unknown" },
        declaredSource: { source: "example/skills", sourceType: "github" },
        name: "tdd",
        revision: { status: "unknown" },
        scope: "global",
      },
    ],
    freshness: "fresh",
    harnessAvailability: "available",
  },
  summary: "version-drift",
};

describe("ComparisonView", () => {
  it("asks for a second Local Target and explains SSH unavailability", () => {
    render(
      <ComparisonView
        client={bridge()}
        onPrepared={vi.fn()}
        snapshot={baseSnapshot({
          targets: [targetState(leftTarget), targetState(sshTarget)],
        })}
        targets={[targetState(leftTarget), targetState(sshTarget)]}
      />,
    );

    expect(
      screen.getByText(/Comparison needs two Local Targets/),
    ).toBeInTheDocument();
    expect(screen.getByText(/SSH · 未在 V1 开放/)).toBeInTheDocument();
    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    expect(compare).toHaveAttribute(
      "title",
      "Comparison needs two Local Targets",
    );
    expect(compare).toHaveAttribute(
      "aria-describedby",
      "comparison-needs-two-targets",
    );
  });

  it("gives an executable next step when only one Local Target is present (#140)", () => {
    render(
      <ComparisonView
        client={bridge()}
        onPrepared={vi.fn()}
        snapshot={baseSnapshot({
          target: leftTarget,
          targets: [targetState(leftTarget)],
        })}
        targets={[targetState(leftTarget)]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No comparison selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No difference selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Add another Local Target under Targets, then return here to compare inventories.",
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByText("Click Compare to build the aligned skill table."),
    ).not.toBeInTheDocument();

    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    expect(compare).toHaveAttribute(
      "title",
      "Comparison needs two Local Targets",
    );
    expect(compare).toHaveAttribute(
      "aria-describedby",
      "comparison-needs-two-targets",
    );
    expect(
      document.getElementById("comparison-needs-two-targets"),
    ).toHaveTextContent("Comparison needs two Local Targets");
  });

  it("explains disabled Compare when Left and Right stay the same after a second Target is added (#140)", () => {
    const { rerender } = render(
      <ComparisonView
        client={bridge()}
        onPrepared={vi.fn()}
        snapshot={baseSnapshot({
          target: leftTarget,
          targets: [targetState(leftTarget)],
        })}
        targets={[targetState(leftTarget)]}
      />,
    );

    rerender(
      <ComparisonView
        client={bridge()}
        onPrepared={vi.fn()}
        snapshot={baseSnapshot({
          targets: [targetState(leftTarget), targetState(rightTarget)],
        })}
        targets={[targetState(leftTarget), targetState(rightTarget)]}
      />,
    );

    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    expect(compare).toHaveAttribute(
      "title",
      "Left and Right must be different Targets",
    );
    expect(compare).toHaveAttribute(
      "aria-describedby",
      "comparison-same-sides-reason",
    );
    expect(
      document.getElementById("comparison-same-sides-reason"),
    ).toHaveTextContent("Left and Right must be different Targets");
    expect(
      screen.getAllByText(
        "Choose different Left and Right Targets, then click Compare to build the aligned skill table.",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("compares Local Targets, prepares eligible rows, and surfaces errors", async () => {
    const compareTargets = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "comparison-opened" },
    }));
    const prepareComparison = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-comparison-1" },
    }));
    const refreshInventory = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "refresh-1" },
    }));
    const onPrepared = vi.fn();
    const comparison: PublicComparison = {
      id: "comparison-1",
      leftFreshness: "fresh",
      leftTargetId: leftId,
      rightFreshness: "fresh",
      rightTargetId: rightId,
      rows: [missingRow, driftRow],
    };

    render(
      <ComparisonView
        client={bridge({ compareTargets, prepareComparison, refreshInventory })}
        onPrepared={onPrepared}
        snapshot={baseSnapshot({ comparison })}
        targets={[targetState(leftTarget), targetState(rightTarget)]}
      />,
    );

    expect(screen.getByText("2 aligned skill keys")).toBeInTheDocument();
    expect(screen.getAllByText("Fresh evidence").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() =>
      expect(compareTargets).toHaveBeenCalledWith(leftId, rightId),
    );

    fireEvent.click(screen.getByRole("button", { name: "tdd" }));
    expect(screen.getAllByText("Revision or content drift").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Unknown type \/ Unknown source/).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/cli \/ sha256/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Prepare for Left" }));
    await waitFor(() =>
      expect(prepareComparison).toHaveBeenCalledWith(
        "comparison-1",
        "tdd",
        leftId,
      ),
    );
    expect(onPrepared).toHaveBeenCalledWith("prepared-comparison-1", leftId);

    fireEvent.click(screen.getByRole("button", { name: "find-skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare for Right" }));
    await waitFor(() =>
      expect(prepareComparison).toHaveBeenCalledWith(
        "comparison-1",
        "find-skills",
        rightId,
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh Left device" }),
    );
    await waitFor(() => expect(refreshInventory).toHaveBeenCalledWith(leftId));

    fireEvent.click(
      screen.getByRole("button", { name: "Swap comparison Targets" }),
    );
    expect(screen.getByText("No comparison selected")).toBeInTheDocument();
    expect(
      screen.getAllByText("Click Compare to build the aligned skill table.")
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Compare" })).toBeEnabled();
  });

  it("blocks planning on stale evidence, reconciliation, and compare failures", async () => {
    const compareTargets = vi.fn(async () => ({
      ok: false as const,
      error,
    }));
    const prepareComparison = vi.fn(async () => ({
      ok: false as const,
      error,
    }));
    const comparison: PublicComparison = {
      id: "comparison-stale",
      leftFreshness: "stale",
      leftTargetId: leftId,
      rightFreshness: "none",
      rightTargetId: rightId,
      rows: [
        {
          ...missingRow,
          left: {
            ...missingRow.left,
            freshness: "stale",
          },
          right: {
            ...missingRow.right,
            freshness: "none",
          },
        },
      ],
    };

    render(
      <ComparisonView
        client={bridge({ compareTargets, prepareComparison })}
        onPrepared={vi.fn()}
        snapshot={baseSnapshot({
          comparison,
          targets: [
            targetState(leftTarget, {
              inventory: {
                ...inventory,
                freshness: "stale",
                lastError: error,
                phase: "error",
              },
            }),
            targetState(rightTarget, {
              inventory: { ...inventory, freshness: "none", phase: "ready" },
              mutation: {
                ...mutation,
                phase: "reconciliation-required",
              },
            }),
          ],
        })}
        targets={[
          targetState(leftTarget, {
            inventory: {
              ...inventory,
              freshness: "stale",
              lastError: error,
              phase: "error",
            },
          }),
          targetState(rightTarget, {
            inventory: { ...inventory, freshness: "none", phase: "ready" },
            mutation: {
              ...mutation,
              phase: "reconciliation-required",
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Stale evidence")).toBeInTheDocument();
    // right side prefers mutation phase over freshness when reconciliation-required
    expect(
      screen.getByText("Blocked: reconciliation required"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No evidence")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Fresh evidence is required on both Targets/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare for Left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Prepare for Right" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reconciliation is required before this Target can receive a comparison mutation.",
    );

    cleanup();
    render(
      <ComparisonView
        client={bridge({
          compareTargets: vi.fn(async () => ({
            ok: true as const,
            value: { operationId: "ok" },
          })),
          prepareComparison,
        })}
        onPrepared={vi.fn()}
        snapshot={baseSnapshot({
          comparison: {
            id: "comparison-empty",
            leftFreshness: "fresh",
            leftTargetId: leftId,
            rightFreshness: "fresh",
            rightTargetId: rightId,
            rows: [],
          },
        })}
        targets={[targetState(leftTarget), targetState(rightTarget)]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "No skill evidence on either Target" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No difference selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Select a skill in the table to inspect the difference."),
    ).toBeInTheDocument();
  });

  it("shows loading inventory status and keeps SSH destinations inert", async () => {
    const prepareComparison = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-comparison-1" },
    }));
    render(
      <ComparisonView
        client={bridge({ prepareComparison })}
        onPrepared={vi.fn()}
        snapshot={baseSnapshot({
          comparison: {
            id: "comparison-1",
            leftFreshness: "fresh",
            leftTargetId: leftId,
            rightFreshness: "fresh",
            rightTargetId: rightId,
            rows: [missingRow],
          },
          targets: [
            targetState(leftTarget, {
              inventory: { ...inventory, phase: "loading" },
            }),
            targetState(rightTarget),
            targetState(sshTarget),
          ],
        })}
        targets={[
          targetState(leftTarget, {
            inventory: { ...inventory, phase: "loading" },
          }),
          targetState(rightTarget),
          targetState(sshTarget),
        ]}
      />,
    );

    expect(screen.getByText("Loading Inventory")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh Left device" }),
    ).toBeDisabled();
    const sshOption = screen.getAllByRole("option", {
      name: /SSH device · 未开放/,
    })[0];
    expect(sshOption).toBeDisabled();
  });
});
