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
  PublicPublicationState,
  WorkspaceBridge,
} from "../../../contracts/workspace.js";
import { PublishView } from "./PublishView.js";

afterEach(cleanup);

const CANDIDATE = "c".repeat(40);
const BASE = "a".repeat(40);
const DIGEST = `sha256:${"d".repeat(64)}` as const;

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

function state(
  overrides: Partial<PublicPublicationState> = {},
): PublicPublicationState {
  return {
    activeOperationId: null,
    available: true,
    export: null,
    guard: null,
    lastError: null,
    lastOutcome: null,
    phase: "idle",
    plan: null,
    source: null,
    ...overrides,
  };
}

const source: NonNullable<PublicPublicationState["source"]> = {
  chosenAt: "2026-09-15T10:00:00.000Z",
  exporterVersion: 1,
  fileCount: 3,
  grantId: "grant-1",
  label: "My Skills",
  skills: ["hello", "world"],
  treeDigest: DIGEST,
};

const plan: NonNullable<PublicPublicationState["plan"]> = {
  base: { commit: BASE, kind: "commit" },
  branch: "main",
  candidateCommit: CANDIDATE,
  createdAt: "2026-09-15T10:01:00.000Z",
  expiresAt: "2026-09-15T10:11:00.000Z",
  exporterVersion: 1,
  files: [{ digest: DIGEST, path: ".well-known/agent-skills/index.json" }],
  id: "plan-1",
  planDigest: DIGEST,
  ref: "refs/heads/main",
  remote: {
    host: "github.com",
    kind: "https",
    url: "https://github.com/acme/skills.git",
  },
  schemaVersion: 1,
  skills: ["hello", "world"],
  treeDigest: DIGEST,
};

