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
  ApplicationMenu,
  MenuCommandEvent,
} from "../../../contracts/menu.js";
import type {
  DesktopEvent,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { buildApplicationMenu } from "../../../main/application/application-menu.js";
import { CollectionsView } from "../collections/CollectionsView.js";
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

interface MenuHarness {
  listener: ((event: MenuCommandEvent) => void) | undefined;
  menu?: ApplicationMenu;
}

function clientFor(
  value: WorkspaceSnapshot,
  reviewCloseHarness?: ReviewCloseHarness,
  menuHarness?: MenuHarness,
): DesktopBridge {
  return {
    about: aboutClient,
    menu: {
      async getMenu() {
        return menuHarness?.menu === undefined
          ? {
              error: {
                code: "internal_error",
                message: "The menu could not be read.",
                retryable: true,
              },
              ok: false,
            }
          : { ok: true, value: menuHarness.menu };
      },
      subscribeMenuCommand(listener) {
        if (menuHarness !== undefined) menuHarness.listener = listener;
        return () => {
          if (menuHarness?.listener === listener)
            menuHarness.listener = undefined;
        };
      },
    },
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
    async handoffSkillsSh(recordId) {
      return { ok: true, value: { operationId: recordId } };
    },
    async importPackage() {
      return { ok: true, value: { operationId: "import-1" } };
    },
    async choosePublicationSource() {
      return { ok: true, value: { operationId: "publication-1" } };
    },
    async exportPublication() {
      return { ok: true, value: { operationId: "publication-1" } };
    },
    async preparePublication() {
      return { ok: true, value: { operationId: "publication-1" } };
    },
    async requestPublicationReview() {
      return { ok: true, value: { operationId: "publication-1" } };
    },
    async discardPublication() {
      return { ok: true, value: { operationId: "publication-1" } };
    },
    async reconcilePublication() {
      return { ok: true, value: { operationId: "publication-1" } };
    },
    async openStudioFolder() {
      return { ok: true, value: { operationId: "studio-1" } };
    },
    async releaseStudioGrant() {
      return { ok: true, value: { operationId: "studio-1" } };
    },
    async validateStudioGrant() {
      return { ok: true, value: { operationId: "studio-1" } };
    },
    async createStudioDraft() {
      return { ok: true, value: { operationId: "studio-1" } };
    },
    async saveStudioDraft() {
      return { ok: true, value: { operationId: "studio-1" } };
    },
    async deleteStudioDraft() {
      return { ok: true, value: { operationId: "studio-1" } };
    },
    async previewStudioDraft() {
      return { ok: true, value: { operationId: "studio-1" } };
    },
    async exportStudioDraft() {
      return { ok: true, value: { operationId: "studio-1" } };
    },
    async inspectSource() {
      return { ok: true, value: { operationId: "inspection-1" } };
    },
    async updatePreferences() {
      return { ok: true, value: { operationId: "preferences" } };
    },
    async repairTarget(targetId) {
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
    expect(screen.getByLabelText("Skill evidence details")).toHaveAttribute(
      "tabindex",
      "0",
    );
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

  it("keeps the inspector aligned with visible search results and clears search", async () => {
    const client = clientFor({
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        entries: [
          snapshot.inventory.entries[0]!,
          {
            ...snapshot.inventory.entries[0]!,
            name: "Another-Skill",
          },
        ],
      },
    });
    render(<InventoryApp client={client} />);

    const search = await screen.findByRole("searchbox", {
      name: "Search inventory",
    });
    fireEvent.change(search, { target: { value: "no-match" } });

    expect(screen.getByText("0 of 2 shown")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No matching skills" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Change the current search or scope filter."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No skill selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Clear inventory search" }),
    ).toHaveLength(1);
    expect(
      search.closest(".search-control")?.querySelectorAll("button"),
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Clear inventory search" }),
    );

    expect(await screen.findByText("2 shown")).toBeInTheDocument();
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Clear inventory search" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Case-Sensitive-Skill" }),
    ).toBeInTheDocument();
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
    expect(openingAlert).toHaveTextContent(
      "You are not allowed to perform this operation.",
    );
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
      expected: "The local process failed. Refresh, then try again.",
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
    expect(primary).toHaveTextContent(
      "The local process failed. Refresh, then try again.",
    );
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

  it("clears empty-result search and scope filters in one action", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    const search = await screen.findByRole("searchbox", {
      name: "Search inventory",
    });
    const inventoryScope = screen.getByRole("group", {
      name: "Inventory scope",
    });
    const allScope = within(inventoryScope).getByRole("button", {
      name: "All scopes",
    });
    const globalScope = within(inventoryScope).getByRole("button", {
      name: "Global scope",
    });

    fireEvent.click(globalScope);
    fireEvent.change(search, { target: { value: "no-such-skill" } });

    expect(
      screen.getByRole("heading", { name: "No matching skills" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(allScope).toHaveAttribute("aria-pressed", "true");
    expect(globalScope).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Case-Sensitive-Skill" }),
    ).toBeInTheDocument();
  });

  it("clears Inspector when the visible table is empty (#143)", async () => {
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
              },
            ],
          },
        })}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Prepare removal" }),
    ).toBeInTheDocument();

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
      screen.getByRole("heading", { name: "No skill selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No skills in the current filter."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Prepare removal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Prepare update" }),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search inventory" }),
      {
        target: { value: "" },
      },
    );

    expect(
      await screen.findByRole("button", { name: "Prepare removal" }),
    ).toBeInTheDocument();
  });

  it("focuses and clears Inventory search without stealing editable input", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    const search = await screen.findByRole("searchbox", {
      name: "Search inventory",
    });
    const inventoryButton = screen.getByRole("button", { name: "Inventory" });
    inventoryButton.focus();

    fireEvent.keyDown(inventoryButton, { key: "/" });
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: "no-such-skill" } });
    expect(
      screen.getByRole("heading", { name: "No matching skills" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Case-Sensitive-Skill" }),
    ).toBeInTheDocument();

    const source = screen.getByRole("textbox", { name: "Source" });
    source.focus();
    fireEvent.keyDown(source, { key: "/" });
    expect(source).toHaveFocus();
    expect(search).not.toHaveFocus();
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
    expect(screen.getByText("0 of 1 shown")).toBeInTheDocument();
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

    fireEvent.change(screen.getByRole("textbox", { name: "Source" }), {
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

  it("binds add and removal to a chosen harness subset while update stays unscoped (#200)", async () => {
    const prepareMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared" },
    }));
    const multiHarness: WorkspaceSnapshot = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        entries: [
          { ...snapshot.inventory.entries[0]!, agents: ["amp", "codex"] },
        ],
      },
      target: { ...snapshot.target, harnessIds: ["amp", "codex"] },
    };
    render(
      <InventoryApp client={{ ...clientFor(multiHarness), prepareMutation }} />,
    );

    const subset = await screen.findByRole("group", {
      name: "Bind add and removal to",
    });
    fireEvent.click(
      within(subset).getByRole("checkbox", { name: "Amp (amp)" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Prepare removal" }));
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenLastCalledWith(multiHarness.target.id, {
        harnessIds: ["codex"],
        names: ["Case-Sensitive-Skill"],
        scope: "project",
        type: "remove",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Prepare update" }));
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenLastCalledWith(multiHarness.target.id, {
        names: ["Case-Sensitive-Skill"],
        scope: "project",
        type: "update",
      }),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Source" }), {
      target: { value: "example/skills" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Exact skill name" }),
      {
        target: { value: "find-skills" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare add" }));
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenLastCalledWith(multiHarness.target.id, {
        harnessIds: ["codex"],
        names: ["find-skills"],
        scope: "project",
        source: { source: "example/skills", sourceType: "github" },
        type: "add",
      }),
    );

    // Re-checking restores the whole set, which is sent as the legacy shape.
    fireEvent.click(
      within(subset).getByRole("checkbox", { name: "Amp (amp)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare removal" }));
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenLastCalledWith(multiHarness.target.id, {
        names: ["Case-Sensitive-Skill"],
        scope: "project",
        type: "remove",
      }),
    );
  });

  it("offers Open on skills.sh only for a record main derived, and says opened rather than published (#208)", async () => {
    const recordId = "d".repeat(64);
    const handoffSkillsSh = vi.fn(async (id: string) => ({
      ok: true as const,
      value: { operationId: id },
    }));
    const withHandoff: WorkspaceSnapshot = {
      ...snapshot,
      skillsShHandoffs: [
        {
          id: recordId,
          kind: "skills-sh",
          owner: "example",
          repository: "skills",
          skill: "Case-Sensitive-Skill",
          sourceEntry: { name: "Case-Sensitive-Skill", scope: "project" },
        },
      ],
    };
    render(
      <InventoryApp client={{ ...clientFor(withHandoff), handoffSkillsSh }} />,
    );

    const open = await screen.findByRole("button", {
      name: "Open on skills.sh",
    });
    expect(
      screen.getByText(
        /Opens skills\.sh\/example\/skills\/Case-Sensitive-Skill/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(open);
    await waitFor(() => expect(handoffSkillsSh).toHaveBeenCalledWith(recordId));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Opened in your browser");
    expect(status).not.toHaveTextContent(/published/i);
    // The bridge received a record id, not a URL.
    expect(JSON.stringify(handoffSkillsSh.mock.calls)).not.toContain(
      "https://",
    );
  });

  it("hides Open on skills.sh when the Snapshot carries no handoff record for the skill", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);
    expect(
      await screen.findByRole("button", { name: "Prepare removal" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open on skills.sh" }),
    ).not.toBeInTheDocument();
  });

  it("shows the harness effect of a planned update beside its Command Plan", async () => {
    render(
      <InventoryApp
        client={clientFor({
          ...reviewableSnapshot,
          mutation: {
            ...reviewableSnapshot.mutation,
            commandPlan: {
              ...reviewableSnapshot.mutation.commandPlan!,
              harnessEffect: {
                kind: "cli-unscoped",
                targetHarnessIds: ["codex"],
              },
            },
          },
        })}
      />,
    );
    expect(await screen.findByText("Harness effect")).toBeInTheDocument();
    expect(
      screen.getByText(/updates every CLI-managed link for the listed Skills/),
    ).toBeInTheDocument();
  });

  it("explains invalid GitHub source next to Add Skill instead of an unsupported request (#138)", async () => {
    const prepareMutation = vi.fn();
    render(
      <InventoryApp
        client={{
          ...clientFor(snapshot),
          prepareMutation,
        }}
      />,
    );

    fireEvent.change(await screen.findByRole("textbox", { name: "Source" }), {
      target: { value: "not-a-repo" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Exact skill name" }),
      {
        target: { value: "not-a-repo" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare add" }));

    const form = screen
      .getByRole("heading", { name: "Add Skill" })
      .closest("form");
    expect(form).not.toBeNull();
    const alert = await screen.findByRole("alert");
    expect(form!).toContainElement(alert);
    expect(alert).toHaveTextContent(
      "Direct add needs a GitHub owner/repository. Inspect the source to add from other kinds of source.",
    );
    expect(
      screen.queryByText("The request is not supported."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Source" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(prepareMutation).not.toHaveBeenCalled();
  });

  it("inspects a source read-only, then binds the selected listed Skills to that inspection (#201)", async () => {
    const descriptor = {
      family: "github" as const,
      locality: "portable" as const,
      mutability: "mutable" as const,
      ref: null,
      schemaVersion: 1 as const,
      source: "vercel-labs/skills",
    };
    const inspectedSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      eventSequence: 2,
      sourceInspection: {
        activeOperationId: null,
        inspection: {
          candidates: [
            {
              description: "Helps users discover skills.",
              group: null,
              name: "find-skills",
            },
            {
              description: "Reviews pull requests.",
              group: "review",
              name: "code-review",
            },
          ],
          descriptor,
          digest: "a".repeat(64),
          inspectedAt: "2026-08-21T10:00:30.000Z",
          inspectionId: "inspection-1",
          targetGeneration: snapshot.target.generation,
          targetId: snapshot.target.id,
        },
        lastError: null,
        phase: "ready",
      },
      stateRevision: 3,
    };
    let listener: ((event: DesktopEvent) => void) | undefined;
    let current: WorkspaceSnapshot = snapshot;
    const inspectingSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      eventSequence: 1,
      sourceInspection: {
        activeOperationId: "inspect-1",
        inspection: null,
        lastError: null,
        phase: "inspecting",
      },
      stateRevision: 2,
    };
    const publish = async (next: WorkspaceSnapshot) => {
      current = next;
      await act(async () => {
        listener?.({
          sequence: next.eventSequence,
          sessionEpoch: "epoch-1",
          snapshot: next,
          stateRevision: next.stateRevision,
          type: "snapshot.changed",
        });
      });
    };
    const cancelInventory = vi.fn(async (operationId: string) => ({
      ok: true as const,
      value: { operationId },
    }));
    const inspectSource = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "inspect-1" },
    }));
    const prepareMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-add" },
    }));
    const client: DesktopBridge = {
      ...clientFor(snapshot),
      cancelInventory,
      async getSnapshot() {
        return { ok: true, value: current };
      },
      inspectSource,
      prepareMutation,
      subscribe(next) {
        listener = next;
        return () => undefined;
      },
    };
    render(<InventoryApp client={client} />);

    const source = await screen.findByRole("textbox", { name: "Source" });
    const inspect = screen.getByRole("button", { name: "Inspect source" });
    expect(inspect).toBeDisabled();
    fireEvent.change(source, { target: { value: " vercel-labs/skills " } });
    expect(inspect).toBeEnabled();
    expect(
      screen.getByRole("textbox", { name: "Exact skill name" }),
    ).toBeInTheDocument();

    fireEvent.click(inspect);
    await waitFor(() =>
      expect(inspectSource).toHaveBeenCalledWith(
        snapshot.target.id,
        "vercel-labs/skills",
      ),
    );
    await publish(inspectingSnapshot);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Inspecting vercel-labs/skills…",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel inspection" }));
    expect(cancelInventory).toHaveBeenCalledWith("inspect-1");

    await publish(inspectedSnapshot);
    const listing = await screen.findByTestId("source-inspection");
    expect(listing).toHaveTextContent("Skills listed in vercel-labs/skills");
    expect(listing).toHaveTextContent("2 Skills listed · Mutable source");
    expect(listing).toHaveTextContent("Helps users discover skills.");
    expect(
      screen.queryByRole("textbox", { name: "Exact skill name" }),
    ).not.toBeInTheDocument();

    const prepare = screen.getByRole("button", {
      name: "Prepare add of selected Skills",
    });
    fireEvent.click(prepare);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Select at least one listed Skill.",
    );
    expect(prepareMutation).not.toHaveBeenCalled();

    fireEvent.click(
      within(listing).getByRole("checkbox", { name: /code-review/ }),
    );
    fireEvent.click(
      within(listing).getByRole("checkbox", { name: /find-skills/ }),
    );
    fireEvent.click(prepare);
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenCalledWith(snapshot.target.id, {
        names: ["find-skills", "code-review"],
        scope: "project",
        source: {
          descriptor,
          inspection: { digest: "a".repeat(64), id: "inspection-1" },
          sourceType: "inspected",
        },
        type: "add",
      }),
    );

    // Editing the source text detaches the form from the listing: the direct
    // GitHub path returns until the new text is inspected.
    fireEvent.change(source, { target: { value: "vercel-labs/other" } });
    expect(screen.queryByTestId("source-inspection")).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Exact skill name" }),
    ).toBeInTheDocument();
  });

  it("drops an unchecked listed Skill from the prepared selection", async () => {
    const descriptor = {
      family: "github" as const,
      locality: "portable" as const,
      mutability: "mutable" as const,
      ref: null,
      schemaVersion: 1 as const,
      source: "vercel-labs/skills",
    };
    const inspectedSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      eventSequence: 1,
      sourceInspection: {
        activeOperationId: null,
        inspection: {
          candidates: [
            {
              description: "Helps users discover skills.",
              group: null,
              name: "find-skills",
            },
            {
              description: "Reviews pull requests.",
              group: "review",
              name: "code-review",
            },
          ],
          descriptor,
          digest: "a".repeat(64),
          inspectedAt: "2026-08-21T10:00:30.000Z",
          inspectionId: "inspection-1",
          targetGeneration: snapshot.target.generation,
          targetId: snapshot.target.id,
        },
        lastError: null,
        phase: "ready",
      },
      stateRevision: 2,
    };
    const prepareMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-add" },
    }));
    render(
      <InventoryApp
        client={{ ...clientFor(inspectedSnapshot), prepareMutation }}
      />,
    );

    fireEvent.change(
      await screen.findByRole("textbox", { name: "Source" }),
      { target: { value: "vercel-labs/skills" } },
    );
    const listing = await screen.findByTestId("source-inspection");
    const codeReview = within(listing).getByRole("checkbox", {
      name: /code-review/,
    });
    fireEvent.click(codeReview);
    fireEvent.click(codeReview);

    fireEvent.click(
      screen.getByRole("button", { name: "Prepare add of selected Skills" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Select at least one listed Skill.",
    );
    expect(prepareMutation).not.toHaveBeenCalled();
  });

  it("surfaces inspection failures next to the source field and discloses a planned source's mutability (#201)", async () => {
    const inspectSource = vi.fn(async () => ({
      error: {
        code: "source_unavailable" as const,
        effects: "none" as const,
        message:
          "The pinned Skills CLI could not list Skills from this source.",
        phase: "inspect",
        retryable: true,
      },
      ok: false as const,
    }));
    const plannedAdd: WorkspaceSnapshot = {
      ...snapshot,
      mutation: {
        ...snapshot.mutation,
        commandPlan: {
          harness: "codex",
          names: ["find-skills"],
          operation: "add",
          preview:
            "npx skills@1.5.23 add vercel-labs/skills --skill find-skills --agent codex --yes",
          schemaVersion: 1,
          scope: "project",
          source: {
            family: "github",
            inspectionDigest: "a".repeat(64),
            inspectionId: "inspection-1",
            mutability: "mutable",
            ref: null,
            source: "vercel-labs/skills",
            sourceType: "inspected",
          },
          targetId: snapshot.target.id,
          timeoutMs: 600_000,
        },
        phase: "planned",
      },
    };
    render(
      <InventoryApp client={{ ...clientFor(plannedAdd), inspectSource }} />,
    );

    const planSource = await screen.findByTestId("command-plan-source");
    expect(planSource).toHaveTextContent("vercel-labs/skills");
    expect(planSource).toHaveTextContent("Mutable source");

    fireEvent.change(screen.getByRole("textbox", { name: "Source" }), {
      target: { value: "vercel-labs/missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect source" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The pinned Skills CLI could not fetch this source.",
    );
    expect(screen.getByRole("textbox", { name: "Source" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
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

  it("marks SSH Targets as unavailable in the Inventory chooser", async () => {
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
    const snapshotWithSsh: WorkspaceSnapshot = {
      ...twoLocalTargetsSnapshot,
      targets: [
        ...twoLocalTargetsSnapshot.targets!,
        {
          deletionBlocked: false,
          inventory: snapshot.inventory,
          mutation: snapshot.mutation,
          target: sshTarget,
        },
      ],
    };
    render(<InventoryApp client={clientFor(snapshotWithSsh)} />);

    const chooser = await screen.findByRole("combobox", { name: "Target" });
    expect(
      within(chooser).getByRole("option", {
        name: "Build host · Not available",
      }),
    ).toBeInTheDocument();

    fireEvent.change(chooser, { target: { value: sshTarget.id } });
    expect(chooser).toHaveDisplayValue("Build host · Not available");
    expect(
      await screen.findByText(/Remote Targets keep a read-only trace/),
    ).toBeInTheDocument();
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
        origin: "official",
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

  it("selects only missing addable skills and preserves explicit reapply choices", async () => {
    const value = structuredClone(collectionSnapshot);
    const assessment = value.collections?.releases[0]?.assessments[0];
    if (assessment === undefined) throw new Error("Missing collection fixture");
    assessment.entries.push(
      {
        inRelease: true,
        name: "another-missing",
        selectable: true,
        selectionModes: ["add"],
        status: "missing",
      },
      {
        inRelease: true,
        name: "existing-skill",
        selectable: true,
        selectionModes: ["reapply"],
        status: "present-content-unknown",
      },
      {
        inRelease: true,
        name: "blocked-missing",
        selectable: false,
        selectionModes: ["add"],
        status: "missing",
      },
    );
    const prepareCollectionAcrossTargets = vi.fn(
      clientFor(value).prepareCollectionAcrossTargets,
    );
    render(
      <InventoryApp client={{ ...clientFor(value), prepareCollectionAcrossTargets }} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    const selectMissing = screen.getByRole("button", {
      name: "Select missing skills on This device",
    });
    fireEvent.click(selectMissing);
    for (const name of ["find-skills", "another-missing"]) {
      expect(screen.getByRole("checkbox", { name: `Select ${name}` })).toBeChecked();
    }
    for (const name of ["existing-skill", "blocked-missing", "tdd"]) {
      expect(screen.getByRole("checkbox", { name: `Select ${name}` })).not.toBeChecked();
    }
    expect(selectMissing).toBeDisabled();
    expect(prepareCollectionAcrossTargets).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select existing-skill" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select find-skills" }));
    expect(selectMissing).toBeEnabled();
    fireEvent.click(selectMissing);
    expect(screen.getByRole("checkbox", { name: "Select existing-skill" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan" }));
    await waitFor(() => expect(prepareCollectionAcrossTargets).toHaveBeenCalledWith({
      collectionId: "skills-desktop-starter",
      manifestDigest: `sha256:${"a".repeat(64)}`,
      origin: "official",
      releaseNumber: 1,
      targets: [{
        scope: "project",
        selections: [
          { mode: "add", name: "find-skills" },
          { mode: "add", name: "another-missing" },
          { mode: "reapply", name: "existing-skill" },
        ],
        targetId: snapshot.target.id,
      }],
    }));
  });

  it("clears add and reapply choices without preparing a mutation", async () => {
    const value = structuredClone(collectionSnapshot);
    const assessment = value.collections?.releases[0]?.assessments[0];
    if (assessment === undefined) throw new Error("Missing collection fixture");
    assessment.entries.push({
      inRelease: true,
      name: "existing-skill",
      selectable: true,
      selectionModes: ["reapply"],
      status: "present-content-unknown",
    });
    const prepareCollectionAcrossTargets = vi.fn(clientFor(value).prepareCollectionAcrossTargets);
    render(<CollectionsView client={{ ...clientFor(value), prepareCollectionAcrossTargets }} snapshot={value} />);
    const clear = screen.getByRole("button", { name: "Clear selection on This device" });
    expect(clear).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select missing skills on This device" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select existing-skill" }));
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    expect(screen.getByRole("checkbox", { name: "Select find-skills" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select existing-skill" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include This device" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Scope" })).toHaveValue("project");
    expect(clear).toBeDisabled();
    expect(screen.getByRole("button", { name: "Prepare plan" })).toBeDisabled();
    expect(prepareCollectionAcrossTargets).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select find-skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan" }));
    await waitFor(() => expect(prepareCollectionAcrossTargets).toHaveBeenCalledWith(
      expect.objectContaining({ targets: [{
        scope: "project",
        selections: [{ mode: "add", name: "find-skills" }],
        targetId: snapshot.target.id,
      }] }),
    ));
  });

  it("clears only the chosen Target and preserves its global scope", () => {
    const otherTarget = { ...snapshot.target, id: "00000000-0000-4000-8000-000000000002", label: "Second local" };
    const otherCollections = structuredClone(collectionSnapshot.collections);
    if (otherCollections === undefined) throw new Error("Missing collection fixture");
    for (const release of otherCollections.releases) {
      for (const assessment of release.assessments) assessment.targetId = otherTarget.id;
    }
    const targetState = { deletionBlocked: false, inventory: snapshot.inventory, mutation: snapshot.mutation };
    const value: WorkspaceSnapshot = {
      ...collectionSnapshot,
      targets: [
        { ...targetState, collections: collectionSnapshot.collections, target: snapshot.target },
        { ...targetState, collections: otherCollections, target: otherTarget },
      ],
    };
    render(<CollectionsView client={clientFor(value)} snapshot={value} />);
    const scopes = screen.getAllByRole("combobox", { name: "Scope" });
    const firstScope = scopes[0];
    if (firstScope === undefined) throw new Error("Missing scope control");
    fireEvent.change(firstScope, { target: { value: "global" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Second local" }));
    fireEvent.click(screen.getByRole("button", { name: "Select missing skills on This device" }));
    fireEvent.click(screen.getByRole("button", { name: "Select missing skills on Second local" }));
    const include = screen.getByRole("checkbox", { name: "Include This device" });
    const clear = screen.getByRole("button", { name: "Clear selection on This device" });
    fireEvent.click(include);
    expect(clear).toBeDisabled();
    fireEvent.click(include);
    fireEvent.click(clear);
    expect(screen.getByRole("checkbox", { name: "Select find-skills on This device" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select tdd on This device" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select find-skills on Second local" })).toBeChecked();
    expect(firstScope).toHaveValue("global");
    expect(include).toBeChecked();
  });

  it("keeps selection locked while a Collection plan is being prepared", async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const client: DesktopBridge = {
      ...clientFor(collectionSnapshot),
      async prepareCollectionAcrossTargets() {
        await pending;
        return { ok: true, value: { operationId: "collection-plan-1" } };
      },
    };
    render(<CollectionsView client={client} snapshot={collectionSnapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "Select missing skills on This device" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan" }));
    const clear = screen.getByRole("button", { name: "Clear selection on This device" });
    expect(clear).toBeDisabled();
    fireEvent.click(clear);
    expect(screen.getByRole("checkbox", { name: "Select find-skills" })).toBeChecked();
    await act(async () => { finish?.(); await pending; });
    expect(clear).toBeEnabled();
  });

  it("limits bulk selection to the current scope and included Target", async () => {
    render(<InventoryApp client={clientFor(collectionSnapshot)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    const selectMissing = screen.getByRole("button", {
      name: "Select missing skills on This device",
    });
    const include = screen.getByRole("checkbox", { name: "Include This device" });
    fireEvent.click(include);
    expect(selectMissing).toBeDisabled();
    fireEvent.click(include);
    fireEvent.click(selectMissing);
    fireEvent.change(screen.getByRole("combobox", { name: "Scope" }), {
      target: { value: "global" },
    });
    expect(screen.getByRole("checkbox", { name: "Select find-skills" })).not.toBeChecked();
    expect(selectMissing).toBeEnabled();
    fireEvent.click(selectMissing);
    expect(screen.getByRole("checkbox", { name: "Select find-skills" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select tdd" })).toBeChecked();
  });

  it.each(["stale", "incompatible", "not-executable", "no-missing", "reconciliation", "ssh"])(
    "disables bulk selection for %s evidence",
    async (condition) => {
      const value = structuredClone(collectionSnapshot);
      const release = value.collections?.releases[0];
      const assessment = release?.assessments[0];
      if (release === undefined || assessment === undefined) {
        throw new Error("Missing collection fixture");
      }
      if (condition === "stale") assessment.inventoryFreshness = "stale";
      if (condition === "incompatible") assessment.compatibility = "incompatible";
      if (condition === "not-executable") release.executable = false;
      if (condition === "no-missing") assessment.entries = [];
      if (condition === "reconciliation") value.mutation.phase = "reconciliation-required";
      if (condition === "ssh") value.target.kind = "ssh";
      render(<InventoryApp client={clientFor(value)} />);
      fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
      expect(screen.getByRole("button", {
        name: "Select missing skills on This device",
      })).toBeDisabled();
    },
  );

  it("routes an empty Official Collections page back to Inventory (#180)", async () => {
    render(
      <InventoryApp
        client={clientFor({
          ...collectionSnapshot,
          collections: {
            ...collectionSnapshot.collections!,
            releases: [],
          },
        })}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));

    const empty = (
      await screen.findByRole("heading", { name: "No Official Collections" })
    ).closest(".empty-state");
    expect(empty).toHaveTextContent(
      "Until then, add Skills one at a time from Inventory.",
    );
    fireEvent.click(
      within(empty as HTMLElement).getByRole("button", {
        name: "Open Inventory",
      }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Inventory" }),
    ).toBeInTheDocument();
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
    expect(screen.getByText(/SSH · Not available in V1/)).toBeInTheDocument();
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
        origin: "official",
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
    // The restore poll is scheduled by a passive effect on the phase flip,
    // so await it rather than racing the commit.
    await waitFor(() => expect(focusTimers.pendingCount()).toBe(1));
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
        {
          dimensions: {
            contentFingerprint: "matched" as const,
            declaredSource: "matched" as const,
            presence: "both" as const,
            revision: "matched" as const,
          },
          key: "Matched-Skill",
          left: {
            entries: snapshot.inventory.entries,
            freshness: "fresh" as const,
            harnessAvailability: "available" as const,
          },
          right: {
            entries: snapshot.inventory.entries,
            freshness: "stale" as const,
            harnessAvailability: "available" as const,
          },
          summary: "matched" as const,
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
    expect(
      screen.getByRole("cell", { name: "Matched-Skill" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 aligned skill keys")).toBeInTheDocument();
    const differencesOnly = screen.getByRole("checkbox", {
      name: "Differences only",
    });
    expect(differencesOnly).toHaveAccessibleDescription(
      "1 of 2 aligned skill keys would remain.",
    );
    fireEvent.click(differencesOnly);
    expect(differencesOnly).toHaveAccessibleDescription(
      "1 of 2 aligned skill keys remain.",
    );
    expect(
      screen.queryByRole("cell", { name: "Matched-Skill" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Case-Sensitive-Skill" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 2 aligned skill keys")).toBeInTheDocument();
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

  it("hands a comparison Prepare off to the destination Target inventory review", async () => {
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
        inventory: {
          ...snapshot.inventory,
          entries: [],
          freshness: "fresh" as const,
        },
        mutation: reviewableSnapshot.mutation,
        target: rightTarget,
      },
    ];
    const comparison = {
      id: "comparison-prepared",
      leftFreshness: "fresh" as const,
      leftTargetId: "00000000-0000-4000-8000-000000000001",
      rightFreshness: "fresh" as const,
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
            freshness: "fresh" as const,
            harnessAvailability: "absent" as const,
          },
          summary: "missing" as const,
        },
      ],
    };
    const prepareComparison = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-comparison-1" },
    }));
    const client = {
      ...clientFor({ ...snapshot, comparison, targets: targetStates }),
      prepareComparison,
    };
    render(<InventoryApp client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Case-Sensitive-Skill" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare for Right" }),
    );

    await waitFor(() =>
      expect(prepareComparison).toHaveBeenCalledWith(
        "comparison-prepared",
        "Case-Sensitive-Skill",
        "00000000-0000-4000-8000-00000000000a",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Comparison" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Trusted Review" }),
      ).toBeEnabled(),
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

    fireEvent.click(screen.getByRole("checkbox", { name: /Differences only/ }));
    expect(
      screen.getByRole("heading", { name: "No differences found" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("All 1 aligned skill key matches."),
    ).toHaveLength(2);
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
      screen.getByText("Use Add Skill below the table, or refresh this Target."),
    ).toBeInTheDocument();
    unmount();

    render(<InventoryApp client={clientFor(snapshot)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Comparison" }));
    expect(
      screen.getAllByText(
        "Add another Local Target under Targets, then return here to compare inventories.",
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("points an unfiltered empty Inventory at the in-app Add Skill form (#178)", async () => {
    render(
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

    const empty = (
      await screen.findByRole("heading", { name: "No skills found" })
    ).closest(".empty-state");
    expect(empty).not.toBeNull();
    expect(empty).toHaveTextContent(
      "Project and global inventory are empty. Add a Skill from a source below, or refresh this Target.",
    );
    expect(empty).toHaveTextContent("delegates installs to the pinned npx skills CLI");
    expect(
      within(empty as HTMLElement).queryByRole("button", { name: "Clear filters" }),
    ).toBeNull();

    const sourceInput = screen.getByLabelText("Source");
    const scrollIntoView = vi.fn();
    Object.assign(sourceInput, { scrollIntoView });
    fireEvent.click(
      within(empty as HTMLElement).getByRole("button", { name: "Add Skill" }),
    );
    expect(sourceInput).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
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
      await screen.findByText(/Host identity review · Not available in V1/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/open host identity review/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/host identity review is not available in V1/),
    ).toBeInTheDocument();
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

    expect(await screen.findAllByText("Not available")).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Build host/i }));

    expect(
      await screen.findByText(/Remote Targets keep a read-only trace/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("SSH not available")).toBeInTheDocument();
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
      "SSH · Not available in V1; changes cannot be prepared",
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
      name: /Build host · Not available/,
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

    const reason = "Refresh the inventory evidence first";
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

  it("places the skip link before the shell and targets the workspace main", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    const skipLink = await screen.findByRole("link", {
      name: "Skip to workspace",
    });
    expect(skipLink).toHaveAttribute("href", "#workspace-main");
    expect(
      skipLink.compareDocumentPosition(document.querySelector(".app-header")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.getElementById("workspace-main")).toHaveAttribute(
      "tabindex",
      "-1",
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

  it("renders the workspace in the main-resolved locale and applies the appearance token (#210)", async () => {
    render(
      <InventoryApp
        client={clientFor({
          ...snapshot,
          preferences: {
            appearance: "dark",
            locale: "zh-CN",
            localePreference: "system",
            systemLocale: "zh-CN",
          },
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "库存" }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dataset["appearance"]).toBe("dark");
    expect(
      screen.getByRole("link", { name: "跳到工作区" }),
    ).toBeInTheDocument();
    // Identifiers and evidence stay untranslated.
    expect(screen.getAllByText("Case-Sensitive-Skill")).not.toHaveLength(0);
    expect(screen.getAllByText("example/skills")).not.toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "刷新库存" }),
    ).toBeInTheDocument();
  });

  it("falls back to English and the system appearance when the Snapshot carries no preferences", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Inventory" }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dataset["appearance"]).toBe("system");
  });

  it("sends a typed preferences.update patch from the About page and never mutates the Snapshot locally (#210)", async () => {
    const updatePreferences = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "preferences" },
    }));
    const client: DesktopBridge = {
      ...clientFor({
        ...snapshot,
        preferences: {
          appearance: "system",
          locale: "en",
          localePreference: "system",
          systemLocale: "en",
        },
      }),
      updatePreferences,
    };
    render(<InventoryApp client={client} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });

    fireEvent.click(screen.getByRole("button", { name: "About" }));
    const language = await screen.findByLabelText("Language");
    fireEvent.change(language, { target: { value: "zh-CN" } });

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        localePreference: "zh-CN",
      }),
    );
    expect(await screen.findByText("Preferences saved")).toBeInTheDocument();
    // The renderer waits for the main-owned Snapshot; the heading stays English.
    expect(
      screen.getByRole("heading", { level: 1, name: "About" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Appearance"), {
      target: { value: "high-contrast" },
    });
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenLastCalledWith({
        appearance: "high-contrast",
      }),
    );
  });

  it("mirrors main-owned menu accelerators as aria-keyshortcuts and runs relayed menu commands through the same closed requests (#211)", async () => {
    const refreshInventory = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "refresh-menu" },
    }));
    const requestCheck = vi.fn(async () => ({
      error: {
        code: "invalid_request" as const,
        message: "The update request is not supported.",
        retryable: false,
      },
      ok: false as const,
    }));
    const menuHarness: MenuHarness = {
      listener: undefined,
      menu: buildApplicationMenu({ locale: "en", platform: "linux" }),
    };
    const client: DesktopBridge = {
      ...clientFor(snapshot, undefined, menuHarness),
      about: { ...aboutClient, requestCheck },
      refreshInventory,
    };
    render(<InventoryApp client={client} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh inventory" }),
      ).toHaveAttribute("aria-keyshortcuts", "Control+R"),
    );
    expect(screen.getByRole("button", { name: "About" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+8",
    );
    expect(screen.getByRole("button", { name: "Inventory" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+1",
    );
    expect(menuHarness.listener).toBeDefined();

    act(() => {
      menuHarness.listener?.({
        command: "inventory.refresh",
        schemaVersion: 1,
      });
    });
    expect(refreshInventory).toHaveBeenCalledWith(snapshot.target.id);

    act(() => {
      menuHarness.listener?.({ command: "navigate.targets", schemaVersion: 1 });
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Targets" }),
    ).toBeInTheDocument();
    expect(document.activeElement?.id).toBe("workspace-main");

    act(() => {
      menuHarness.listener?.({ command: "update.check", schemaVersion: 1 });
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "About" }),
    ).toBeInTheDocument();
    expect(requestCheck).toHaveBeenCalledTimes(1);
    expect(refreshInventory).toHaveBeenCalledTimes(1);
  });

  it("does not request a refresh from the menu while an observation is already running (#211)", async () => {
    const refreshInventory = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "refresh-menu" },
    }));
    const menuHarness: MenuHarness = { listener: undefined };
    const client: DesktopBridge = {
      ...clientFor(
        {
          ...snapshot,
          inventory: {
            ...snapshot.inventory,
            activeOperationId: "operation-1",
            phase: "loading",
          },
        },
        undefined,
        menuHarness,
      ),
      refreshInventory,
    };
    render(<InventoryApp client={client} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    await waitFor(() => expect(menuHarness.listener).toBeDefined());
    act(() => {
      menuHarness.listener?.({
        command: "inventory.refresh",
        schemaVersion: 1,
      });
    });
    expect(refreshInventory).not.toHaveBeenCalled();
    // Without a menu projection no control claims a shortcut it cannot prove.
    expect(screen.getByRole("button", { name: "About" })).not.toHaveAttribute(
      "aria-keyshortcuts",
    );
  });

  it("flushes a pending Studio Draft save when the view unmounts", async () => {
    const studioDraft = {
      createdAt: "2026-09-15T10:00:00.000Z",
      id: "draft-1",
      name: "demo-skill",
      revision: 3,
      skillMd: "---\nname: demo-skill\ndescription: Demo.\n---\n\n# Demo\n",
      updatedAt: "2026-09-15T10:05:00.000Z",
      validation: {
        description: "Demo.",
        fileCount: 1,
        findings: [],
        name: "demo-skill",
        ok: true,
        profileVersion: 1 as const,
        totalBytes: 40,
      },
    };
    const saveStudioDraft = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "studio-save" },
    }));
    const menuHarness: MenuHarness = { listener: undefined };
    const client: DesktopBridge = {
      ...clientFor(
        {
          ...snapshot,
          studio: {
            activeOperationId: null,
            available: true,
            draftFailures: [],
            drafts: [studioDraft],
            grants: [],
            lastError: null,
            lastExport: null,
            preview: null,
          },
        },
        undefined,
        menuHarness,
      ),
      saveStudioDraft,
    };
    render(<InventoryApp client={client} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    await waitFor(() => expect(menuHarness.listener).toBeDefined());

    act(() => {
      menuHarness.listener?.({ command: "navigate.studio", schemaVersion: 1 });
    });
    const edited = `${studioDraft.skillMd}\nEdited.\n`;
    fireEvent.change(await screen.findByTestId("studio-editor-textarea"), {
      target: { value: edited },
    });
    // Navigate away before the autosave debounce elapses.
    act(() => {
      menuHarness.listener?.({
        command: "navigate.inventory",
        schemaVersion: 1,
      });
    });
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    await waitFor(() =>
      expect(saveStudioDraft).toHaveBeenCalledWith("draft-1", 3, edited),
    );
  });

  it("resynchronizes after an out-of-order event and on resync.required", async () => {
    let listener: ((event: DesktopEvent) => void) | undefined;
    const getSnapshot = vi.fn(async () => ({
      ok: true as const,
      value: snapshot,
    }));
    const client: DesktopBridge = {
      ...clientFor(snapshot),
      getSnapshot,
      subscribe(next) {
        listener = next;
        return () => undefined;
      },
    };
    render(<InventoryApp client={client} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    expect(getSnapshot).toHaveBeenCalledTimes(1);

    // An event that skips a sequence cannot be applied incrementally.
    act(() => {
      listener?.({
        sequence: 9,
        sessionEpoch: "epoch-1",
        snapshot,
        stateRevision: 9,
        type: "snapshot.changed",
      });
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    // An explicit resync request also pulls a fresh snapshot.
    act(() => {
      listener?.({
        reason: "buffer_overflow",
        sequence: 10,
        sessionEpoch: "epoch-1",
        stateRevision: 10,
        type: "resync.required",
      });
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
  });

  it("keeps the current snapshot when a resync returns an older state revision", async () => {
    let listener: ((event: DesktopEvent) => void) | undefined;
    const getSnapshot = vi.fn(async () => ({
      ok: true as const,
      value: snapshot,
    }));
    const client: DesktopBridge = {
      ...clientFor(snapshot),
      getSnapshot,
      subscribe(next) {
        listener = next;
        return () => undefined;
      },
    };
    render(<InventoryApp client={client} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });

    // Move the rendered state forward with an in-order event.
    const advanced: WorkspaceSnapshot = {
      ...snapshot,
      eventSequence: 1,
      inventory: {
        ...snapshot.inventory,
        entries: [
          {
            agents: [],
            contentFingerprint: { status: "unknown" as const },
            declaredSource: { source: null, sourceType: null },
            name: "Persisted-Skill",
            revision: { status: "unknown" as const },
            scope: "project" as const,
          },
        ],
      },
      stateRevision: 5,
    };
    act(() => {
      listener?.({
        sequence: 1,
        sessionEpoch: "epoch-1",
        snapshot: advanced,
        stateRevision: 5,
        type: "snapshot.changed",
      });
    });
    await screen.findByRole("heading", { name: "Persisted-Skill" });

    // A skipped sequence resynchronizes, but the older fetched revision
    // must not roll the rendered state backwards.
    act(() => {
      listener?.({
        sequence: 9,
        sessionEpoch: "epoch-1",
        snapshot,
        stateRevision: 9,
        type: "snapshot.changed",
      });
    });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("heading", { name: "Persisted-Skill" }),
    ).toBeInTheDocument();
  });

  it("ignores subscription events and a late bootstrap result after unmount", async () => {
    let listener: ((event: DesktopEvent) => void) | undefined;
    let resolveSnapshot: ((value: unknown) => void) | undefined;
    const getSnapshot = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const client = {
      ...clientFor(snapshot),
      getSnapshot,
      subscribe(next: (event: DesktopEvent) => void) {
        listener = next;
        return () => undefined;
      },
    };
    const { unmount } = render(<InventoryApp client={client as never} />);
    unmount();
    resolveSnapshot?.({
      error: {
        code: "internal_error",
        effects: "none",
        message: "Arrived after unmount.",
        phase: "observation",
        retryable: false,
      },
      ok: false,
    });
    act(() => {
      listener?.({
        sequence: 1,
        sessionEpoch: "epoch-1",
        snapshot,
        stateRevision: 2,
        type: "snapshot.changed",
      });
    });
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("re-checks the focus restore guard when the window regains focus without an intent", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    act(() => {
      window.dispatchEvent(new FocusEvent("focus"));
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Inventory" }),
    ).toBeInTheDocument();
  });

  it("follows the remaining navigate.* menu commands to their views", async () => {
    const menuHarness: MenuHarness = { listener: undefined };
    render(
      <InventoryApp client={clientFor(snapshot, undefined, menuHarness)} />,
    );
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    const cases: ReadonlyArray<readonly [MenuCommandEvent["command"], string]> =
      [
        ["navigate.about", "About"],
        ["navigate.collections", "Official Collections"],
        ["navigate.comparison", "Comparison"],
        ["navigate.publish", "Publish"],
        ["navigate.recovery", "Recovery"],
        ["navigate.studio", "Studio"],
      ];
    for (const [command, heading] of cases) {
      act(() => {
        menuHarness.listener?.({ command, schemaVersion: 1 });
      });
      expect(
        await screen.findByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      act(() => {
        menuHarness.listener?.({
          command: "navigate.inventory",
          schemaVersion: 1,
        });
      });
      expect(
        await screen.findByRole("heading", { level: 1, name: "Inventory" }),
      ).toBeInTheDocument();
    }
  });

  it("retries opening the workspace after a bootstrap failure", async () => {
    const getSnapshot = vi.fn<DesktopBridge["getSnapshot"]>(async () => ({
      ok: true,
      value: snapshot,
    }));
    getSnapshot.mockResolvedValueOnce({
      error: {
        code: "internal_error" as const,
        effects: "none" as const,
        message: "The workspace could not be opened.",
        phase: "bootstrap",
        retryable: true,
      },
      ok: false,
    });
    render(
      <InventoryApp client={{ ...clientFor(snapshot), getSnapshot }} />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Retry opening inventory",
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("surfaces the persisted-state warning while the inventory stays usable", async () => {
    const warned: WorkspaceSnapshot = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        persistenceWarning: {
          code: "persist_failed",
          effects: "none",
          message: "The last inventory refresh could not be saved.",
          phase: "observation",
          retryable: false,
        },
      },
    };
    render(<InventoryApp client={clientFor(warned)} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    const banner = screen
      .getByText("The last inventory refresh could not be saved.")
      .closest("[role=status]");
    expect(banner).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Prepare update" }),
    ).toBeEnabled();
  });

  it("arms the trusted-review context after a successful prepare", async () => {
    const prepareMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-update" },
    }));
    render(
      <InventoryApp
        client={{ ...clientFor(reviewableSnapshot), prepareMutation }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare update" }),
    );
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenCalledWith(
        reviewableSnapshot.target.id,
        {
          names: ["Case-Sensitive-Skill"],
          scope: "project",
          type: "update",
        },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Trusted Review" }),
      ).toBeEnabled(),
    );
  });

  it("refuses to open review when the prepared target generation went stale", async () => {
    let listener: ((event: DesktopEvent) => void) | undefined;
    const requestReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "review-1" },
    }));
    const client: DesktopBridge = {
      ...clientFor(reviewableSnapshot),
      requestReview,
      subscribe(next) {
        listener = next;
        return () => undefined;
      },
    };
    render(<InventoryApp client={client} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare update" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Trusted Review" }),
      ).toBeEnabled(),
    );

    // The target moved forward after the plan was prepared.
    act(() => {
      listener?.({
        sequence: 1,
        sessionEpoch: "epoch-1",
        snapshot: {
          ...reviewableSnapshot,
          eventSequence: 1,
          stateRevision: 9,
          target: {
            ...reviewableSnapshot.target,
            generation: reviewableSnapshot.target.generation + 1,
          },
        },
        stateRevision: 9,
        type: "snapshot.changed",
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open Trusted Review" }),
    );
    await act(async () => undefined);
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("surfaces a skills.sh handoff failure and keeps the record actionable", async () => {
    const recordId = "e".repeat(64);
    const handoffSkillsSh = vi.fn(async () => ({
      error: {
        code: "internal_error" as const,
        effects: "none" as const,
        message: "The handoff could not be opened.",
        phase: "handoff",
        retryable: false,
      },
      ok: false as const,
    }));
    const withHandoff: WorkspaceSnapshot = {
      ...snapshot,
      skillsShHandoffs: [
        {
          id: recordId,
          kind: "skills-sh",
          owner: "example",
          repository: "skills",
          skill: "Case-Sensitive-Skill",
          sourceEntry: { name: "Case-Sensitive-Skill", scope: "project" },
        },
      ],
    };
    render(
      <InventoryApp client={{ ...clientFor(withHandoff), handoffSkillsSh }} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open on skills.sh" }),
    );
    await waitFor(() => expect(handoffSkillsSh).toHaveBeenCalledWith(recordId));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The handoff could not be opened.",
    );
    expect(
      screen.getByRole("button", { name: "Open on skills.sh" }),
    ).toBeEnabled();
    expect(
      screen.queryByText(/Opened in your browser/),
    ).not.toBeInTheDocument();
  });

  it("describes a repo-level skills.sh record without a skill suffix", async () => {
    const withHandoff: WorkspaceSnapshot = {
      ...snapshot,
      skillsShHandoffs: [
        {
          id: "f".repeat(64),
          kind: "skills-sh",
          owner: "example",
          repository: "skills",
          skill: null,
          sourceEntry: { name: "Case-Sensitive-Skill", scope: "project" },
        },
      ],
    };
    render(<InventoryApp client={clientFor(withHandoff)} />);
    await screen.findByRole("button", { name: "Open on skills.sh" });
    expect(
      screen.getByText(/Opens skills\.sh\/example\/skills\b(?!\/)/),
    ).toBeInTheDocument();
  });

  it("reconciles a blocked mutation and surfaces a reconcile failure", async () => {
    const reconcileMutation = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: "reconciliation_required" as const,
          effects: "none" as const,
          message: "The workspace still disagrees with the ledger.",
          phase: "reconcile",
          retryable: true,
        },
        ok: false,
      })
      .mockResolvedValue({
        ok: true,
        value: { operationId: "reconcile-1" },
      });
    const blocked: WorkspaceSnapshot = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        freshness: "stale",
        lastError: {
          code: "stale_inventory",
          effects: "none",
          message: "The stored inventory is older than the workspace.",
          phase: "observation",
          retryable: true,
        },
      },
      mutation: {
        ...snapshot.mutation,
        lastError: {
          code: "reconciliation_required",
          effects: "possible",
          message: "Reconciliation is required before further changes.",
          phase: "mutation",
          retryable: true,
        },
        phase: "reconciliation-required",
      },
    };
    render(
      <InventoryApp client={{ ...clientFor(blocked), reconcileMutation }} />,
    );
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    expect(
      screen.getByText("The stored inventory is older than the workspace."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reconciliation is required before further changes."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reconcile" }));
    await waitFor(() =>
      expect(reconcileMutation).toHaveBeenCalledWith(snapshot.target.id),
    );
    expect(
      await screen.findByText(
        "The workspace still disagrees with the ledger.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reconcile" }));
    await waitFor(() => expect(reconcileMutation).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByText(
          "The workspace still disagrees with the ledger.",
        ),
      ).not.toBeInTheDocument(),
    );
  });

  it("acknowledges a cancellation review request for a running mutation", async () => {
    const requestCancellationReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "cancel-review-1" },
    }));
    const running: WorkspaceSnapshot = {
      ...snapshot,
      mutation: {
        ...snapshot.mutation,
        activeOperationId: "operation-1",
        phase: "running",
      },
    };
    render(
      <InventoryApp
        client={{ ...clientFor(running), requestCancellationReview }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Review cancellation" }),
    );
    await waitFor(() =>
      expect(requestCancellationReview).toHaveBeenCalledWith("operation-1"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the running-mutation banner without a cancel control when no operation id is published", async () => {
    const running: WorkspaceSnapshot = {
      ...snapshot,
      mutation: {
        ...snapshot.mutation,
        activeOperationId: null,
        phase: "running",
      },
    };
    render(<InventoryApp client={clientFor(running)} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    expect(
      screen.queryByRole("button", { name: "Review cancellation" }),
    ).not.toBeInTheDocument();
  });

  it("surfaces the mutation failure banner outside reconciliation", async () => {
    const failed: WorkspaceSnapshot = {
      ...snapshot,
      mutation: {
        ...snapshot.mutation,
        lastError: {
          code: "process_failed",
          effects: "none",
          message: "The mutation process exited non-zero.",
          phase: "mutation",
          retryable: true,
        },
        phase: "failed",
      },
    };
    render(<InventoryApp client={clientFor(failed)} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    expect(
      screen.getByText("The mutation process exited non-zero."),
    ).toBeInTheDocument();
  });

  it("refreshes from the toolbar icon", async () => {
    const refreshInventory = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "refresh-1" },
    }));
    render(
      <InventoryApp client={{ ...clientFor(snapshot), refreshInventory }} />,
    );
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await waitFor(() =>
      expect(refreshInventory).toHaveBeenCalledWith(snapshot.target.id),
    );
  });

  it("refreshes from the blocked-mutation CTA while the inventory is stale", async () => {
    const refreshInventory = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "refresh-1" },
    }));
    const stale: WorkspaceSnapshot = {
      ...snapshot,
      inventory: { ...snapshot.inventory, freshness: "stale" },
    };
    render(
      <InventoryApp client={{ ...clientFor(stale), refreshInventory }} />,
    );
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    // The bootstrap observer already asked for a refresh once.
    await waitFor(() => expect(refreshInventory).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(refreshInventory).toHaveBeenCalledTimes(2));
    expect(refreshInventory).toHaveBeenLastCalledWith(snapshot.target.id);
  });

  it("clears a non-empty search query on Escape", async () => {
    render(<InventoryApp client={clientFor(snapshot)} />);
    const search = await screen.findByRole("searchbox", {
      name: "Search inventory",
    });
    fireEvent.keyDown(search, { key: "Escape" });
    fireEvent.change(search, { target: { value: "missing" } });
    await screen.findByRole("heading", { name: "No matching skills" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(
      await screen.findByRole("heading", { name: "Case-Sensitive-Skill" }),
    ).toBeInTheDocument();
  });

  it("flags an entry that is not linked to the target's harness", async () => {
    const unlinked: WorkspaceSnapshot = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        entries: [
          {
            agents: ["claude-code"],
            contentFingerprint: { status: "unknown" as const },
            declaredSource: { source: null, sourceType: null },
            name: "Claude-Only-Skill",
            revision: { status: "unknown" as const },
            scope: "project" as const,
          },
        ],
      },
    };
    render(<InventoryApp client={clientFor(unlinked)} />);
    await screen.findByRole("heading", { name: "Claude-Only-Skill" });
    expect(screen.getByText("Not linked")).toBeInTheDocument();
  });

  it("describes an entry without declared-source metadata as unknown", async () => {
    const unattributed: WorkspaceSnapshot = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        entries: [
          {
            agents: [],
            contentFingerprint: { status: "unknown" as const },
            declaredSource: { source: null, sourceType: null },
            name: "Case-Sensitive-Skill",
            revision: { status: "unknown" as const },
            scope: "project" as const,
          },
        ],
      },
    };
    render(<InventoryApp client={clientFor(unattributed)} />);
    await screen.findByRole("heading", { name: "Case-Sensitive-Skill" });
    expect(
      screen.getAllByText("Unknown").length,
    ).toBeGreaterThan(0);
  });

  it("shows the empty-inventory inspector guidance", async () => {
    const empty: WorkspaceSnapshot = {
      ...snapshot,
      inventory: { ...snapshot.inventory, entries: [] },
    };
    render(<InventoryApp client={clientFor(empty)} />);
    expect(
      await screen.findByRole("heading", { name: "No skills to inspect" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Skill" }));
    expect(
      screen.getByRole("textbox", { name: "Source" }),
    ).toHaveFocus();
  });

  it("prepares an update across the chosen scope", async () => {
    const prepareMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "prepared-all" },
    }));
    render(
      <InventoryApp
        client={{ ...clientFor(reviewableSnapshot), prepareMutation }}
      />,
    );
    const inventoryScope = await screen.findByRole("group", {
      name: "Inventory scope",
    });
    fireEvent.click(
      within(inventoryScope).getByRole("button", { name: "Global scope" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update scope" }));
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenCalledWith(
        reviewableSnapshot.target.id,
        { scope: "global", type: "update-all" },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Trusted Review" }),
      ).toBeEnabled(),
    );
  });

  it("surfaces an add-mutation preparation failure", async () => {
    const prepareMutation = vi.fn(async () => ({
      error: {
        code: "invalid_intent" as const,
        effects: "none" as const,
        message: "The add intent was rejected.",
        phase: "prepare",
        retryable: false,
      },
      ok: false as const,
    }));
    render(
      <InventoryApp client={{ ...clientFor(snapshot), prepareMutation }} />,
    );
    fireEvent.change(await screen.findByRole("textbox", { name: "Source" }), {
      target: { value: "example/skills" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Exact skill name" }),
      { target: { value: "brand-new-skill" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare add" }));
    await waitFor(() =>
      expect(prepareMutation).toHaveBeenCalledWith(
        snapshot.target.id,
        expect.objectContaining({
          names: ["brand-new-skill"],
          type: "add",
        }),
      ),
    );
    expect(
      await screen.findByText("The add intent was rejected."),
    ).toBeInTheDocument();
  });

  it("discards a bootstrap result that arrives after unmount", async () => {
    let resolveSnapshot: ((value: unknown) => void) | undefined;
    const getSnapshot = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const { unmount } = render(
      <InventoryApp
        client={{ ...clientFor(snapshot), getSnapshot: getSnapshot as never }}
      />,
    );
    unmount();
    await act(async () => {
      resolveSnapshot?.({ ok: true, value: snapshot });
    });
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("shows no-candidate guidance for an empty inspection", async () => {
    const inspected: WorkspaceSnapshot = {
      ...snapshot,
      sourceInspection: {
        activeOperationId: null,
        inspection: {
          candidates: [],
          descriptor: {
            family: "github" as const,
            locality: "portable" as const,
            mutability: "mutable" as const,
            ref: null,
            schemaVersion: 1 as const,
            source: "vercel-labs/skills",
          },
          digest: "a".repeat(64),
          inspectedAt: "2026-08-21T10:00:30.000Z",
          inspectionId: "inspection-empty",
          targetGeneration: snapshot.target.generation,
          targetId: snapshot.target.id,
        },
        lastError: null,
        phase: "ready",
      },
    };
    render(<InventoryApp client={clientFor(inspected)} />);
    await screen.findByRole("heading", { level: 1, name: "Inventory" });
    fireEvent.change(screen.getByRole("textbox", { name: "Source" }), {
      target: { value: "vercel-labs/skills" },
    });
    expect(
      await screen.findByText("The source lists no Skills to add."),
    ).toBeInTheDocument();
  });

  it("returns to inventory from an empty comparison", async () => {
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
        target: snapshot.target,
      },
      {
        deletionBlocked: false,
        inventory: { ...snapshot.inventory, freshness: "stale" as const },
        mutation: snapshot.mutation,
        target: rightTarget,
      },
    ];
    const comparison = {
      id: "comparison-empty",
      leftFreshness: "fresh" as const,
      leftTargetId: snapshot.target.id,
      rightFreshness: "stale" as const,
      rightTargetId: rightTarget.id,
      rows: [],
    };
    render(
      <InventoryApp
        client={clientFor({ ...snapshot, comparison, targets: targetStates })}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Comparison" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Comparison" }),
    ).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Inventory" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Inventory" }),
    ).toBeInTheDocument();
  });
});
