// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  WORKSPACE_PROTOCOL_VERSION,
  type PublicCollectionsState,
  type TargetDefinition,
  type WorkspaceBridge,
  type WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { CollectionsView } from "./CollectionsView.js";

afterEach(cleanup);

const localId = "00000000-0000-4000-8000-000000000001";

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

type Assessment = PublicCollectionsState["releases"][number]["assessments"][number];

function assessment(
  scope: Assessment["scope"],
  entries: Assessment["entries"],
): Assessment {
  return {
    compatibility: "compatible",
    entries,
    inventoryFreshness: "fresh",
    scope,
    targetGeneration: 1,
    targetId: localId,
  };
}

const digest = `sha256:${"ab".repeat(32)}`;

const collections: NonNullable<WorkspaceSnapshot["collections"]> = {
  acknowledgements: [],
  plan: null,
  releases: [
    {
      assessments: [
        assessment("project", [
          {
            inRelease: true,
            name: "code-review",
            selectable: true,
            selectionModes: ["add"],
            status: "missing",
          },
          {
            inRelease: true,
            name: "commit-helper",
            selectable: true,
            selectionModes: ["add"],
            status: "missing",
          },
          {
            inRelease: true,
            name: "docs-writer",
            selectable: true,
            selectionModes: ["reapply"],
            status: "unchanged",
          },
        ]),
        assessment("global", [
          {
            inRelease: true,
            name: "code-review",
            selectable: true,
            selectionModes: ["add"],
            status: "missing",
          },
          {
            inRelease: true,
            name: "global-helper",
            selectable: true,
            selectionModes: ["add"],
            status: "missing",
          },
        ]),
      ],
      blockers: [],
      collectionId: "official-starter",
      compatibility: {
        cliVersion: "1.5.23",
        harnesses: ["codex"],
        platforms: ["darwin"],
        requiredCapabilities: ["local"],
      },
      description: "Starter set for tests.",
      executable: true,
      manifestDigest: digest,
      receipt: {
        author: "reviewer",
        manifestDigest: digest,
        reviewLocation: null,
        reviewPolicy: "official-collection-v1",
        reviewedAt: null,
        reviewer: "reviewer",
        schemaVersion: 1,
        status: "approved",
      },
      releaseNumber: 1,
      skills: ["code-review", "commit-helper", "docs-writer"],
      source: {
        repository: "example/starter",
        repositoryUrl: "https://example.com/example/starter",
        reviewedRevision: "a".repeat(40),
        sourceType: "github",
      },
      status: "active",
      supersedesDigest: null,
      title: "Starter",
    },
  ],
};

function snapshot(): WorkspaceSnapshot {
  return {
    collections,
    eventSequence: 1,
    inventory,
    mutation,
    schemaVersion: WORKSPACE_PROTOCOL_VERSION,
    sessionEpoch: "test-epoch",
    stateRevision: 1,
    target: localTarget,
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

function skillCheckboxes() {
  return screen.getAllByRole("checkbox", { name: /^Select / });
}

describe("CollectionsView skill filter", () => {
  it("filters rows by skill name and clears with refocus", () => {
    render(<CollectionsView client={bridge()} snapshot={snapshot()} />);
    const filter = screen.getByRole("searchbox", { name: "Filter skills" });
    expect(filter).toHaveAttribute("aria-keyshortcuts", "/");
    expect(filter).toHaveAttribute("title", "Press / to focus skill filter");
    expect(screen.getByRole("status")).toHaveTextContent("3 of 3 skills");
    expect(skillCheckboxes()).toHaveLength(3);

    fireEvent.change(filter, { target: { value: "code" } });
    expect(filter).toHaveValue("code");
    expect(skillCheckboxes()).toHaveLength(1);
    expect(
      screen.getByRole("checkbox", { name: "Select code-review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3 skills");

    fireEvent.keyDown(filter, { key: "Escape" });
    expect(filter).toHaveValue("");
    expect(filter).toHaveFocus();
    expect(skillCheckboxes()).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("3 of 3 skills");
  });

  it("offers a one-click reset when no skill matches", () => {
    render(<CollectionsView client={bridge()} snapshot={snapshot()} />);
    const filter = screen.getByRole("searchbox", { name: "Filter skills" });
    fireEvent.change(filter, { target: { value: "zzz" } });

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No matching skills" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 of 3 skills");

    fireEvent.click(screen.getByText("Clear skill filter"));
    expect(filter).toHaveValue("");
    expect(filter).toHaveFocus();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(skillCheckboxes()).toHaveLength(3);
  });

  it("keeps selections for skills hidden by the filter", async () => {
    const client = bridge();
    render(<CollectionsView client={client} snapshot={snapshot()} />);
    const select = screen.getByRole("checkbox", { name: "Select code-review" });
    await act(async () => {
      fireEvent.click(select);
    });
    expect(select).toBeChecked();

    const filter = screen.getByRole("searchbox", { name: "Filter skills" });
    fireEvent.change(filter, { target: { value: "docs" } });
    expect(
      screen.queryByRole("checkbox", { name: "Select code-review" }),
    ).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "" } });
    expect(
      screen.getByRole("checkbox", { name: "Select code-review" }),
    ).toBeChecked();
  });

  it("focuses the filter with / outside editable contexts", () => {
    render(
      <>
        <button type="button">Sidebar action</button>
        <CollectionsView client={bridge()} snapshot={snapshot()} />
      </>,
    );
    const filter = screen.getByRole("searchbox", { name: "Filter skills" });
    const sidebar = screen.getByRole("button", { name: "Sidebar action" });

    sidebar.focus();
    expect(fireEvent.keyDown(sidebar, { key: "/" })).toBe(false);
    expect(filter).toHaveFocus();

    filter.blur();
    expect(document.activeElement).toBe(document.body);
    expect(fireEvent.keyDown(document.body, { key: "/" })).toBe(false);
    expect(filter).toHaveFocus();
  });

  it("leaves editing contexts and modified shortcuts untouched", () => {
    render(
      <>
        <input aria-label="Editor input" />
        <CollectionsView client={bridge()} snapshot={snapshot()} />
      </>,
    );
    const filter = screen.getByRole("searchbox", { name: "Filter skills" });
    const editor = screen.getByRole("textbox", { name: "Editor input" });

    editor.focus();
    expect(fireEvent.keyDown(editor, { key: "/" })).toBe(true);
    expect(editor).toHaveFocus();
    expect(filter).not.toHaveFocus();

    const scope = screen.getByRole("combobox", { name: "Scope" });
    scope.focus();
    expect(fireEvent.keyDown(scope, { key: "/", ctrlKey: true })).toBe(true);
    expect(filter).not.toHaveFocus();
  });
});
