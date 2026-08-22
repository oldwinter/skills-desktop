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

import type { AboutBridge } from "../../../contracts/about.js";
import type { DesktopBridge } from "../../../contracts/desktop.js";
import type {
  DesktopEvent,
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
        agents: [],
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
    id: "00000000-0000-4000-8000-000000000001",
    kind: "local",
    label: "This device",
    workspaceLabel: "skills-desktop",
  },
};

const collectionSnapshot: WorkspaceSnapshot = {
  ...snapshot,
  collections: {
    acknowledgements: [],
    plan: null,
    releases: [
      {
        assessments: [
          {
            compatibility: "compatible",
            entries: [
              {
                inRelease: true,
                name: "find-skills",
                selectable: true,
                selectionModes: ["add"],
                status: "missing",
              },
              {
                inRelease: true,
                name: "tdd",
                selectable: false,
                selectionModes: [],
                status: "source-conflict",
              },
            ],
            inventoryFreshness: "fresh",
            scope: "project",
            targetGeneration: 1,
            targetId: snapshot.target.id,
          },
          {
            compatibility: "compatible",
            entries: [
              {
                inRelease: true,
                name: "find-skills",
                selectable: true,
                selectionModes: ["add"],
                status: "missing",
              },
              {
                inRelease: true,
                name: "tdd",
                selectable: true,
                selectionModes: ["add"],
                status: "missing",
              },
            ],
            inventoryFreshness: "fresh",
            scope: "global",
            targetGeneration: 1,
            targetId: snapshot.target.id,
          },
        ],
        blockers: [],
        collectionId: "skills-desktop-starter",
        compatibility: {
          cliVersion: "1.5.23",
          harnesses: ["Codex"],
          platforms: ["linux"],
          requiredCapabilities: ["local"],
        },
        description: "Reviewed starter skills.",
        executable: true,
        manifestDigest: `sha256:${"a".repeat(64)}`,
        receipt: {
          author: "Author",
          manifestDigest: `sha256:${"a".repeat(64)}`,
          reviewLocation:
            "https://github.com/oldwinter/skills-desktop/issues/20",
          reviewPolicy: "official-collection-v1",
          reviewedAt: "2026-08-22T05:00:00.000Z",
          reviewer: "Reviewer",
          schemaVersion: 1,
          status: "approved",
        },
        releaseNumber: 1,
        skills: ["find-skills", "tdd"],
        source: {
          repository: "vercel-labs/skills",
          repositoryUrl: "https://github.com/vercel-labs/skills",
          reviewedRevision: "0123456789abcdef0123456789abcdef01234567",
          sourceType: "github",
        },
        status: "active",
        supersedesDigest: null,
        title: "Skills Desktop Starter",
      },
    ],
  },
};

