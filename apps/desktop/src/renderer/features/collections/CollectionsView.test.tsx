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
  PublicCollectionsState,
  PublicImportedPackage,
  RendererError,
  TargetDefinition,
  WorkspaceBridge,
  WorkspaceSnapshot,
} from "../../../contracts/workspace.js";
import { CollectionsView } from "./CollectionsView.js";

afterEach(cleanup);

const leftId = "00000000-0000-4000-8000-000000000001";
const sshId = "00000000-0000-4000-8000-000000000018";
const sha = (hex: string) => `sha256:${hex}` as const;
const shaA = sha("a".repeat(64));
const shaB = sha("b".repeat(64));
const shaC = sha("c".repeat(64));
const shaD = sha("d".repeat(64));
const shaE = sha("e".repeat(64));

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

const targetMetadata = {
  dialectId: "skills-1.5.23" as const,
  executionBindingDigest: null,
  harnessIds: ["codex"],
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de" as const,
  registryVersion: 1 as const,
};

const localTarget: TargetDefinition = {
  connectionReference: null,
  ...targetMetadata,
  generation: 1,
  id: leftId,
  kind: "local",
  label: "This device",
  workspace: "/work/left",
  workspaceLabel: "left",
};

const sshTarget: TargetDefinition = {
  connectionReference: "build-host",
  ...targetMetadata,
  generation: 1,
  id: sshId,
  kind: "ssh",
  label: "Build host",
  workspace: "/srv/workspace",
  workspaceLabel: "ssh",
};

type Assessment = NonNullable<
  PublicCollectionsState["releases"][number]["assessments"]
>[number];
type AssessmentEntry = Assessment["entries"][number];

const entry = (
  name: string,
  status: AssessmentEntry["status"],
  selectionModes: AssessmentEntry["selectionModes"] = [],
  selectable = selectionModes.length > 0,
): AssessmentEntry => ({
  inRelease: true,
  name,
  selectable,
  selectionModes,
  status,
});

const assessmentFor = (
  targetId: string,
  scope: "global" | "project",
  overrides: Partial<Assessment> = {},
): Assessment => ({
  compatibility: "compatible",
  entries: [
    entry("find-skills", "missing", ["add"]),
    entry("code-review", "unchanged", ["reapply"]),
    entry("readme-only", "incompatible"),
  ],
  inventoryFreshness: "fresh",
  scope,
  targetGeneration: 1,
  targetId,
  ...overrides,
});

const receipt = {
  author: "Reviewer",
  manifestDigest: shaA,
  reviewLocation: "https://example.test/review/1",
  reviewPolicy: "official-collection-v1" as const,
  reviewedAt: "2026-08-01T00:00:00Z",
  reviewer: "reviewer",
  schemaVersion: 1 as const,
  status: "approved" as const,
};

const compatibility = {
  cliVersion: "1.5.23" as const,
  harnesses: ["codex"],
  platforms: ["darwin", "linux", "win32"] as ("darwin" | "linux" | "win32")[],
  requiredCapabilities: ["local"] as ("local" | "ssh")[],
};

const release: PublicCollectionsState["releases"][number] = {
  assessments: [assessmentFor(leftId, "project"), assessmentFor(leftId, "global")],
  blockers: [],
  collectionId: "starter-kit",
  compatibility,
  description: "A reviewed starter collection.",
  executable: true,
  manifestDigest: shaA,
  receipt,
  releaseNumber: 3,
  skills: ["find-skills", "code-review"],
  source: {
    repository: "acme/skills",
    repositoryUrl: "https://github.com/acme/skills",
    reviewedRevision: "a".repeat(40),
    sourceType: "github",
  },
  status: "active",
  supersedesDigest: null,
  title: "Starter Kit",
};

