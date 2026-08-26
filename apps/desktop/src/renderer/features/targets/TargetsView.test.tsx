// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RendererError,
  TargetDefinition,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { TargetsView } from "./TargetsView.js";

afterEach(cleanup);

const localId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-00000000000a";
const sshId = "00000000-0000-4000-8000-000000000018";

const error: RendererError = {
  code: "invalid_request",
  effects: "none",
  message: "Target draft rejected.",
  phase: "target",
  retryable: false,
};

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

const mutation: WorkspaceSnapshot["mutation"] = {
  activeOperationId: null,
  commandPlan: null,
  lastError: null,
  outcome: null,
  phase: "idle",
  reconciliationDeadline: null,
};

function targetState(
  target: TargetDefinition,
  overrides: Partial<{
    deletionBlocked: boolean;
    inventory: WorkspaceSnapshot["inventory"];
  }> = {},
) {
  return {
    deletionBlocked: overrides.deletionBlocked ?? false,
    inventory: overrides.inventory ?? inventory,
    mutation,
    target,
  };
}

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

const secondTarget: TargetDefinition = {
  ...localTarget,
  generation: 2,
  id: secondId,
  kind: "local",
  label: "Second device",
  workspace: "/work/second",
  workspaceLabel: "second",
};

const sshTarget: TargetDefinition = {
  ...localTarget,
  connectionReference: "build-host",
  generation: 3,
  id: sshId,
  kind: "ssh",
  label: "Build host",
  workspace: "/srv/workspace",
  workspaceLabel: "build-host",
};

function bridge(
  overrides: Partial<WorkspaceBridge> = {},
): WorkspaceBridge {
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

describe("TargetsView", () => {
  it("creates a Local Target and surfaces save feedback", async () => {
    const createTarget = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "created-local-target" },
    }));
    const onSelected = vi.fn();
    render(
      <TargetsView
        client={bridge({ createTarget })}
        onSelected={onSelected}
        targets={[targetState(localTarget, { deletionBlocked: true })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Target" }));
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Local workspace" },
    });
    fireEvent.change(screen.getByLabelText("Canonical workspace"), {
      target: { value: "/work/other" },
    });
    fireEvent.change(screen.getByLabelText("Harness"), {
      target: { value: "codex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Target" }));

    await waitFor(() =>
      expect(createTarget).toHaveBeenCalledWith({
        connectionReference: null,
        harnessIds: ["codex"],
        kind: "local",
        label: "Local workspace",
        workspace: "/work/other",
      }),
    );
    expect(await screen.findByText("Target created")).toBeInTheDocument();
    expect(onSelected).toHaveBeenCalledWith("created-local-target");
    expect(
      screen.getByRole("button", { name: `Delete ${localTarget.label}` }),
    ).toBeDisabled();
  });

  it("updates an existing Target and reports failures", async () => {
    const updateTarget = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: localId },
    }));
    const createTarget = vi.fn(async () => ({
      ok: false as const,
      error,
    }));
    const { rerender } = render(
      <TargetsView
        client={bridge({ updateTarget, createTarget })}
        onSelected={vi.fn()}
        targets={[
          targetState(localTarget),
          targetState(sshTarget, {
            inventory: {
              ...inventory,
              freshness: "none",
              lastError: error,
              phase: "loading",
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("SSH · 未在 V1 开放")).toBeInTheDocument();
    expect(screen.getByText("未开放")).toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.getByText("请求无效。请检查输入后重试。")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: `Edit ${localTarget.label}` }),
    );
    expect(screen.getByText("Edit Definition")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Renamed device" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Target" }));
    await waitFor(() =>
      expect(updateTarget).toHaveBeenCalledWith(localId, {
        connectionReference: null,
        harnessIds: ["codex"],
        kind: "local",
        label: "Renamed device",
        workspace: "/work/skills-desktop",
      }),
    );
    expect(await screen.findByText("Target updated")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: `Edit ${sshTarget.label}` }),
    );
    expect(screen.getByText(/SSH · 未在 V1 开放，不能作为可保存/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Target" })).toBeDisabled();
    expect(screen.getByLabelText("OpenSSH connection reference")).toHaveValue(
      "build-host",
    );

    fireEvent.click(screen.getByRole("button", { name: "New Target" }));
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Broken" },
    });
    fireEvent.change(screen.getByLabelText("Canonical workspace"), {
      target: { value: "/work/broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Target" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请求无效。请检查输入后重试。",
    );

    await act(async () => {
      rerender(
        <TargetsView
          client={bridge({ updateTarget, createTarget })}
          onSelected={vi.fn()}
          targets={[targetState(localTarget)]}
        />,
      );
    });
    expect(screen.getByText("New Definition")).toBeInTheDocument();
  });

  it("deletes a Target and selects a remaining peer", async () => {
    const deleteTarget = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: localId },
    }));
    const onSelected = vi.fn();
    render(
      <TargetsView
        client={bridge({ deleteTarget })}
        onSelected={onSelected}
        targets={[targetState(localTarget), targetState(secondTarget)]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: `Delete ${localTarget.label}` }),
    );
    await waitFor(() => expect(deleteTarget).toHaveBeenCalledWith(localId));
    expect(await screen.findByText("Target deleted")).toBeInTheDocument();
    expect(onSelected).toHaveBeenCalledWith(secondId);

    const failingDelete = vi.fn(async () => ({
      ok: false as const,
      error,
    }));
    cleanup();
    render(
      <TargetsView
        client={bridge({ deleteTarget: failingDelete })}
        onSelected={vi.fn()}
        targets={[targetState(secondTarget)]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Delete ${secondTarget.label}` }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请求无效。请检查输入后重试。",
    );
  });
});
