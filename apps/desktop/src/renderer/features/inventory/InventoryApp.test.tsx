// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
import type {
  DesktopBridge,
  ReviewWindowClosedEvent,
} from "../../../contracts/desktop.js";
import type {
  DesktopEvent,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { InventoryApp } from "./InventoryApp.js";

const targetV4Metadata = {
  dialectId: "skills-1.5.23" as const,
  executionBindingDigest: null,
  harnessIds: ["codex"],
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de" as const,
  registryVersion: 1 as const,
};

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
  schemaVersion: 2,
  sessionEpoch: "epoch-1",
  stateRevision: 1,
  target: {
    connectionReference: null,
    ...targetV4Metadata,
    generation: 1,
    id: "00000000-0000-4000-8000-000000000001",
    kind: "local",
    label: "This device",
    workspace: "/work/skills-desktop",
    workspaceLabel: "skills-desktop",
  },
};

const reviewableSnapshot: WorkspaceSnapshot = {
  ...snapshot,
  mutation: {
    ...snapshot.mutation,
    commandPlan: {
      harness: "Codex",
      names: ["Case-Sensitive-Skill"],
      operation: "update",
      preview: "npx skills@1.5.23 update Case-Sensitive-Skill --project --yes",
      schemaVersion: 1,
      scope: "project",
      source: null,
      targetId: snapshot.target.id,
      timeoutMs: 600_000,
    },
    phase: "planned",
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

interface ReviewCloseHarness {
  listener: ((event: ReviewWindowClosedEvent) => void) | undefined;
}

function clientFor(
  value: WorkspaceSnapshot,
  reviewCloseHarness?: ReviewCloseHarness,
): DesktopBridge {
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
    subscribeReviewWindowClosed(listener) {
      if (reviewCloseHarness !== undefined) {
        reviewCloseHarness.listener = listener;
      }
      return () => {
        if (reviewCloseHarness?.listener === listener) {
          reviewCloseHarness.listener = undefined;
        }
      };
    },
    subscribe() {
      return () => undefined;
    },
    async updateTarget(targetId) {
      return { ok: true, value: { operationId: targetId } };
    },
  };
}

function installFocusTimerHarness() {
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  type WindowTimer = ReturnType<typeof window.setTimeout>;
  let nextTimerId = 1_000_000;
  const callbacks = new Map<WindowTimer, () => void>();
  const setTimeoutImplementation = (
    ...parameters: Parameters<typeof window.setTimeout>
  ): WindowTimer => {
    const [handler, timeout, ...args] = parameters;
    if (timeout !== 16 || typeof handler !== "function") {
      return nativeSetTimeout(
        handler,
        timeout,
        ...args,
      ) as unknown as WindowTimer;
    }
    const timerId = nextTimerId as unknown as WindowTimer;
    nextTimerId += 1;
    callbacks.set(timerId, () => handler(...args));
    return timerId;
  };
  vi.spyOn(window, "setTimeout").mockImplementation(setTimeoutImplementation);
  vi.spyOn(window, "clearTimeout").mockImplementation((timerId) => {
    if (!callbacks.delete(timerId as WindowTimer)) nativeClearTimeout(timerId);
  });
  return {
    pendingCount: () => callbacks.size,
    runTick: () => {
      const timerCallbacks = [...callbacks.values()];
      callbacks.clear();
      for (const callback of timerCallbacks) callback();
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rendererStyles = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/renderer/styles.css"),
  "utf8",
);

const twoLocalTargetsSnapshot: WorkspaceSnapshot = {
  ...snapshot,
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
      deletionBlocked: false,
      inventory: {
        ...snapshot.inventory,
        entries: [
          {
            ...snapshot.inventory.entries[0]!,
            name: "Other-Skill",
          },
        ],
      },
      mutation: snapshot.mutation,
      target: {
        connectionReference: null,
        ...targetV4Metadata,
        generation: 1,
        id: "00000000-0000-4000-8000-00000000000a",
        kind: "local",
        label: "Second device",
        workspace: "/work/second",
        workspaceLabel: "second",
      },
    },
  ],
};

describe("Local Target Inventory shell", () => {
  it("shows Target, Harness, scope, source identity, and Fresh evidence", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    expect(
      await screen.findByRole("heading", { name: "Inventory" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("This device").length).toBeGreaterThan(0);
    expect(screen.getAllByText("codex").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Case-Sensitive-Skill").length).toBeGreaterThan(
      0,
    );
    const inventoryRow = screen
      .getByRole("button", { name: "Case-Sensitive-Skill" })
      .closest("tr");
    expect(inventoryRow).not.toBeNull();
    expect(
      within(inventoryRow!).getByRole("cell", { name: "codex" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("example/skills").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Project").length).toBeGreaterThan(0);
    expect(screen.getByText("Fresh evidence")).toBeInTheDocument();
    expect(screen.getByText("Revision unknown")).toBeInTheDocument();
  });

  it("exposes Inventory and Add scopes as named groups with ordered pressed buttons", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    const inventoryScope = await screen.findByRole("group", {
      name: "Inventory scope",
    });
    const addScope = screen.getByRole("group", { name: "Add scope" });
    const inventoryButtons = within(inventoryScope).getAllByRole("button");
    const addButtons = within(addScope).getAllByRole("button");

    expect(inventoryButtons.map((button) => button.textContent)).toEqual([
      "All scopes",
      "Project scope",
      "Global scope",
    ]);
    expect(
      inventoryButtons.map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(["true", "false", "false"]);
    expect(addButtons.map((button) => button.textContent)).toEqual([
      "Project scope",
      "Global scope",
    ]);
    expect(
      addButtons.map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(["true", "false"]);

    expect(inventoryButtons.every((button) => button.tabIndex === 0)).toBe(
      true,
    );
    expect(addButtons.every((button) => button.tabIndex === 0)).toBe(true);
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

    const openingAlert = await screen.findByRole("alert");
    expect(openingAlert).toHaveTextContent("无权限执行该操作。");
    expect(
      openingAlert.querySelector(".user-facing-error-details code"),
    ).toHaveTextContent("This window cannot make that request.");
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
      expected: "本地进程执行失败。请刷新后重试。",
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

  it("maps inventory banner errors to user-facing copy and keeps raw text under details", async () => {
    render(
      <InventoryApp
        client={clientFor({
          ...snapshot,
          inventory: {
            ...snapshot.inventory,
            freshness: "stale",
            lastError: {
              code: "process_failed",
              effects: "none",
              message: "Inventory observation failed with Error: ENOENT /tmp/x",
              phase: "observe",
              retryable: true,
            },
            phase: "error",
          },
        })}
      />,
    );

    const alert = await screen.findByRole("alert");
    const primary = alert.querySelector(".user-facing-error > span");
    expect(primary).toHaveTextContent("本地进程执行失败。请刷新后重试。");
    expect(primary).not.toHaveTextContent("ENOENT");
    expect(
      alert.querySelector(".user-facing-error-details code"),
    ).toHaveTextContent(
      "Inventory observation failed with Error: ENOENT /tmp/x",
    );
  });

  it("renders known evidence and distinguishes filtered-empty inventory", async () => {
    render(
      <InventoryApp
        client={clientFor({
          ...snapshot,
          inventory: {
            ...snapshot.inventory,
            entries: [
              {
                ...snapshot.inventory.entries[0]!,
                agents: ["Codex"],
                contentFingerprint: {
                  authority: "skills-cli",
                  kind: "sha256",
                  status: "known",
                  value: "fingerprint-123",
                },
                revision: {
                  authority: "git",
                  kind: "commit",
                  status: "known",
                  value: "0123456789abcdef",
                },
              },
            ],
          },
        })}
      />,
    );

    expect(
      await screen.findByText("commit / 0123456789abcdef"),
    ).toBeInTheDocument();
    expect(screen.getByText("sha256 / fingerprint-123")).toBeInTheDocument();
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search inventory" }),
      {
        target: { value: "no-such-skill" },
      },
    );

    expect(
      screen.getByRole("heading", { name: "No matching skills" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Change the current search or scope filter."),
    ).toBeInTheDocument();
  });

  it("reports visible inventory count with singular and matching copy (#136, #139)", async () => {
    const twoSkills: WorkspaceSnapshot = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        entries: [
          snapshot.inventory.entries[0]!,
          {
            ...snapshot.inventory.entries[0]!,
            name: "Other-Skill",
            scope: "global",
          },
        ],
      },
    };
    const { unmount } = render(<InventoryApp client={clientFor(snapshot)} />);

    expect(
      await screen.findByText("1 skill across project and global scopes"),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search inventory" }),
      { target: { value: "zzzzqwxnotfound999" } },
    );
    expect(screen.getByText("0 matching skills")).toBeInTheDocument();
    expect(
      screen.queryByText("1 skill across project and global scopes"),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search inventory" }),
      { target: { value: "" } },
    );
    expect(
      screen.getByText("1 skill across project and global scopes"),
    ).toBeInTheDocument();

    const inventoryScope = screen.getByRole("group", {
      name: "Inventory scope",
    });
    fireEvent.click(
      within(inventoryScope).getByRole("button", { name: "Global scope" }),
    );
    expect(screen.getByText("0 matching skills")).toBeInTheDocument();
    fireEvent.click(
      within(inventoryScope).getByRole("button", { name: "All scopes" }),
    );
    expect(
      screen.getByText("1 skill across project and global scopes"),
    ).toBeInTheDocument();
    unmount();

    render(<InventoryApp client={clientFor(twoSkills)} />);
    expect(
      await screen.findByText("2 skills across project and global scopes"),
    ).toBeInTheDocument();
  });

  it("prepares scoped updates and exact GitHub additions through distinct intents", async () => {
    const prepareMutation = vi.fn(
      async (
        _targetId: string,
        intent: Parameters<DesktopBridge["prepareMutation"]>[1],
      ) => {
        if (intent.type === "update-all") {
          return {
            error: {
              code: "invalid_intent" as const,
              effects: "none" as const,
              message: "The selected scope cannot be updated.",
              phase: "prepare",
              retryable: false,
            },
            ok: false as const,
          };
        }
        return {
          ok: true as const,
          value: { operationId: "prepared-add" },
        };
      },
    );
    const client: DesktopBridge = {
      ...clientFor(snapshot),
      prepareMutation,
    };
    render(<InventoryApp client={client} />);

    const inventoryScope = await screen.findByRole("group", {
      name: "Inventory scope",
    });
    fireEvent.click(
      within(inventoryScope).getByRole("button", { name: "Global scope" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update scope" }));
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenCalledWith(snapshot.target.id, {
        scope: "global",
        type: "update-all",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The selected scope cannot be updated.",
    );

    fireEvent.change(screen.getByRole("textbox", { name: "GitHub source" }), {
      target: { value: "example/skills" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Exact skill name" }),
      {
        target: { value: "find-skills" },
      },
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Add scope" })).getByRole(
        "button",
        { name: "Global scope" },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare add" }));

    await waitFor(() =>
      expect(prepareMutation).toHaveBeenLastCalledWith(snapshot.target.id, {
        names: ["find-skills"],
        scope: "global",
        source: { source: "example/skills", sourceType: "github" },
        type: "add",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("routes reconciliation failure through the visible action surface", async () => {
    const reconcileMutation = vi.fn(async () => ({
      error: {
        code: "reconciliation_required" as const,
        effects: "possible" as const,
        message: "The recovery observation is still uncertain.",
        phase: "reconcile",
        retryable: true,
      },
      ok: false as const,
    }));
    render(
      <InventoryApp
        client={{
          ...clientFor({
            ...snapshot,
            mutation: {
              ...snapshot.mutation,
              phase: "reconciliation-required",
            },
          }),
          reconcileMutation,
        }}
      />,
    );

    expect(
      await screen.findByText("This Target requires reconciliation."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile" }));

    await waitFor(() =>
      expect(reconcileMutation).toHaveBeenCalledWith(snapshot.target.id),
    );
    expect(
      screen.getByText("The recovery observation is still uncertain."),
    ).toBeInTheDocument();
  });

  it("requires Trusted Review for cancellation and reports request failure", async () => {
    const requestCancellationReview = vi.fn(async () => ({
      error: {
        code: "review_invalid" as const,
        effects: "none" as const,
        message: "The active mutation is no longer cancellable.",
        phase: "review",
        retryable: false,
      },
      ok: false as const,
    }));
    render(
      <InventoryApp
        client={{
          ...clientFor({
            ...snapshot,
            mutation: {
              ...snapshot.mutation,
              activeOperationId: "mutation-running-1",
              phase: "running",
            },
          }),
          requestCancellationReview,
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Review cancellation" }),
    );

    await waitFor(() =>
      expect(requestCancellationReview).toHaveBeenCalledWith(
        "mutation-running-1",
      ),
    );
    expect(
      screen.getByText("The active mutation is no longer cancellable."),
    ).toBeInTheDocument();
  });

  it("shows a completed command outcome without offering another review", async () => {
    render(
      <InventoryApp
        client={clientFor({
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
              targetId: snapshot.target.id,
              timeoutMs: 600_000,
            },
            lastError: null,
            outcome: {
              effects: { status: "verified" },
              process: {
                disposition: "completed",
                exitCode: 0,
                termination: "known",
              },
            },
            phase: "succeeded",
            reconciliationDeadline: null,
          },
        })}
      />,
    );

    expect(await screen.findByText("completed / verified")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Trusted Review" }),
    ).toBeNull();
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
      "This device / skills-desktop / codex",
    );
    expect(screen.getByRole("button", { name: "Inventory" })).toHaveAttribute(
      "title",
      "Inventory",
    );
    expect(screen.getByRole("button", { name: "Comparison" })).toHaveAttribute(
      "title",
      "Comparison",
    );
    expect(screen.queryByRole("combobox", { name: "Target" })).toBeNull();
  });

  it("keeps a compact accessible Target chooser for two Local Targets at 800px", async () => {
    render(<InventoryApp client={clientFor(twoLocalTargetsSnapshot)} />);

    const chooser = await screen.findByRole("combobox", { name: "Target" });
    expect(screen.queryByLabelText("Target summary")).toBeNull();
    expect(chooser).toHaveDisplayValue("This device");
    expect(
      within(chooser).getByRole("option", { name: "This device" }),
    ).toBeInTheDocument();
    expect(
      within(chooser).getByRole("option", { name: "Second device" }),
    ).toBeInTheDocument();

    fireEvent.change(chooser, {
      target: { value: "00000000-0000-4000-8000-00000000000a" },
    });
    expect(chooser).toHaveDisplayValue("Second device");
    expect(
      await screen.findByRole("button", { name: "Other-Skill" }),
    ).toBeInTheDocument();

    expect(rendererStyles).toMatch(
      /@media \(max-width: 820px\)[\s\S]*\.inventory-target-chooser\s*\{(?=[^}]*max-width:\s*100%)(?=[^}]*min-width:\s*0)[^}]*\}/,
    );
    expect(rendererStyles).toMatch(
      /@media \(max-width: 820px\)[\s\S]*\.inventory-target-chooser\s*\{(?![^}]*display:\s*none)/,
    );
    expect(rendererStyles).not.toMatch(
      /@media \(max-width: 820px\)[\s\S]*\.inventory-target-chooser\s*\{\s*display:\s*none/,
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

  it("keeps Collection Include semantics and checkbox hit areas explicit", async () => {
    render(<InventoryApp client={clientFor(collectionSnapshot)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));

    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Include",
      "Skill",
      "Assessment",
      "Action",
    ]);
    for (const header of headers) {
      expect(header).toHaveAttribute("scope", "col");
    }

    expect(
      screen.getByRole("checkbox", { name: "Include This device" })
        .parentElement,
    ).toHaveClass("collection-checkbox-hit-area");
    expect(
      screen.getByRole("checkbox", { name: "Select find-skills" })
        .parentElement,
    ).toHaveClass("collection-checkbox-hit-area");

    expect(rendererStyles).toMatch(
      /\.collection-checkbox-hit-area\s*\{(?=[^}]*width:\s*40px)(?=[^}]*min-width:\s*40px)(?=[^}]*height:\s*40px)(?=[^}]*min-height:\s*40px)[^}]*\}/s,
    );
  });

  it("keeps skill-name controls at the shared 40px minimum", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    const skillButton = await screen.findByRole("button", {
      name: "Case-Sensitive-Skill",
    });
    expect(skillButton).toHaveClass("skill-button");
    expect(rendererStyles).toMatch(
      /\.skill-button\s*\{(?=[^}]*min-height:\s*40px)[^}]*\}/s,
    );
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

  it("excludes SSH Targets from V1 Collections prepare while Local stays ordered", async () => {
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
    expect(screen.getByText(/SSH · 未在 V1 开放/)).toBeInTheDocument();
    const sshInclude = screen.getByRole("checkbox", {
      name: "Include Build host",
    });
    expect(sshInclude).toBeDisabled();
    expect(sshInclude).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select find-skills on This device",
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

  it("prepares exact selected-skill intents and stabilizes approved review focus", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const prepareMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-1" },
    }));
    const requestReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "review-1" },
    }));
    const reviewClose = { listener: undefined } as ReviewCloseHarness;
    const plannedSnapshot: WorkspaceSnapshot = {
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
    };
    const client: DesktopBridge = {
      ...clientFor(plannedSnapshot, reviewClose),
      prepareMutation,
      requestReview,
    };
    const { rerender } = render(<InventoryApp client={client} />);

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
    const reviewButton = screen.getByRole("button", {
      name: "Open Trusted Review",
    });
    fireEvent.click(reviewButton);
    await waitFor(() =>
      expect(requestReview).toHaveBeenCalledWith("prepared-1"),
    );

    const focusTimers = installFocusTimerHarness();
    rerender(
      <InventoryApp
        client={clientFor(
          {
            ...plannedSnapshot,
            mutation: {
              ...plannedSnapshot.mutation,
              outcome: {
                effects: { status: "verified" },
                process: {
                  disposition: "completed",
                  exitCode: 0,
                  termination: "known",
                },
              },
              phase: "succeeded",
            },
          },
          reviewClose,
        )}
      />,
    );
    const outcome = await screen.findByText("completed / verified");
    const inventoryButton = screen.getByRole("button", { name: "Inventory" });
    act(() =>
      reviewClose.listener?.({ reviewId: "review-1", schemaVersion: 1 }),
    );
    expect(focusTimers.pendingCount()).toBe(1);

    act(() => focusTimers.runTick());
    expect(outcome).toHaveFocus();
    act(() => focusTimers.runTick());
    act(() => focusTimers.runTick());
    inventoryButton.focus();
    act(() => focusTimers.runTick());
    expect(outcome).toHaveFocus();
    for (let tick = 0; tick < 11; tick += 1) {
      act(() => focusTimers.runTick());
    }
    expect(focusTimers.pendingCount()).toBe(1);
    act(() => focusTimers.runTick());
    expect(focusTimers.pendingCount()).toBe(0);

    inventoryButton.focus();
    act(() => focusTimers.runTick());
    expect(inventoryButton).toHaveFocus();

    rerender(<InventoryApp client={client} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Trusted Review" }),
    );
    await waitFor(() => expect(requestReview).toHaveBeenCalledTimes(2));
    rerender(
      <InventoryApp
        client={clientFor(
          {
            ...plannedSnapshot,
            mutation: {
              ...plannedSnapshot.mutation,
              outcome: {
                effects: { status: "verified" },
                process: {
                  disposition: "completed",
                  exitCode: 0,
                  termination: "known",
                },
              },
              phase: "succeeded",
            },
          },
          reviewClose,
        )}
      />,
    );
    const restoredOutcome = await screen.findByText("completed / verified");
    act(() =>
      reviewClose.listener?.({ reviewId: "review-1", schemaVersion: 1 }),
    );
    expect(focusTimers.pendingCount()).toBe(1);
    fireEvent.keyDown(inventoryButton, { key: "Tab" });
    expect(focusTimers.pendingCount()).toBe(0);
    act(() => focusTimers.runTick());
    expect(restoredOutcome).not.toHaveFocus();
    expect(inventoryButton).toHaveFocus();
  });

  it("waits for native focus before restoring a cancelled review opener", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const prepareMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-cancel-1" },
    }));
    const requestReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "review-cancel-1" },
    }));
    const reviewClose = { listener: undefined } as ReviewCloseHarness;
    const plannedSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      mutation: {
        activeOperationId: null,
        commandPlan: {
          harness: "Codex",
          names: ["Case-Sensitive-Skill"],
          operation: "remove",
          preview:
            "npx skills@1.5.23 remove Case-Sensitive-Skill --project --yes",
          schemaVersion: 1,
          scope: "project",
          source: null,
          targetId: snapshot.target.id,
          timeoutMs: 120_000,
        },
        lastError: null,
        outcome: null,
        phase: "planned",
        reconciliationDeadline: null,
      },
    };
    const reviewingSnapshot: WorkspaceSnapshot = {
      ...plannedSnapshot,
      mutation: {
        ...plannedSnapshot.mutation,
        phase: "reviewing",
      },
    };
    const client: DesktopBridge = {
      ...clientFor(plannedSnapshot, reviewClose),
      prepareMutation,
      requestReview,
    };
    const { rerender } = render(<InventoryApp client={client} />);

    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "Case-Sensitive-Skill",
        })
      )[0]!,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare removal" }),
    );
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenCalledWith(snapshot.target.id, {
        names: ["Case-Sensitive-Skill"],
        scope: "project",
        type: "remove",
      }),
    );

    const reviewButton = screen.getByRole("button", {
      name: "Open Trusted Review",
    });
    fireEvent.click(reviewButton);
    await waitFor(() =>
      expect(requestReview).toHaveBeenCalledWith("prepared-cancel-1"),
    );

    rerender(
      <InventoryApp client={clientFor(reviewingSnapshot, reviewClose)} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Trusted Review" }),
      ).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Inventory" })).not.toHaveFocus();

    const inventoryButton = screen.getByRole("button", { name: "Inventory" });
    inventoryButton.focus();
    hasFocus.mockReturnValue(false);
    const focusTimers = installFocusTimerHarness();
    expect(inventoryButton).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    ).not.toHaveFocus();

    act(() =>
      reviewClose.listener?.({
        reviewId: "review-cancel-1",
        schemaVersion: 1,
      }),
    );
    expect(focusTimers.pendingCount()).toBe(1);
    for (let tick = 0; tick < 60; tick += 1) {
      act(() => focusTimers.runTick());
    }
    expect(inventoryButton).toHaveFocus();
    expect(focusTimers.pendingCount()).toBe(0);

    rerender(<InventoryApp client={clientFor(plannedSnapshot, reviewClose)} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Trusted Review" }),
      ).toBeEnabled(),
    );
    expect(focusTimers.pendingCount()).toBe(1);
    for (let tick = 0; tick < 60; tick += 1) {
      act(() => focusTimers.runTick());
    }
    expect(focusTimers.pendingCount()).toBe(0);

    hasFocus.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(focusTimers.pendingCount()).toBe(1);
    act(() => focusTimers.runTick());
    expect(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    ).toHaveFocus();
    for (let tick = 0; tick < 12; tick += 1) {
      act(() => focusTimers.runTick());
    }
    expect(focusTimers.pendingCount()).toBe(0);
  });

  it("ignores stale close ids and starts only for the matching review", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const reviewClose = { listener: undefined } as ReviewCloseHarness;
    const requestReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "review-current" },
    }));
    const { unmount } = render(
      <InventoryApp
        client={{
          ...clientFor(reviewableSnapshot, reviewClose),
          requestReview,
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare update" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Trusted Review" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    );
    await waitFor(() =>
      expect(requestReview).toHaveBeenCalledWith("prepared-1"),
    );

    const focusTimers = installFocusTimerHarness();
    act(() =>
      reviewClose.listener?.({ reviewId: "review-stale", schemaVersion: 1 }),
    );
    expect(focusTimers.pendingCount()).toBe(0);
    act(() =>
      reviewClose.listener?.({ reviewId: "review-current", schemaVersion: 1 }),
    );
    expect(focusTimers.pendingCount()).toBe(1);
    unmount();
    expect(reviewClose.listener).toBeUndefined();
    expect(focusTimers.pendingCount()).toBe(0);
    act(() => focusTimers.runTick());
    expect(focusTimers.pendingCount()).toBe(0);
  });

  it("buffers one close id that arrives before the review request resolves", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const reviewClose = { listener: undefined } as ReviewCloseHarness;
    let resolveRequest:
      | ((result: Awaited<ReturnType<DesktopBridge["requestReview"]>>) => void)
      | undefined;
    const requestReview = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<DesktopBridge["requestReview"]>>>(
          (resolve) => {
            resolveRequest = resolve;
          },
        ),
    );
    render(
      <InventoryApp
        client={{
          ...clientFor(reviewableSnapshot, reviewClose),
          requestReview,
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare update" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Trusted Review" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    );
    await waitFor(() =>
      expect(requestReview).toHaveBeenCalledWith("prepared-1"),
    );
    const focusTimers = installFocusTimerHarness();
    act(() =>
      reviewClose.listener?.({
        reviewId: "review-before-response",
        schemaVersion: 1,
      }),
    );
    expect(focusTimers.pendingCount()).toBe(0);

    resolveRequest?.({
      ok: true,
      value: { operationId: "review-before-response" },
    });
    await waitFor(() => expect(focusTimers.pendingCount()).toBe(1));
  });

  it("ignores a stale failed request after a newer review owns focus recovery", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const reviewClose = { listener: undefined } as ReviewCloseHarness;
    let resolveFirst:
      | ((result: Awaited<ReturnType<DesktopBridge["requestReview"]>>) => void)
      | undefined;
    const requestReview = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Awaited<ReturnType<DesktopBridge["requestReview"]>>>(
            (resolve) => {
              resolveFirst = resolve;
            },
          ),
      )
      .mockResolvedValueOnce({
        ok: true as const,
        value: { operationId: "review-current" },
      });
    render(
      <InventoryApp
        client={{
          ...clientFor(reviewableSnapshot, reviewClose),
          requestReview,
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare update" }),
    );
    const reviewButton = await screen.findByRole("button", {
      name: "Open Trusted Review",
    });
    fireEvent.click(reviewButton);
    fireEvent.click(reviewButton);
    await waitFor(() => expect(requestReview).toHaveBeenCalledTimes(2));

    const focusTimers = installFocusTimerHarness();
    act(() =>
      reviewClose.listener?.({ reviewId: "review-current", schemaVersion: 1 }),
    );
    await waitFor(() => expect(focusTimers.pendingCount()).toBe(1));

    await act(async () => {
      resolveFirst?.({
        error: {
          code: "review_invalid",
          effects: "none",
          message: "The stale review failed.",
          phase: "review",
          retryable: false,
        },
        ok: false,
      });
      await Promise.resolve();
    });
    expect(focusTimers.pendingCount()).toBe(1);
    expect(
      screen.queryByText("The stale review failed."),
    ).not.toBeInTheDocument();
  });

  it("cancels a close intent on user input and on a failed replacement request", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const reviewClose = { listener: undefined } as ReviewCloseHarness;
    const requestReview = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: { operationId: "review-key-input" },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: { operationId: "review-pointer-input" },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: { operationId: "review-click-input" },
      })
      .mockResolvedValueOnce({
        error: {
          code: "review_invalid" as const,
          effects: "none" as const,
          message: "The review is no longer available.",
          phase: "review" as const,
          retryable: false,
        },
        ok: false as const,
      });
    render(
      <InventoryApp
        client={{
          ...clientFor(reviewableSnapshot, reviewClose),
          requestReview,
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare update" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Trusted Review" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    );
    await waitFor(() => expect(requestReview).toHaveBeenCalledTimes(1));
    const focusTimers = installFocusTimerHarness();
    act(() =>
      reviewClose.listener?.({
        reviewId: "review-key-input",
        schemaVersion: 1,
      }),
    );
    expect(focusTimers.pendingCount()).toBe(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(focusTimers.pendingCount()).toBe(0);
    act(() =>
      reviewClose.listener?.({
        reviewId: "review-key-input",
        schemaVersion: 1,
      }),
    );
    expect(focusTimers.pendingCount()).toBe(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    );
    await waitFor(() => expect(requestReview).toHaveBeenCalledTimes(2));
    act(() =>
      reviewClose.listener?.({
        reviewId: "review-pointer-input",
        schemaVersion: 1,
      }),
    );
    expect(focusTimers.pendingCount()).toBe(1);
    fireEvent.pointerDown(document);
    expect(focusTimers.pendingCount()).toBe(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    );
    await waitFor(() => expect(requestReview).toHaveBeenCalledTimes(3));
    act(() =>
      reviewClose.listener?.({
        reviewId: "review-click-input",
        schemaVersion: 1,
      }),
    );
    expect(focusTimers.pendingCount()).toBe(1);
    fireEvent.click(document);
    expect(focusTimers.pendingCount()).toBe(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    );
    await waitFor(() => expect(requestReview).toHaveBeenCalledTimes(4));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The review is no longer available.",
    );
    act(() =>
      reviewClose.listener?.({
        reviewId: "review-replacement",
        schemaVersion: 1,
      }),
    );
    expect(focusTimers.pendingCount()).toBe(0);
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
      connectionReference: null,
      ...targetV4Metadata,
      generation: 2,
      id: "00000000-0000-4000-8000-00000000000a",
      kind: "local" as const,
      label: "Other device",
      workspace: "/work/other",
      workspaceLabel: "other",
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
    expect(screen.getByText("Stale evidence")).toBeInTheDocument();
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
      ...targetV4Metadata,
      generation: 1,
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
    const prepareRight = screen.getByRole("button", {
      name: "Prepare for Right",
    });
    expect(prepareRight).toBeDisabled();
    expect(prepareRight).toHaveAttribute(
      "title",
      "Reconciliation is required before this Target can receive a comparison mutation.",
    );
    expect(prepareRight).toHaveAttribute(
      "aria-describedby",
      "comparison-reconciliation-reason",
    );
  });

  it("explains disabled Compare when fewer than two Local Targets (#73)", async () => {
    render(
      <InventoryApp
        client={clientFor({
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
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));
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

  it("explains unqualified Prepare on stale comparison evidence (#73)", async () => {
    const rightTarget = {
      connectionReference: null,
      ...targetV4Metadata,
      generation: 1,
      id: "00000000-0000-4000-8000-00000000000a",
      kind: "local" as const,
      label: "Right device",
      workspace: "/work/right",
      workspaceLabel: "right",
    };
    const comparison = {
      id: "comparison-stale-prepare",
      leftFreshness: "fresh" as const,
      leftTargetId: snapshot.target.id,
      rightFreshness: "stale" as const,
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
            freshness: "stale" as const,
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
              deletionBlocked: false,
              inventory: snapshot.inventory,
              mutation: snapshot.mutation,
              target: rightTarget,
            },
          ],
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));
    const prepareRight = screen.getByRole("button", {
      name: "Prepare for Right",
    });
    expect(prepareRight).toBeDisabled();
    expect(prepareRight).toHaveAttribute(
      "title",
      "Fresh evidence is required on both Targets before planning.",
    );
    expect(prepareRight).toHaveAttribute(
      "aria-describedby",
      "comparison-freshness-reason",
    );
  });

  it("explains Prepare disabled when Missing side already has the skill (#73)", async () => {
    const rightTarget = {
      connectionReference: null,
      ...targetV4Metadata,
      generation: 1,
      id: "00000000-0000-4000-8000-00000000000a",
      kind: "local" as const,
      label: "Right device",
      workspace: "/work/right",
      workspaceLabel: "right",
    };
    const comparison = {
      id: "comparison-missing-left-has-skill",
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
              deletionBlocked: false,
              inventory: snapshot.inventory,
              mutation: snapshot.mutation,
              target: rightTarget,
            },
          ],
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));
    const prepareLeft = screen.getByRole("button", {
      name: "Prepare for Left",
    });
    expect(prepareLeft).toBeDisabled();
    expect(prepareLeft).toHaveAttribute(
      "title",
      "Prepare for Missing only when Left lacks the skill",
    );
    expect(prepareLeft).toHaveAttribute(
      "aria-describedby",
      "comparison-prepare-left-unqualified",
    );
    expect(
      document.getElementById("comparison-prepare-left-unqualified"),
    ).toHaveTextContent("Prepare for Missing only when Left lacks the skill");
    expect(
      screen.getByRole("button", { name: "Prepare for Right" }),
    ).toBeEnabled();
  });

  it("explains Prepare disabled when row is not Missing or version-drift (#73)", async () => {
    const rightTarget = {
      connectionReference: null,
      ...targetV4Metadata,
      generation: 1,
      id: "00000000-0000-4000-8000-00000000000a",
      kind: "local" as const,
      label: "Right device",
      workspace: "/work/right",
      workspaceLabel: "right",
    };
    const comparison = {
      id: "comparison-matched-prepare",
      leftFreshness: "fresh" as const,
      leftTargetId: snapshot.target.id,
      rightFreshness: "fresh" as const,
      rightTargetId: rightTarget.id,
      rows: [
        {
          dimensions: {
            contentFingerprint: "matched" as const,
            declaredSource: "matched" as const,
            presence: "both" as const,
            revision: "matched" as const,
          },
          key: "Case-Sensitive-Skill",
          left: {
            entries: snapshot.inventory.entries,
            freshness: "fresh" as const,
            harnessAvailability: "available" as const,
          },
          right: {
            entries: snapshot.inventory.entries,
            freshness: "fresh" as const,
            harnessAvailability: "available" as const,
          },
          summary: "matched" as const,
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
              deletionBlocked: false,
              inventory: snapshot.inventory,
              mutation: snapshot.mutation,
              target: rightTarget,
            },
          ],
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));
    const prepareRight = screen.getByRole("button", {
      name: "Prepare for Right",
    });
    expect(prepareRight).toBeDisabled();
    expect(prepareRight).toHaveAttribute(
      "title",
      "Prepare only applies to Missing or Revision or content drift rows (current: Matched)",
    );
    expect(prepareRight).toHaveAttribute(
      "aria-describedby",
      "comparison-prepare-right-unqualified",
    );
    expect(
      document.getElementById("comparison-prepare-right-unqualified"),
    ).toHaveTextContent(
      "Prepare only applies to Missing or Revision or content drift rows (current: Matched)",
    );
  });

  it("shows next-step copy on Inspector and Comparison empty states (#78)", async () => {
    const { unmount } = render(
      <InventoryApp
        client={clientFor({
          ...snapshot,
          inventory: {
            ...snapshot.inventory,
            entries: [],
            freshness: "fresh",
          },
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "No skills to inspect" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Refresh this Target, or install a skill via npx skills.",
      ),
    ).toBeInTheDocument();
    unmount();

    render(<InventoryApp client={clientFor(snapshot)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));
    expect(
      screen.getByText("Click Compare to build the aligned skill table."),
    ).toBeInTheDocument();
  });

  it("keeps No skill selected when inventory still has rows (#111)", async () => {
    let listener: ((event: DesktopEvent) => void) | undefined;
    let snapshots = 0;
    const otherSkill = {
      ...snapshot.inventory.entries[0]!,
      name: "Other-Skill",
      scope: "project" as const,
    };
    const client: DesktopBridge = {
      ...clientFor(snapshot),
      async getSnapshot() {
        snapshots += 1;
        return {
          ok: true as const,
          value:
            snapshots === 1
              ? {
                  ...snapshot,
                  inventory: {
                    ...snapshot.inventory,
                    entries: [...snapshot.inventory.entries, otherSkill],
                  },
                }
              : {
                  ...snapshot,
                  inventory: {
                    ...snapshot.inventory,
                    entries: [otherSkill],
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
    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "Case-Sensitive-Skill",
        })
      )[0]!,
    );
    expect(
      screen.getByRole("heading", { name: "Case-Sensitive-Skill" }),
    ).toBeInTheDocument();

    await act(async () => {
      listener?.({
        reason: "buffer_overflow",
        sequence: 1,
        sessionEpoch: "epoch-1",
        stateRevision: 2,
        type: "resync.required",
      });
    });

    expect(
      await screen.findByRole("heading", { name: "No skill selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Select a skill in the table to inspect evidence."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "No skills to inspect" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Other-Skill")).toBeInTheDocument();
  });

  it("humanizes Targets list pills and hides Generation by default (#74)", async () => {
    render(
      <InventoryApp
        client={clientFor({
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
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Targets" }));
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    const advanced = screen.getByText("Advanced");
    const details = advanced.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("Generation");
    fireEvent.click(advanced);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Generation")).toBeInTheDocument();
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
        harnessIds: ["codex"],
        kind: "local",
        label: "Local workspace",
        workspace: "/work/other",
      }),
    );
    expect(await screen.findByText("Target created")).toBeInTheDocument();
  });

  it("does not offer operable host-key Trusted Review under SSH V1-unavailable chrome", async () => {
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
        ...targetV4Metadata,
        generation: 2,
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

    expect(
      await screen.findByText(/主机身份复核 · 未在 V1 开放/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/请打开主机身份复核/)).not.toBeInTheDocument();
    expect(screen.getByText(/主机身份复核未在 V1 开放/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review host identity" }),
    ).not.toBeInTheDocument();
    expect(requestHostTrustReview).not.toHaveBeenCalled();
  });

  it("hard-disables Inventory mutation CTAs and shows SSH-active banner for SSH Targets", async () => {
    const prepareMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-ssh" },
    }));
    const sshTarget = {
      connectionReference: "build-host",
      ...targetV4Metadata,
      generation: 2,
      id: "00000000-0000-4000-8000-000000000018",
      kind: "ssh" as const,
      label: "Build host",
      workspace: "/srv/skills",
      workspaceLabel: "skills",
    };
    render(
      <InventoryApp
        client={{
          ...clientFor({
            ...snapshot,
            target: sshTarget,
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
                deletionBlocked: false,
                inventory: snapshot.inventory,
                mutation: snapshot.mutation,
                target: sshTarget,
              },
            ],
          }),
          prepareMutation,
        }}
      />,
    );

    expect(await screen.findAllByText("未开放")).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Build host/i }));

    expect(
      await screen.findByText(/远程 Target 仅保留只读痕迹/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("SSH 未开放")).toBeInTheDocument();
    expect(
      document.getElementById("inventory-ssh-unavailable-reason"),
    ).not.toBeNull();

    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "Case-Sensitive-Skill",
        })
      )[0]!,
    );
    const prepareUpdate = screen.getByRole("button", {
      name: "Prepare update",
    });
    const prepareRemoval = screen.getByRole("button", {
      name: "Prepare removal",
    });
    const prepareAdd = screen.getByRole("button", { name: "Prepare add" });
    expect(prepareUpdate).toBeDisabled();
    expect(prepareRemoval).toBeDisabled();
    expect(prepareAdd).toBeDisabled();
    expect(prepareUpdate).toHaveAttribute(
      "title",
      "SSH · 未在 V1 开放，无法准备变更",
    );
    expect(prepareUpdate).toHaveAttribute(
      "aria-describedby",
      "inventory-ssh-unavailable-reason",
    );
    expect(prepareAdd).toHaveAttribute(
      "aria-describedby",
      "inventory-ssh-unavailable-reason",
    );
    fireEvent.click(prepareUpdate);
    fireEvent.click(prepareRemoval);
    expect(prepareMutation).not.toHaveBeenCalled();
  });

  it("disables SSH Targets as plannable Comparison sides", async () => {
    const sshTarget = {
      connectionReference: "build-host",
      ...targetV4Metadata,
      generation: 2,
      id: "00000000-0000-4000-8000-00000000000a",
      kind: "ssh" as const,
      label: "Build host",
      workspace: "/srv/skills-desktop",
      workspaceLabel: "skills-desktop",
    };
    const localB = {
      connectionReference: null,
      ...targetV4Metadata,
      generation: 1,
      id: "00000000-0000-4000-8000-00000000000b",
      kind: "local" as const,
      label: "Second local",
      workspace: "/work/second",
      workspaceLabel: "second",
    };
    render(
      <InventoryApp
        client={clientFor({
          ...snapshot,
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
              deletionBlocked: false,
              inventory: snapshot.inventory,
              mutation: snapshot.mutation,
              target: sshTarget,
            },
            {
              deletionBlocked: false,
              inventory: snapshot.inventory,
              mutation: snapshot.mutation,
              target: localB,
            },
          ],
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));
    const sshOptions = screen.getAllByRole("option", {
      name: /Build host · 未开放/,
    });
    expect(sshOptions.length).toBeGreaterThan(0);
    for (const option of sshOptions) {
      expect(option).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Compare" })).not.toBeDisabled();
  });

  it("explains stale freshness blocked mutation controls with Refresh next step (#70)", async () => {
    const refreshInventory = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "refresh-stale-1" },
    }));
    render(
      <InventoryApp
        client={{
          ...clientFor({
            ...snapshot,
            inventory: {
              ...snapshot.inventory,
              freshness: "stale",
            },
          }),
          refreshInventory,
        }}
      />,
    );

    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "Case-Sensitive-Skill",
        })
      )[0]!,
    );

    const reason = "需要先刷新 inventory 证据";
    expect(
      document.getElementById("inventory-mutation-blocked-reason"),
    ).toHaveTextContent(reason);
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveAttribute(
      "id",
      "inventory-refresh-cta",
    );

    const prepareUpdate = screen.getByRole("button", {
      name: "Prepare update",
    });
    const prepareAdd = screen.getByRole("button", { name: "Prepare add" });
    expect(prepareUpdate).toBeDisabled();
    expect(prepareAdd).toBeDisabled();
    expect(prepareUpdate).toHaveAttribute("title", reason);
    expect(prepareUpdate).toHaveAttribute(
      "aria-describedby",
      "inventory-mutation-blocked-reason inventory-refresh-cta",
    );
    expect(prepareAdd).toHaveAttribute(
      "aria-describedby",
      "inventory-mutation-blocked-reason inventory-refresh-cta",
    );
    expect(screen.getByText(reason)).toBeInTheDocument();
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