const importedPackage: PublicImportedPackage = {
  assessments: [
    assessmentFor(leftId, "project", { compatibility: "incompatible" }),
    assessmentFor(leftId, "global", { compatibility: "incompatible" }),
  ],
  blockers: [],
  compatibility: { dialectId: "skills-1.5.23", harnessIds: ["codex"] },
  conflicts: [{ documentDigest: shaC, recordedAt: "2026-08-02T00:00:00Z", release: 2 }],
  delta: {
    fromRelease: 1,
    kind: "upgrade",
    recordedAt: "2026-08-02T00:00:00Z",
    toRelease: 2,
  },
  description: "An imported package document.",
  documentDigest: shaD,
  executable: true,
  importedAt: "2026-08-02T10:00:00Z",
  origin: "imported",
  packageId: "vendor-pack",
  release: 2,
  skills: ["vendor-skill"],
  source: { repository: "vendor/pack", revision: null, sourceType: "github" },
  title: "Vendor Pack",
};

function collections(
  overrides: Partial<PublicCollectionsState> = {},
): PublicCollectionsState {
  return {
    acknowledgements: [],
    plan: null,
    releases: [release],
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
    importPackage: ok,
    choosePublicationSource: ok,
    exportPublication: ok,
    preparePublication: ok,
    requestPublicationReview: ok,
    discardPublication: ok,
    reconcilePublication: ok,
    openStudioFolder: ok,
    releaseStudioGrant: ok,
    validateStudioGrant: ok,
    createStudioDraft: ok,
    saveStudioDraft: ok,
    deleteStudioDraft: ok,
    previewStudioDraft: ok,
    exportStudioDraft: ok,
    inspectSource: ok,
    updatePreferences: ok,
    async getSnapshot() {
      throw new Error("not used");
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

function snapshot(
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  const collectionsState = overrides.collections ?? collections();
  return {
    collections: collectionsState,
    eventSequence: 0,
    inventory,
    mutation: idleMutation,
    schemaVersion: 2,
    sessionEpoch: "epoch-1",
    stateRevision: 1,
    target: localTarget,
    targets: [
      {
        collections: collectionsState,
        deletionBlocked: false,
        inventory,
        mutation: idleMutation,
        target: localTarget,
      },
    ],
    ...overrides,
  };
}

describe("CollectionsView", () => {
  it("renders the empty state and drives import plus inventory navigation", async () => {
    const importPackage = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op" },
    }));
    const onOpenInventory = vi.fn();
    render(
      <CollectionsView
        client={bridge({ importPackage })}
        onOpenInventory={onOpenInventory}
        snapshot={snapshot({ collections: undefined })}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "No Official Collections" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Inventory" }),
    );
    expect(onOpenInventory).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("collections-import"));
    await waitFor(() => expect(importPackage).toHaveBeenCalledTimes(1));
  });

  it("lists recipes, switches the inspector on selection, and shows per-origin evidence", async () => {
    render(
      <CollectionsView
        client={bridge()}
        snapshot={snapshot({
          collections: collections({ packages: [importedPackage] }),
        })}
      />,
    );
    // Official origin evidence is visible for the default selection.
    expect(screen.getByText("Starter Kit")).toBeInTheDocument();
    expect(screen.getByTestId("collection-origin")).toHaveTextContent(
      "Official Collection",
    );
    expect(screen.getByText("acme/skills")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Release" }), {
      target: { value: `imported:vendor-pack:2:${shaD}` },
    });
    await waitFor(() =>
      expect(screen.getByTestId("collection-origin")).toHaveTextContent(
        "Imported Package",
      ),
    );
    expect(
      screen.getByText("None — not an Official Collection"),
    ).toBeInTheDocument();
    expect(screen.getByText("unpinned")).toBeInTheDocument();
    expect(screen.getByTestId("collection-delta")).toHaveTextContent(
      "Upgraded from release 1 to 2",
    );
    expect(screen.getByTestId("collection-conflicts")).toHaveTextContent(
      shaC.slice(0, 20),
    );
  });

  it("selects missing skills and prepares a plan with exact selections", async () => {
    const prepareCollectionAcrossTargets = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-prep" },
    }));
    render(
      <CollectionsView
        client={bridge({ prepareCollectionAcrossTargets })}
        snapshot={snapshot()}
      />,
    );
    const selectMissing = screen.getByRole("button", {
      name: "Select missing skills on This device",
    });
    const prepareButton = screen.getByRole("button", {
      name: /Prepare plan/,
    });
    expect(prepareButton).toBeDisabled();

    fireEvent.click(selectMissing);
    expect(prepareButton).toBeEnabled();
    fireEvent.click(prepareButton);

    await waitFor(() =>
      expect(prepareCollectionAcrossTargets).toHaveBeenCalledWith({
        collectionId: "starter-kit",
        manifestDigest: shaA,
        origin: "official",
        releaseNumber: 3,
        targets: [
          {
            scope: "project",
            selections: [{ mode: "add", name: "find-skills" }],
            targetId: leftId,
          },
        ],
      }),
    );
  });

  it("shows blockers and keeps controls disabled on an incompatible assessment", () => {
    render(
      <CollectionsView
        client={bridge()}
        snapshot={snapshot({
          collections: collections({
            releases: [
              {
                ...release,
                assessments: [
                  assessmentFor(leftId, "project", {
                    compatibility: "incompatible",
                    inventoryFreshness: "stale",
                  }),
                  assessmentFor(leftId, "global", {
                    compatibility: "incompatible",
                    inventoryFreshness: "stale",
                  }),
                ],
              },
            ],
          }),
        })}
      />,
    );
    expect(
      screen.getByText("Release is incompatible with this Target."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fresh inventory evidence is required."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Prepare plan/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Select missing skills on This device",
      }),
    ).toBeDisabled();
  });

  it("excludes SSH targets from selection in V1", () => {
    render(
      <CollectionsView
        client={bridge()}
        snapshot={snapshot({
          targets: [
            {
              collections: collections(),
              deletionBlocked: false,
              inventory,
              mutation: idleMutation,
              target: localTarget,
            },
            {
              collections: collections(),
              deletionBlocked: false,
              inventory,
              mutation: idleMutation,
              target: sshTarget,
            },
          ],
        })}
      />,
    );
    const sshToggle = screen.getByRole("checkbox", {
      name: "Include Build host",
    });
    expect(sshToggle).toBeDisabled();
    expect(sshToggle).not.toBeChecked();
    expect(sshToggle).toHaveAttribute(
      "title",
      "SSH · Not available in V1; outside the scope of V1 Local Collections",
    );
    // Only the local target counts toward the selection set.
    expect(screen.getByText("Targets selected")).toBeInTheDocument();
  });

  it("surfaces a returned error when preparing fails", async () => {
    const failure: RendererError = {
      code: "target_unavailable",
      effects: "none",
      message: "The Target went away.",
      phase: "mutation",
      retryable: true,
    };
    const prepareCollectionAcrossTargets = vi.fn(async () => ({
      error: failure,
      ok: false as const,
    }));
    render(
      <CollectionsView
        client={bridge({ prepareCollectionAcrossTargets })}
        snapshot={snapshot()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Select missing skills on This device",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Prepare plan/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The Target went away.",
      ),
    );
  });

  it("renders an existing plan, focuses its heading, and requests review", async () => {
    const requestCollectionReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-review" },
    }));
    render(
      <CollectionsView
        client={bridge({ requestCollectionReview })}
        snapshot={snapshot({
          collections: collections({
            plan: {
              assessmentDigest: shaB,
              childCommandPlan: {
                harness: "codex",
                names: ["find-skills"],
                operation: "add",
                preview: "skills add acme/skills --skill find-skills",
                schemaVersion: 1,
                scope: "project",
                source: {
                  source: "acme/skills",
                  sourceType: "github",
                },
                targetId: leftId,
                timeoutMs: 120_000,
              },
              childPreparedDigest: shaC,
              collectionId: "starter-kit",
              expiresAt: "2026-08-22T10:05:00Z",
              id: "plan-1",
              inventoryDigest: shaD,
              manifestDigest: shaA,
              order: [
                {
                  names: ["find-skills"],
                  position: 1,
                  targetId: leftId,
                },
              ],
              releaseEvidence: {
                compatibility,
                receipt,
                status: "active",
              },
              releaseNumber: 3,
              reviewDigest: shaE,
              schemaVersion: 1,
              scope: "project",
              selections: [{ mode: "add", name: "find-skills" }],
              source: {
                repository: "acme/skills",
                reviewedRevision: "a".repeat(40),
              },
              targetGeneration: 1,
              targetId: leftId,
            },
          }),
        })}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Collection Plan" }),
      ).toHaveFocus(),
    );
    expect(screen.getByText("1. find-skills / project")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Open Trusted Review/ }),
    );
    await waitFor(() =>
      expect(requestCollectionReview).toHaveBeenCalledWith("plan-1"),
    );
  });

  it("surfaces a returned error when the package import fails", async () => {
    const failure: RendererError = {
      code: "skillpack_invalid",
      effects: "none",
      message: "The package document could not be read.",
      phase: "import",
      retryable: false,
    };
    const importPackage = vi.fn(async () => ({
      error: failure,
      ok: false as const,
    }));
    render(
      <CollectionsView
        client={bridge({ importPackage })}
        snapshot={snapshot()}
      />,
    );
    fireEvent.click(screen.getByTestId("collections-import"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The package document could not be read.",
      ),
    );
    expect(importPackage).toHaveBeenCalledTimes(1);
  });

  it("renders the import outcome banner from collections.lastImport", () => {
    render(
      <CollectionsView
        client={bridge()}
        snapshot={snapshot({
          collections: collections({
            lastImport: {
              documentDigest: shaD,
              fileName: "vendor-pack.skillpack",
              packageId: "vendor-pack",
              recordedAt: "2026-08-02T10:00:00Z",
              release: 2,
              relatedRelease: null,
              status: "conflict",
            },
          }),
        })}
      />,
    );
    const banner = screen.getByTestId("collections-import-outcome");
    expect(banner).toHaveTextContent("vendor-pack");
    expect(banner).toHaveTextContent("vendor-pack.skillpack");
  });

  it("exposes reconcile and refresh controls on a stopped execution", async () => {
    const reconcileMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-rec" },
    }));
    const refreshInventory = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-ref" },
    }));
    const childFailure: RendererError = {
      code: "process_failed",
      effects: "possible",
      message: "The skills CLI exited non-zero.",
      phase: "mutation",
      retryable: true,
    };
    render(
      <CollectionsView
        client={bridge({ reconcileMutation, refreshInventory })}
        snapshot={snapshot({
          collections: collections({
            execution: {
              children: [
                {
                  error: null,
                  outcome: null,
                  position: 1,
                  scope: "project",
                  skills: [
                    {
                      effects: "possible",
                      mode: "add",
                      name: "find-skills",
                      status: "stopped",
                    },
                  ],
                  status: "reconciliation-required",
                  target: localTarget,
                },
                {
                  error: childFailure,
                  outcome: null,
                  position: 2,
                  scope: "project",
                  skills: [
                    {
                      effects: "not-observed",
                      mode: "add",
                      name: "vendor-skill",
                      status: "failed",
                    },
                  ],
                  status: "failed",
                  target: sshTarget,
                },
              ],
              collectionId: "starter-kit",
              id: "run-2",
              manifestDigest: shaA,
              phase: "stopped",
              reviewDigest: shaE,
              semantics: "non-transactional",
            },
          }),
        })}
      />,
    );
    expect(
      screen.getByText("Collection run stopped"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The skills CLI exited non-zero."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Reconcile This device" }),
    );
    await waitFor(() =>
      expect(reconcileMutation).toHaveBeenCalledWith(leftId),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh Build host" }),
    );
    await waitFor(() =>
      expect(refreshInventory).toHaveBeenCalledWith(sshId),
    );
  });

  it("locks selection controls while an execution is running", () => {
    render(
      <CollectionsView
        client={bridge()}
        snapshot={snapshot({
          collections: collections({
            execution: {
              children: [
                {
                  error: null,
                  outcome: null,
                  position: 1,
                  scope: "project",
                  skills: [
                    {
                      effects: null,
                      mode: "add",
                      name: "find-skills",
                      status: "running",
                    },
                  ],
                  status: "running",
                  target: localTarget,
                },
              ],
              collectionId: "starter-kit",
              id: "run-1",
              manifestDigest: shaA,
              phase: "running",
              reviewDigest: shaE,
              semantics: "non-transactional",
            },
          }),
        })}
      />,
    );
    expect(
      screen.getByText("Collection run in progress"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Select missing skills on This device",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Release" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Select find-skills" }),
    ).toBeDisabled();
  });
});