describe("PublishView (ADR 0019 / ADR 0020)", () => {
  it("explains unavailability without offering any action", () => {
    render(<PublishView client={bridge()} publication={undefined} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Publish" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Publication is unavailable in this session."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("chooses a source through main and shows only main-derived facts", async () => {
    const choosePublicationSource = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-1" },
    }));
    render(
      <PublishView
        client={bridge({ choosePublicationSource })}
        publication={state()}
      />,
    );
    expect(screen.getByText("No folder chosen yet.")).toBeInTheDocument();
    expect(screen.getByTestId("publish-export")).toBeDisabled();
    expect(screen.getByTestId("publish-plan")).toBeDisabled();
    fireEvent.click(screen.getByTestId("publish-choose-source"));
    await waitFor(() => expect(choosePublicationSource).toHaveBeenCalledOnce());
    expect(choosePublicationSource).toHaveBeenCalledWith();

    cleanup();
    render(<PublishView client={bridge()} publication={state({ source })} />);
    const facts = screen.getByTestId("publish-source");
    expect(facts).toHaveTextContent("hello, world");
    expect(facts).toHaveTextContent("My Skills");
    expect(facts).toHaveTextContent("3 files");
    expect(facts).toHaveTextContent(DIGEST);
    expect(screen.getByTestId("publish-export")).toBeEnabled();
  });

  it("exports the chosen source through the bridge", async () => {
    const exportPublication = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-9" },
    }));
    render(
      <PublishView
        client={bridge({ exportPublication })}
        publication={state({ source })}
      />,
    );
    fireEvent.click(screen.getByTestId("publish-export"));
    await waitFor(() => expect(exportPublication).toHaveBeenCalledOnce());
    expect(exportPublication).toHaveBeenCalledWith();
  });

  it("shows the exporting phase and honours the busy state", () => {
    render(
      <PublishView
        client={bridge()}
        publication={state({
          activeOperationId: "op-5",
          phase: "exporting",
          source,
        })}
      />,
    );
    const exportButton = screen.getByTestId("publish-export");
    expect(exportButton).toBeDisabled();
    expect(exportButton).toHaveTextContent("Exporting");
  });

  it("summarises a prepared plan and forwards review and discard", async () => {
    const requestPublicationReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-6" },
    }));
    const discardPublication = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-7" },
    }));
    render(
      <PublishView
        client={bridge({ discardPublication, requestPublicationReview })}
        publication={state({ plan, source })}
      />,
    );
    const summary = screen.getByTestId("publish-plan-summary");
    expect(summary).toHaveTextContent("Plan ready for review");
    expect(summary).toHaveTextContent("Plan expires at");
    expect(summary).toHaveTextContent("https://github.com/acme/skills.git");
    expect(summary).toHaveTextContent("main");
    expect(summary).toHaveTextContent(CANDIDATE.slice(0, 12));
    expect(summary).toHaveTextContent(DIGEST);
    expect(screen.queryByTestId("publish-plan")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("publish-review"));
    await waitFor(() =>
      expect(requestPublicationReview).toHaveBeenCalledWith("plan-1"),
    );
    fireEvent.click(screen.getByTestId("publish-discard"));
    await waitFor(() =>
      expect(discardPublication).toHaveBeenCalledWith("plan-1"),
    );
  });

  it("renders an unborn base and the pushing phase", () => {
    render(
      <PublishView
        client={bridge()}
        publication={state({
          phase: "pushing",
          plan: { ...plan, base: { kind: "unborn" } },
          source,
        })}
      />,
    );
    const summary = screen.getByTestId("publish-plan-summary");
    expect(summary).toHaveTextContent("Pushing");
    expect(summary).toHaveTextContent("Unborn branch (will be created)");
    expect(summary).not.toHaveTextContent(BASE.slice(0, 12));
  });

  it("re-enables controls once a failed source pick clears the operation", async () => {
    const choosePublicationSource = vi.fn(async () => ({
      error: {
        code: "internal_error" as const,
        effects: "none" as const,
        message: "The publication step could not be completed.",
        phase: "choosing",
        retryable: true,
      },
      ok: false as const,
    }));
    const { rerender } = render(
      <PublishView
        client={bridge({ choosePublicationSource })}
        publication={state({
          activeOperationId: "op-1",
          phase: "choosing",
        })}
      />,
    );
    expect(screen.getByTestId("publish-choose-source")).toBeDisabled();

    rerender(
      <PublishView
        client={bridge({ choosePublicationSource })}
        publication={state({
          lastError: {
            code: "internal_error",
            effects: "none",
            message: "The publication step could not be completed.",
            phase: "choosing",
            retryable: true,
          },
        })}
      />,
    );
    const choose = screen.getByTestId("publish-choose-source");
    expect(choose).toBeEnabled();
    fireEvent.click(choose);
    await waitFor(() => expect(choosePublicationSource).toHaveBeenCalledOnce());
    expect(screen.getByRole("alert")).toHaveTextContent("Internal error");
  });

  it("forwards exactly the remote text and branch name to main", async () => {
    const preparePublication = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-2" },
    }));
    render(
      <PublishView
        client={bridge({ preparePublication })}
        publication={state({ source })}
      />,
    );
    fireEvent.change(screen.getByTestId("publish-remote"), {
      target: { value: "  https://github.com/acme/skills.git " },
    });
    fireEvent.change(screen.getByTestId("publish-branch"), {
      target: { value: "release" },
    });
    fireEvent.click(screen.getByTestId("publish-plan"));
    await waitFor(() => expect(preparePublication).toHaveBeenCalledOnce());
    expect(preparePublication).toHaveBeenCalledWith(
      "https://github.com/acme/skills.git",
      "release",
    );
  });

  it("surfaces a main-side sanitizer error with user-facing copy", async () => {
    render(
      <PublishView
        client={bridge()}
        publication={state({
          lastError: {
            code: "remote_unsupported",
            effects: "none",
            message: "raw main message",
            phase: "sanitize",
            retryable: false,
          },
          source,
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The remote is not supported.",
    );
  });

  it("shows the sealed plan and routes approval to the Trusted Review", async () => {
    const requestPublicationReview = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "review-1" },
    }));
    const discardPublication = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-3" },
    }));
    render(
      <PublishView
        client={bridge({ discardPublication, requestPublicationReview })}
        publication={state({ phase: "planned", plan, source })}
      />,
    );
    const summary = screen.getByTestId("publish-plan-summary");
    expect(summary).toHaveTextContent("https://github.com/acme/skills.git");
    expect(summary).toHaveTextContent(CANDIDATE.slice(0, 12));
    expect(summary).toHaveTextContent(DIGEST);
    expect(screen.queryByTestId("publish-remote")).not.toBeInTheDocument();
    // No push control exists in the workspace; only the review can approve.
    expect(
      screen.queryByRole("button", { name: /push/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("publish-review"));
    await waitFor(() =>
      expect(requestPublicationReview).toHaveBeenCalledWith("plan-1"),
    );
    fireEvent.click(screen.getByTestId("publish-discard"));
    await waitFor(() =>
      expect(discardPublication).toHaveBeenCalledWith("plan-1"),
    );
  });

  it("blocks planning while a Guard is retained and offers readback only", async () => {
    const reconcilePublication = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-4" },
    }));
    render(
      <PublishView
        client={bridge({ reconcilePublication })}
        publication={state({
          guard: {
            committedAt: "2026-09-15T10:02:00.000Z",
            lastReadback: "uncertain",
            lastReadbackAt: "2026-09-15T10:02:30.000Z",
            phase: "uncertain",
            plan,
          },
          lastOutcome: {
            branch: "main",
            candidateCommit: CANDIDATE,
            planId: "plan-1",
            recordedAt: "2026-09-15T10:02:30.000Z",
            remote: plan.remote,
            status: "uncertain",
          },
          source,
        })}
      />,
    );
    const guard = screen.getByTestId("publish-guard");
    expect(guard).toHaveTextContent("Publication needs reconciliation");
    expect(guard).toHaveTextContent(CANDIDATE);
    expect(screen.getByTestId("publish-plan")).toBeDisabled();
    expect(screen.getByTestId("publish-outcome-status")).toHaveTextContent(
      "Uncertain",
    );
    expect(screen.getByTestId("publish-outcome")).toHaveTextContent(
      "Remote branch could not be read",
    );
    fireEvent.click(screen.getByRole("button", { name: "Read remote back" }));
    await waitFor(() => expect(reconcilePublication).toHaveBeenCalledOnce());
  });

  it("records a published outcome with the observed remote commit", () => {
    render(
      <PublishView
        client={bridge()}
        publication={state({
          lastOutcome: {
            branch: "main",
            candidateCommit: CANDIDATE,
            observedCommit: CANDIDATE,
            planId: "plan-1",
            recordedAt: "2026-09-15T10:03:00.000Z",
            remote: plan.remote,
            status: "published",
          },
          source,
        })}
      />,
    );
    expect(screen.getByTestId("publish-outcome-status")).toHaveTextContent(
      "Published",
    );
    expect(screen.getByTestId("publish-outcome")).toHaveTextContent(
      `Remote now points at ${CANDIDATE.slice(0, 12)}`,
    );
  });
});
