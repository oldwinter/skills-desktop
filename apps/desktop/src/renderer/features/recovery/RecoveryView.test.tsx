// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  TargetDefinition,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import {
  RecoveryView,
  recoveryItemCount,
  recoveryItemsFor,
} from "./RecoveryView.js";

afterEach(cleanup);

const localId = "00000000-0000-4000-8000-000000000001";
const guardedId = "00000000-0000-4000-8000-00000000000a";
const blockedId = "00000000-0000-4000-8000-000000000024";

const inventory: WorkspaceSnapshot["inventory"] = {
  activeOperationId: null,
  cliVersion: "1.5.23",
  entries: [],
  freshness: "fresh",
  lastError: null,
  observedAt: "2026-08-21T10:00:00.000Z",
  persistenceWarning: null,
  phase: "ready",
};

const idleMutation: WorkspaceSnapshot["mutation"] = {
  activeOperationId: null,
  commandPlan: null,
  lastError: null,
  outcome: null,
  phase: "idle",
  reconciliationDeadline: null,
};

const localTarget: TargetDefinition = {
  connectionReference: null,
  dialectId: "skills-1.5.23",
  executionBindingDigest: null,
  generation: 1,
  harnessIds: ["codex"],
  id: localId,
  kind: "local",
  label: "This device",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/work/skills-desktop",
  workspaceLabel: "skills-desktop",
};

const guardedTarget: TargetDefinition = {
  ...localTarget,
  generation: 3,
  id: guardedId,
  label: "Laptop",
  workspace: "/work/laptop",
  workspaceLabel: "laptop",
};

function snapshotWith(
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return {
    eventSequence: 1,
    inventory,
    mutation: idleMutation,
    schemaVersion: 2,
    sessionEpoch: "epoch",
    stateRevision: 1,
    target: localTarget,
    ...overrides,
  };
}

function bridge(overrides: Partial<WorkspaceBridge> = {}): WorkspaceBridge {
  const ok = async () => ({ ok: true as const, value: { operationId: "op" } });
  return {
    cancelInventory: ok,
    compareTargets: ok,
    createTarget: ok,
    deleteTarget: ok,
    handoffSkillsSh: ok,
    inspectSource: ok,
    updatePreferences: ok,
    async getSnapshot() {
      return { ok: true, value: snapshotWith() };
    },
    prepareCollection: ok,
    prepareCollectionAcrossTargets: ok,
    prepareComparison: ok,
    prepareMutation: ok,
    reconcileMutation: ok,
    refreshInventory: ok,
    repairTarget: ok,
    requestCancellationReview: ok,
    requestCollectionReview: ok,
    requestHostTrustReview: ok,
    requestReview: ok,
    subscribe: () => () => undefined,
    updateTarget: ok,
    ...overrides,
  };
}

const targetStates = [
  { deletionBlocked: false, inventory, mutation: idleMutation, target: localTarget },
  {
    deletionBlocked: true,
    inventory,
    mutation: {
      ...idleMutation,
      phase: "reconciliation-required" as const,
      reconciliationDeadline: "2026-08-22T10:10:00.000Z",
    },
    target: guardedTarget,
  },
];

describe("RecoveryView", () => {
  it("derives the work list and count from the Snapshot", () => {
    const empty = recoveryItemsFor(snapshotWith(), [targetStates[0]!]);
    expect(recoveryItemCount(empty)).toBe(0);
    const busy = recoveryItemsFor(
      snapshotWith({
        blockedTargets: [
          {
            generation: 4,
            id: blockedId,
            label: "Needs repair",
            legacyHarness: "Future Harness",
            reason: "unsupported_harness",
          },
        ],
        recovery: { repairedTargets: [], restartRequired: true },
      }),
      targetStates,
    );
    expect(recoveryItemCount(busy)).toBe(3);
  });

  it("shows the empty state when nothing needs a typed action", () => {
    render(
      <RecoveryView
        client={bridge()}
        onSelectTarget={vi.fn()}
        snapshot={snapshotWith()}
        targets={[targetStates[0]!]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Recovery" })).toBeInTheDocument();
    expect(screen.getByText("Nothing needs recovery")).toBeInTheDocument();
    expect(screen.getByText("No recovery work")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reconciles a Target from the work list and reports refusals", async () => {
    const reconcileMutation = vi
      .fn<WorkspaceBridge["reconcileMutation"]>()
      .mockResolvedValueOnce({
        error: {
          code: "reconciliation_wait",
          effects: "possible",
          message: "Reconciliation must wait for the original operation deadline.",
          phase: "reconcile",
          retryable: true,
        },
        ok: false,
      })
      .mockResolvedValueOnce({ ok: true, value: { operationId: "reconcile-1" } });
    const onSelectTarget = vi.fn();
    render(
      <RecoveryView
        client={bridge({ reconcileMutation })}
        onSelectTarget={onSelectTarget}
        snapshot={snapshotWith()}
        targets={targetStates}
      />,
    );

    expect(screen.getByText("1 item needs a typed action")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Reconciliation required" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Deadline /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reconcile Laptop" }));
    await waitFor(() => expect(reconcileMutation).toHaveBeenCalledWith(guardedId));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onSelectTarget).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reconcile Laptop" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reconciliation started.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onSelectTarget).toHaveBeenCalledWith(guardedId);
  });

  it("repairs a blocked Target only after a registry harness is chosen", async () => {
    const repairTarget = vi
      .fn<WorkspaceBridge["repairTarget"]>()
      .mockResolvedValue({ ok: true, value: { operationId: blockedId } });
    const { rerender } = render(
      <RecoveryView
        client={bridge({ repairTarget })}
        onSelectTarget={vi.fn()}
        snapshot={snapshotWith({
          blockedTargets: [
            {
              generation: 4,
              id: blockedId,
              label: "Needs repair",
              legacyHarness: "Future Harness",
              reason: "unsupported_harness",
            },
          ],
        })}
        targets={[targetStates[0]!]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Blocked Target Definitions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Future Harness")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Repair Needs repair" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(repairTarget).not.toHaveBeenCalled();

    const select = screen.getByLabelText("Replacement harness");
    expect(select.querySelectorAll("option")).toHaveLength(78);
    fireEvent.change(select, { target: { value: "claude-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Repair Needs repair" }));
    await waitFor(() =>
      expect(repairTarget).toHaveBeenCalledWith(blockedId, "claude-code"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved Needs repair with harness claude-code.",
    );

    rerender(
      <RecoveryView
        client={bridge({ repairTarget })}
        onSelectTarget={vi.fn()}
        snapshot={snapshotWith({
          blockedTargets: [],
          recovery: {
            repairedTargets: [
              { harnessId: "claude-code", id: blockedId, label: "Needs repair" },
            ],
            restartRequired: true,
          },
        })}
        targets={[targetStates[0]!]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Restart required" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Repair Needs repair" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();
  });
});