function clientFor(value: WorkspaceSnapshot): DesktopBridge {
  return {
    about: aboutClient,
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
      return { ok: true, value };
    },
    async prepareMutation() {
      return { ok: true, value: { operationId: "prepared-1" } };
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
    async reconcileMutation() {
      return { ok: true, value: { operationId: "reconcile-1" } };
    },
    async refreshInventory() {
      return { ok: true, value: { operationId: "refresh-1" } };
    },
    async requestCancellationReview() {
      return { ok: true, value: { operationId: "cancel-review-1" } };
    },
    async requestHostTrustReview() {
      return { ok: true, value: { operationId: "host-trust-review-1" } };
    },
    async requestCollectionReview() {
      return { ok: true, value: { operationId: "collection-review-1" } };
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
  };
}

const aboutClient: AboutBridge = {
  async exportDiagnostics() {
    return { ok: true, value: { status: "saved" } };
  },
  async getSnapshot() {
    return {
      ok: true,
      value: {
        application: {
          architecture: "x64",
          platform: "linux",
          version: "0.1.0",
        },
        lastCheckAt: null,
        nextAutomaticCheckAt: null,
        policy: {
          message:
            "Download a newer package from GitHub Releases and install it manually.",
          mode: "manual",
          releasePageUrl:
            "https://github.com/oldwinter/skills-desktop/releases",
        },
        schemaVersion: 1,
        state: { kind: "manual" },
      },
    };
  },
  async requestCheck() {
    return {
      error: {
        code: "invalid_request",
        message: "The update request is not supported.",
        retryable: false,
      },
      ok: false,
    };
  },
  async requestRestart() {
    return {
      error: {
        code: "invalid_request",
        message: "The update request is not supported.",
        retryable: false,
      },
      ok: false,
    };
  },
  subscribe() {
    return () => undefined;
  },
};

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
    const inventoryRow = screen
      .getByRole("button", { name: "Case-Sensitive-Skill" })
      .closest("tr");
    expect(inventoryRow).not.toBeNull();
    expect(
      within(inventoryRow!).getByRole("cell", { name: "Codex" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("example/skills").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Project").length).toBeGreaterThan(0);
    expect(screen.getByText("Fresh evidence")).toBeInTheDocument();
    expect(screen.getByText("Revision unknown")).toBeInTheDocument();
  });

  it("shows a bounded opening error returned by the IPC boundary", async () => {
    const client: DesktopBridge = {
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

  it("opens About from workspace navigation", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    fireEvent.click(await screen.findByRole("button", { name: "About" }));

    expect(
      await screen.findByRole("heading", { name: "About" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Version 0.1.0")).toBeInTheDocument();
    expect(screen.getByText("Manual upgrade")).toBeInTheDocument();
  });

  it("requires explicit eligible Collection selections before preparing", async () => {
    const prepareCollectionAcrossTargets = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "collection-plan-1" },
    }));
    render(
      <InventoryApp
        client={{
          ...clientFor(collectionSnapshot),
          prepareCollectionAcrossTargets,
        }}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    expect(
      screen.getByRole("heading", { name: "Official Collections" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("Source conflict")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare plan" })).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Select find-skills" }),
    ).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Select tdd" })).toBeDisabled();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select find-skills" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan" }));
    await waitFor(() =>
      expect(prepareCollectionAcrossTargets).toHaveBeenCalledWith({
        collectionId: "skills-desktop-starter",
        manifestDigest: `sha256:${"a".repeat(64)}`,
        releaseNumber: 1,
        targets: [
          {
            scope: "project",
            selections: [{ mode: "add", name: "find-skills" }],
            targetId: snapshot.target.id,
          },
        ],
      }),
    );
  });

  it("prepares exact entries in the visible machine order", async () => {
    const otherTarget = {
      ...snapshot.target,
      id: "00000000-0000-4000-8000-000000000002",
      kind: "ssh" as const,
      label: "Build host",
      workspaceLabel: "remote",
    };
    const otherCollections = structuredClone(collectionSnapshot.collections!);
    otherCollections.releases[0]!.compatibility.requiredCapabilities = [
      "local",
      "ssh",
    ];
    for (const assessment of otherCollections.releases[0]!.assessments) {
      assessment.targetId = otherTarget.id;
    }
    const localCollections = structuredClone(collectionSnapshot.collections!);
    localCollections.releases[0]!.compatibility.requiredCapabilities = [
      "local",
      "ssh",
    ];
    const prepareCollectionAcrossTargets = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "collection-plan-many" },
    }));
    const targetState = {
      deletionBlocked: false,
      inventory: collectionSnapshot.inventory,
      mutation: collectionSnapshot.mutation,
    };
    render(
      <InventoryApp
        client={{
          ...clientFor(collectionSnapshot),
          prepareCollectionAcrossTargets,
          async getSnapshot() {
            return {
              ok: true as const,
              value: {
                ...collectionSnapshot,
                collections: localCollections,
                targets: [
                  {
                    ...targetState,
                    collections: localCollections,
                    target: collectionSnapshot.target,
                  },
                  {
                    ...targetState,
                    collections: otherCollections,
                    target: otherTarget,
                  },
                ],
              },
            };
          },
        }}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    expect(screen.getAllByText("Fresh inventory")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select find-skills on This device",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include Build host" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select find-skills on Build host",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan" }));

    await waitFor(() =>
      expect(prepareCollectionAcrossTargets).toHaveBeenCalledWith({
        collectionId: "skills-desktop-starter",
        manifestDigest: `sha256:${"a".repeat(64)}`,
        releaseNumber: 1,
        targets: [
          {
            scope: "project",
            selections: [{ mode: "add", name: "find-skills" }],
            targetId: snapshot.target.id,
          },
          {
            scope: "project",
            selections: [{ mode: "add", name: "find-skills" }],
            targetId: otherTarget.id,
          },
        ],
      }),
    );
  });

  it("allows an initially included incompatible Target to be excluded", async () => {
    const incompatible = structuredClone(collectionSnapshot);
    incompatible.collections!.releases[0]!.executable = false;
    incompatible.collections!.releases[0]!.assessments.forEach((assessment) => {
      assessment.compatibility = "incompatible";
      assessment.inventoryFreshness = "stale";
    });
    render(<InventoryApp client={clientFor(incompatible)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    const include = screen.getByRole("checkbox", {
      name: "Include This device",
    });
    expect(include).toBeChecked();
    expect(include).toBeEnabled();
    fireEvent.click(include);
    expect(include).not.toBeChecked();
  });

  it("shows non-transactional stopped progress and routes recovery to the affected Target", async () => {
    const otherTarget = {
      ...snapshot.target,
      id: "00000000-0000-4000-8000-000000000002",
      label: "Second local",
      workspaceLabel: "second",
    };
    const stoppedSnapshot: WorkspaceSnapshot = {
      ...collectionSnapshot,
      collections: {
        ...collectionSnapshot.collections!,
        execution: {
          children: [
            {
              error: {
                code: "process_failed",
                effects: "none",
                message: "The Collection child failed.",
                phase: "execute",
                retryable: false,
              },
              outcome: {
                effects: { status: "not-observed" },
                process: {
                  disposition: "failed",
                  exitCode: 1,
                  termination: "known",
                },
              },
              position: 1,
              scope: "project",
              skills: [
                {
                  effects: "not-observed",
                  mode: "reapply",
                  name: "find-skills",
                  status: "failed",
                },
              ],
              status: "failed",
              target: snapshot.target,
            },
            {
              error: {
                code: "reconciliation_required",
                effects: "possible",
                message: "Reconcile this Target before continuing.",
                phase: "recover",
                retryable: false,
              },
              outcome: null,
              position: 2,
              scope: "global",
              skills: [
                {
                  effects: "possible",
                  mode: "add",
                  name: "tdd",
                  status: "stopped",
                },
              ],
              status: "reconciliation-required",
              target: otherTarget,
            },
          ],
          collectionId: "skills-desktop-starter",
          id: "collection-run-stopped",
          manifestDigest: `sha256:${"a".repeat(64)}`,
          phase: "stopped",
          reviewDigest: `sha256:${"e".repeat(64)}`,
          semantics: "non-transactional",
        },
      },
    };
    const reconcileMutation = vi.fn(async (targetId: string) => ({
      ok: true as const,
      value: { operationId: `reconcile:${targetId}` },
    }));
    const refreshInventory = vi.fn(async (targetId: string) => ({
      ok: true as const,
      value: { operationId: `refresh:${targetId}` },
    }));
    render(
      <InventoryApp
        client={{
          ...clientFor(stoppedSnapshot),
          reconcileMutation,
          refreshInventory,
        }}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    expect(
      screen.getByRole("heading", { name: "Collection run stopped" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sequential, non-transactional execution"),
    ).toBeInTheDocument();
    expect(screen.getByText("failed / not-observed")).toBeInTheDocument();
    expect(screen.getByText("stopped / possible")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh This device" }),
    );
    await waitFor(() =>
      expect(refreshInventory).toHaveBeenCalledWith(snapshot.target.id),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reconcile Second local" }),
    );
    await waitFor(() =>
      expect(reconcileMutation).toHaveBeenCalledWith(otherTarget.id),
    );
  });

  it("uses the selected Target's Collection assessment", async () => {
    const otherTarget = {
      ...snapshot.target,
      id: "00000000-0000-4000-8000-000000000002",
      label: "Other workspace",
      workspaceLabel: "other",
    };
    const otherCollections = structuredClone(collectionSnapshot.collections!);
    for (const assessment of otherCollections.releases[0]!.assessments) {
      assessment.targetId = otherTarget.id;
      assessment.entries[0] = {
        inRelease: true,
        name: "find-skills",
        selectable: false,
        selectionModes: [],
        status: "source-conflict",
      };
    }
    const targetState = {
      deletionBlocked: false,
      inventory: collectionSnapshot.inventory,
      mutation: collectionSnapshot.mutation,
    };
    render(
      <InventoryApp
        client={clientFor({
          ...collectionSnapshot,
          targets: [
            {
              ...targetState,
              collections: collectionSnapshot.collections,
              target: collectionSnapshot.target,
            },
            {
              ...targetState,
              collections: otherCollections,
              target: otherTarget,
            },
          ],
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Other workspace/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Collections" }));

    expect(
      screen.getByRole("checkbox", {
        name: "Select find-skills on Other workspace",
      }),
    ).toBeDisabled();
    expect(screen.getAllByText("Source conflict").length).toBeGreaterThan(0);
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
    const client: DesktopBridge = {
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
    const client: DesktopBridge = {
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
            targetId: "00000000-0000-4000-8000-000000000001",
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
      (
        await screen.findAllByRole("button", {
          name: "Case-Sensitive-Skill",
        })
      )[0]!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare update" }));
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000001",
        {
          names: ["Case-Sensitive-Skill"],
          scope: "project",
          type: "update",
        },
      ),
    );

    expect(
      screen.getByRole("heading", { name: "Command Plan" }),
    ).toBeInTheDocument();
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
    const client: DesktopBridge = {
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

  it("selects and swaps paired Targets in the dimensioned Comparison view", async () => {
    const rightTarget = {
      connectionReference: "build-host",
      generation: 2,
      harness: "Codex",
      id: "00000000-0000-4000-8000-00000000000a",
      kind: "ssh" as const,
      label: "Build host",
      workspace: "/srv/skills-desktop",
      workspaceLabel: "skills-desktop",
    };
    const targetStates = [
      {
        deletionBlocked: false,
        inventory: snapshot.inventory,
        mutation: snapshot.mutation,
        target: {
          ...snapshot.target,
          connectionReference: null,
          workspace: "/work/skills-desktop",
        },
      },
      {
        deletionBlocked: false,
        inventory: { ...snapshot.inventory, freshness: "stale" as const },
        mutation: snapshot.mutation,
        target: rightTarget,
      },
    ];
    const comparison = {
      id: "comparison-1",
      leftFreshness: "fresh" as const,
      leftTargetId: "00000000-0000-4000-8000-000000000001",
      rightFreshness: "stale" as const,
      rightTargetId: "00000000-0000-4000-8000-00000000000a",
      rows: [
        {
          dimensions: {
            contentFingerprint: "unknown" as const,
            declaredSource: "matched" as const,
            presence: "left-only" as const,
            revision: "unknown" as const,
          },
          key: "Case-Sensitive-Skill",
          left: {
            entries: snapshot.inventory.entries,
            freshness: "fresh" as const,
            harnessAvailability: "available" as const,
          },
          right: {
            entries: [],
            freshness: "stale" as const,
            harnessAvailability: "absent" as const,
          },
          summary: "missing" as const,
        },
      ],
    };
    const compareTargets = vi.fn(async (leftTargetId, rightTargetId) => ({
      ok: true as const,
      value: { operationId: `${leftTargetId}:${rightTargetId}` },
    }));
    const client = {
      ...clientFor({ ...snapshot, comparison, targets: targetStates }),
      compareTargets,
    };
    render(<InventoryApp client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));
    expect(
      screen.getByRole("heading", { name: "Comparison" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Case-Sensitive-Skill" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Missing")).toHaveLength(2);
    expect(screen.getByText("stale evidence")).toBeInTheDocument();
    expect(
      screen.getByText("Source: github / example/skills"),
    ).toBeInTheDocument();
    expect(screen.getByText("Revision: Unknown")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Prepare for Right" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Swap comparison Targets" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() =>
      expect(compareTargets).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-00000000000a",
        "00000000-0000-4000-8000-000000000001",
      ),
    );
  });

  it("shows reconciliation as a comparison planning block even with Fresh evidence", async () => {
    const rightTarget = {
      connectionReference: null,
      generation: 1,
      harness: "Codex",
      id: "00000000-0000-4000-8000-00000000000a",
      kind: "local" as const,
      label: "Right device",
      workspace: "/work/right",
      workspaceLabel: "right",
    };
    const rightMutation = {
      ...snapshot.mutation,
      lastError: {
        code: "reconciliation_required" as const,
        effects: "possible" as const,
        message: "Recovery is required.",
        phase: "restore",
        retryable: false,
      },
      phase: "reconciliation-required" as const,
      reconciliationDeadline: "2026-08-21T10:10:00.000Z",
    };
    const comparison = {
      id: "comparison-reconciliation",
      leftFreshness: "fresh" as const,
      leftTargetId: snapshot.target.id,
      rightFreshness: "fresh" as const,
      rightTargetId: rightTarget.id,
      rows: [
        {
          dimensions: {
            contentFingerprint: "not-applicable" as const,
            declaredSource: "not-applicable" as const,
            presence: "left-only" as const,
            revision: "not-applicable" as const,
          },
          key: "Case-Sensitive-Skill",
          left: {
            entries: snapshot.inventory.entries,
            freshness: "fresh" as const,
            harnessAvailability: "available" as const,
          },
          right: {
            entries: [],
            freshness: "fresh" as const,
            harnessAvailability: "absent" as const,
          },
          summary: "missing" as const,
        },
      ],
    };
    render(
      <InventoryApp
        client={clientFor({
          ...snapshot,
          comparison,
          targets: [
            {
              deletionBlocked: false,
              inventory: snapshot.inventory,
              mutation: snapshot.mutation,
              target: {
                ...snapshot.target,
                connectionReference: null,
                workspace: "/work/skills-desktop",
              },
            },
            {
              deletionBlocked: true,
              inventory: snapshot.inventory,
              mutation: rightMutation,
              target: rightTarget,
            },
          ],
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));

    expect(
      screen.getByText("Blocked: reconciliation required"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reconciliation is required",
    );
    expect(
      screen.getByRole("button", { name: "Prepare for Right" }),
    ).toBeDisabled();
  });

  it("keeps the Targets editor Local-only for V1", async () => {
    const createTarget = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "created-local-target" },
    }));
    const client = {
      ...clientFor({
        ...snapshot,
        targets: [
          {
            deletionBlocked: true,
            inventory: snapshot.inventory,
            mutation: snapshot.mutation,
            target: {
              ...snapshot.target,
              connectionReference: null,
              workspace: "/work/skills-desktop",
            },
          },
        ],
      }),
      createTarget,
    };
    render(<InventoryApp client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Targets" }));
    fireEvent.click(screen.getByRole("button", { name: "New Target" }));
    expect(screen.queryByRole("button", { name: "SSH" })).toBeNull();
    expect(screen.getByRole("button", { name: "Local" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/V1 is Local-only/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Local workspace" },
    });
    fireEvent.change(screen.getByLabelText("Canonical workspace"), {
      target: { value: "/work/other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Target" }));

    await waitFor(() =>
      expect(createTarget).toHaveBeenCalledWith({
        connectionReference: null,
        harness: "Codex",
        kind: "local",
        label: "Local workspace",
        workspace: "/work/other",
      }),
    );
    expect(await screen.findByText("Target created")).toBeInTheDocument();
  });


  it("requests isolated host trust review from a trust-required SSH state", async () => {
    const requestHostTrustReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "host-trust-review-1" },
    }));
    const sshSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        entries: [],
        freshness: "none",
        lastError: {
          code: "host_trust_required",
          effects: "none",
          message: "This SSH Target requires explicit host-key review.",
          phase: "trust",
          retryable: false,
        },
        phase: "error",
      },
      target: {
        connectionReference: "build-host",
        generation: 2,
        harness: "Codex",
        id: "00000000-0000-4000-8000-000000000018",
        kind: "ssh",
        label: "Build host",
        workspace: "/srv/skills",
        workspaceLabel: "skills",
      },
    };
    render(
      <InventoryApp
        client={{
          ...clientFor(sshSnapshot),
          requestHostTrustReview,
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Review host identity" }),
    );

    await waitFor(() =>
      expect(requestHostTrustReview).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000018",
      ),
    );
  });

  it("presents SSH transport loss as an accessible offline state", async () => {
    render(
      <InventoryApp
        client={clientFor({
          ...snapshot,
          inventory: {
            ...snapshot.inventory,
            entries: [],
            freshness: "stale",
            lastError: {
              code: "transport_lost",
              effects: "none",
              message:
                "The SSH transport ended before a complete remote result.",
              phase: "observe",
              retryable: true,
            },
            phase: "error",
          },
          target: {
            ...snapshot.target,
            connectionReference: "build-host",
            kind: "ssh",
          },
        })}
      />,
    );

    expect(
      await screen.findByText("Offline - Stale evidence"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Target offline");
  });
});
