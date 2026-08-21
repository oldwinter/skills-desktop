// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopEvent,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { InventoryApp } from "./InventoryApp.js";

const snapshot: WorkspaceSnapshot = {
  eventSequence: 0,
  inventory: {
    activeOperationId: null,
    cliVersion: "1.5.23",
    entries: [
      {
        agents: ["Codex"],
        contentFingerprint: { status: "unknown" },
        declaredSource: { source: "example/skills", sourceType: "github" },
        name: "Case-Sensitive-Skill",
        revision: { status: "unknown" },
        scope: "project",
      },
    ],
    freshness: "fresh",
    lastError: null,
    observedAt: "2026-08-21T10:00:00.000Z",
    persistenceWarning: null,
    phase: "ready",
  },
  mutation: {
    activeOperationId: null,
    commandPlan: null,
    lastError: null,
    outcome: null,
    phase: "idle",
    reconciliationDeadline: null,
  },
  schemaVersion: 1,
  sessionEpoch: "epoch-1",
  stateRevision: 1,
  target: {
    generation: 1,
    harness: "Codex",
    id: "local-target",
    kind: "local",
    label: "This device",
    workspaceLabel: "skills-desktop",
  },
};

function clientFor(value: WorkspaceSnapshot): WorkspaceBridge {
  return {
    async cancelInventory(operationId) {
      return { ok: true, value: { operationId } };
    },
    async getSnapshot() {
      return { ok: true, value };
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
    async requestReview() {
      return { ok: true, value: { operationId: "review-1" } };
    },
    subscribe() {
      return () => undefined;
    },
  };
}

afterEach(cleanup);

describe("Local Target Inventory shell", () => {
  it("shows Target, Harness, scope, source identity, and Fresh evidence", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    expect(
      await screen.findByRole("heading", { name: "Inventory" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("This device").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Case-Sensitive-Skill").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("example/skills").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Project").length).toBeGreaterThan(0);
    expect(screen.getByText("Fresh evidence")).toBeInTheDocument();
    expect(screen.getByText("Revision unknown")).toBeInTheDocument();
  });

  it("shows a bounded opening error returned by the IPC boundary", async () => {
    const client: WorkspaceBridge = {
      ...clientFor(snapshot),
      async getSnapshot() {
        return {
          error: {
            code: "unauthorized",
            effects: "none",
            message: "This window cannot make that request.",
            phase: "authorize",
            retryable: false,
          },
          ok: false,
        };
      },
    };

    render(<InventoryApp client={client} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This window cannot make that request.",
    );
    expect(
      screen.getByRole("button", { name: "Retry opening inventory" }),
    ).toBeInTheDocument();
  });

  it.each([
    {
      expected: "No skills found",
      inventory: { entries: [], freshness: "fresh" as const },
      name: "empty",
    },
    {
      expected: "Refreshing project and global inventory",
      inventory: {
        activeOperationId: "operation-1",
        phase: "loading" as const,
      },
      name: "loading",
    },
    {
      expected:
        "Showing stale evidence restored from the last complete observation",
      inventory: { freshness: "stale" as const },
      name: "stale",
    },
    {
      expected: "Refresh cancelled",
      inventory: { freshness: "none" as const, phase: "cancelled" as const },
      name: "cancellation",
    },
    {
      expected: "Inventory observation failed.",
      inventory: {
        freshness: "stale" as const,
        lastError: {
          code: "process_failed" as const,
          effects: "none" as const,
          message: "Inventory observation failed.",
          phase: "observe",
          retryable: true,
        },
        phase: "error" as const,
      },
      name: "structured error",
    },
  ])("shows the explicit $name state", async ({ expected, inventory }) => {
    render(
      <InventoryApp
        client={clientFor({
          ...snapshot,
          inventory: { ...snapshot.inventory, ...inventory },
        })}
      />,
    );

    expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0);
  });

  it("cancels the active operation directly", async () => {
    const cancelInventory = vi.fn(async (operationId: string) => ({
      ok: true as const,
      value: { operationId },
    }));
    const client = {
      ...clientFor({
        ...snapshot,
        inventory: {
          ...snapshot.inventory,
          activeOperationId: "operation-1",
          phase: "loading" as const,
        },
      }),
      cancelInventory,
    };
    render(<InventoryApp client={client} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel refresh" }),
    );

    await waitFor(() =>
      expect(cancelInventory).toHaveBeenCalledWith("operation-1"),
    );
  });

  it("keeps stale freshness explicit while a refresh is running", async () => {
    render(
      <InventoryApp
        client={clientFor({
          ...snapshot,
          inventory: {
            ...snapshot.inventory,
            activeOperationId: "operation-1",
            freshness: "stale",
            phase: "loading",
          },
        })}
      />,
    );

    expect(
      await screen.findByText("Refreshing - Stale evidence"),
    ).toBeInTheDocument();
    expect(screen.getByText("Stale evidence retained")).toBeInTheDocument();
  });

  it("retains accessible navigation names and a compact Target summary", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    expect(await screen.findByLabelText("Target summary")).toHaveTextContent(
      "This device / skills-desktop / Codex",
    );
    expect(screen.getByRole("button", { name: "Inventory" })).toHaveAttribute(
      "title",
      "Inventory",
    );
    expect(screen.getByRole("button", { name: "Comparison" })).toHaveAttribute(
      "title",
      "Comparison",
    );
  });

  it.each([
    { expected: "Waiting for inventory", phase: "loading" as const },
    { expected: "No inventory evidence", phase: "cancelled" as const },
    { expected: "Inventory unavailable", phase: "error" as const },
  ])(
    "does not claim a valid empty Inventory while evidence is absent in $phase",
    async ({ expected, phase }) => {
      render(
        <InventoryApp
          client={clientFor({
            ...snapshot,
            inventory: {
              ...snapshot.inventory,
              activeOperationId: phase === "loading" ? "operation-1" : null,
              entries: [],
              freshness: "none",
              lastError:
                phase === "error"
                  ? {
                      code: "process_failed",
                      effects: "none",
                      message: "Inventory observation failed.",
                      phase: "observe",
                      retryable: true,
                    }
                  : null,
              phase,
            },
          })}
        />,
      );

      expect(
        await screen.findByRole("heading", { name: expected }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "No skills found" }),
      ).not.toBeInTheDocument();
    },
  );

  it("resynchronizes from the authoritative Snapshot after an event-buffer overflow", async () => {
    let listener: ((event: DesktopEvent) => void) | undefined;
    let snapshots = 0;
    const client: WorkspaceBridge = {
      ...clientFor(snapshot),
      async getSnapshot() {
        snapshots += 1;
        return {
          ok: true,
          value:
            snapshots === 1
              ? snapshot
              : {
                  ...snapshot,
                  inventory: {
                    ...snapshot.inventory,
                    entries: [
                      {
                        ...snapshot.inventory.entries[0]!,
                        name: "resynchronized-skill",
                      },
                    ],
                  },
                  stateRevision: 2,
                },
        };
      },
      subscribe(next) {
        listener = next;
        return () => undefined;
      },
    };
    render(<InventoryApp client={client} />);
    await screen.findAllByText("Case-Sensitive-Skill");

    await act(async () => {
      listener?.({
        reason: "buffer_overflow",
        sequence: 1,
        sessionEpoch: "epoch-1",
        stateRevision: 2,
        type: "resync.required",
      });
    });

    expect(await screen.findAllByText("resynchronized-skill")).not.toHaveLength(
      0,
    );
    expect(snapshots).toBe(2);
  });

  it("selects entries by scope and exact name when both scopes share a name", async () => {
    const sharedNameSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        entries: [
          {
            ...snapshot.inventory.entries[0]!,
            declaredSource: { source: "project/source", sourceType: "github" },
            name: "shared-skill",
            scope: "project",
          },
          {
            ...snapshot.inventory.entries[0]!,
            declaredSource: { source: "global/source", sourceType: "github" },
            name: "shared-skill",
            scope: "global",
          },
        ],
      },
    };
    render(<InventoryApp client={clientFor(sharedNameSnapshot)} />);
    const skillButtons = await screen.findAllByRole("button", {
      name: "shared-skill",
    });

    fireEvent.click(skillButtons[1]!);

    const inspector = screen.getByRole("complementary", {
      name: "Selected skill evidence",
    });
    expect(within(inspector).getByText("Global")).toBeInTheDocument();
    expect(within(inspector).getByText("global/source")).toBeInTheDocument();
  });

  it("prepares exact selected-skill intents and requests review of the main-owned plan", async () => {
    const prepareMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-1" },
    }));
    const requestReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "review-1" },
    }));
    const client: WorkspaceBridge = {
      ...clientFor({
        ...snapshot,
        mutation: {
          activeOperationId: null,
          commandPlan: {
            harness: "Codex",
            names: ["Case-Sensitive-Skill"],
            operation: "update",
            preview:
              "npx skills@1.5.23 update Case-Sensitive-Skill --project --yes",
            schemaVersion: 1,
            scope: "project",
            source: null,
            targetId: "local-target",
            timeoutMs: 600_000,
          },
          lastError: null,
          outcome: null,
          phase: "planned",
          reconciliationDeadline: null,
        },
      }),
      prepareMutation,
      requestReview,
    };
    render(<InventoryApp client={client} />);

    fireEvent.click(
      (await screen.findAllByRole("button", {
        name: "Case-Sensitive-Skill",
      }))[0]!,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare update" }),
    );
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenCalledWith("local-target", {
        names: ["Case-Sensitive-Skill"],
        scope: "project",
        type: "update",
      }),
    );

    expect(screen.getByRole("heading", { name: "Command Plan" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "npx skills@1.5.23 update Case-Sensitive-Skill --project --yes",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    );
    await waitFor(() =>
      expect(requestReview).toHaveBeenCalledWith("prepared-1"),
    );
  });

  it("shows bounded mutation request errors at the action surface", async () => {
    const client: WorkspaceBridge = {
      ...clientFor(snapshot),
      async prepareMutation() {
        return {
          error: {
            code: "invalid_intent",
            effects: "none",
            message: "The exact Skill intent is not supported.",
            phase: "prepare",
            retryable: false,
          },
          ok: false,
        };
      },
    };
    render(<InventoryApp client={client} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare removal" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The exact Skill intent is not supported.",
    );
  });
});
