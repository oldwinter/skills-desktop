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
  PublicStudioDraft,
  PublicStudioGrant,
  PublicStudioState,
  PublicStudioValidation as StudioValidation,
  WorkspaceBridge,
} from "../../../contracts/workspace.js";
import { StudioView } from "./StudioView.js";

afterEach(cleanup);

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

const validOk: StudioValidation = {
  description: "Demo.",
  fileCount: 1,
  findings: [],
  name: "demo-skill",
  ok: true,
  profileVersion: 1,
  totalBytes: 40,
};

function state(overrides: Partial<PublicStudioState> = {}): PublicStudioState {
  return {
    activeOperationId: null,
    available: true,
    draftFailures: [],
    drafts: [],
    grants: [],
    lastError: null,
    lastExport: null,
    preview: null,
    ...overrides,
  };
}

const grant: PublicStudioGrant = {
  grantedAt: "2026-09-15T10:00:00.000Z",
  id: "grant-1",
  label: "demo-skill",
  purpose: "author",
  validation: {
    ...validOk,
    findings: [
      { code: "symlink", message: "x", path: "escape", severity: "error" },
      {
        code: "html_inert",
        line: 7,
        message: "y",
        path: "SKILL.md",
        severity: "warning",
      },
    ],
    ok: false,
  },
};

const draft: PublicStudioDraft = {
  createdAt: "2026-09-15T10:00:00.000Z",
  id: "draft-1",
  name: "demo-skill",
  revision: 3,
  skillMd: "---\nname: demo-skill\ndescription: Demo.\n---\n\n# Demo\n",
  updatedAt: "2026-09-15T10:05:00.000Z",
  validation: validOk,
};

describe("StudioView (ADR 0018)", () => {
  it("explains unavailability without offering any action", () => {
    render(<StudioView client={bridge()} studio={undefined} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Studio" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows grants as labels with findings and forwards only the grant id", async () => {
    const validateStudioGrant = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-1" },
    }));
    const releaseStudioGrant = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-2" },
    }));
    const { container } = render(
      <StudioView
        client={bridge({ releaseStudioGrant, validateStudioGrant })}
        studio={state({ grants: [grant] })}
      />,
    );
    expect(screen.getByTestId("studio-grant")).toHaveTextContent("demo-skill");
    expect(screen.getByTestId("studio-validation")).toHaveTextContent(
      "1 error · 1 warning · 1 file",
    );
    expect(screen.getByTestId("studio-findings")).toHaveTextContent(
      "Symbolic link",
    );
    expect(screen.getByTestId("studio-findings")).toHaveTextContent(
      "SKILL.md:7",
    );
    // The projection carries only a label and root-relative locations.
    expect(container.textContent).not.toMatch(/\/(?:home|Users|private|tmp)\//);
    expect(container.textContent).toContain("demo-skill");
    expect(
      screen.getByRole("button", { name: "New Draft from SKILL.md" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Validate again" }));
    await waitFor(() =>
      expect(validateStudioGrant).toHaveBeenCalledWith("grant-1"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() =>
      expect(releaseStudioGrant).toHaveBeenCalledWith("grant-1"),
    );
  });

  it("disables folder access without a host while Drafts remain editable", () => {
    render(
      <StudioView
        client={bridge()}
        studio={state({ available: false, drafts: [draft] })}
      />,
    );
    expect(screen.getByTestId("studio-open-folder")).toBeDisabled();
    expect(screen.getByTestId("studio-export")).toBeDisabled();
    expect(screen.getByTestId("studio-editor-textarea")).toBeEnabled();
  });

  it("autosaves edits with the loaded revision and advances it on success", async () => {
    const saveStudioDraft = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-3" },
    }));
    render(
      <StudioView
        client={bridge({ saveStudioDraft })}
        studio={state({ drafts: [draft] })}
      />,
    );
    const textarea = screen.getByTestId("studio-editor-textarea");
    fireEvent.change(textarea, {
      target: { value: `${draft.skillMd}\nMore.\n` },
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await waitFor(() =>
      expect(saveStudioDraft).toHaveBeenCalledWith(
        "draft-1",
        3,
        `${draft.skillMd}\nMore.\n`,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("studio-draft-revision")).toHaveTextContent(
        "4",
      ),
    );
  });

  it("reports a compare-and-swap conflict instead of overwriting", async () => {
    const saveStudioDraft = vi.fn(async () => ({
      error: {
        code: "studio_draft_conflict" as const,
        effects: "none" as const,
        message: "conflict",
        phase: "studio",
        retryable: false,
      },
      ok: false as const,
    }));
    render(
      <StudioView
        client={bridge({ saveStudioDraft })}
        studio={state({ drafts: [draft] })}
      />,
    );
    fireEvent.change(screen.getByTestId("studio-editor-textarea"), {
      target: { value: "changed" },
    });
    await waitFor(() => expect(saveStudioDraft).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This Draft changed elsewhere.",
      ),
    );
    expect(screen.getByTestId("studio-editor-textarea")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByTestId("studio-editor-textarea")).toHaveValue(
      draft.skillMd,
    );
  });

  it("renders the structured preview inertly and blocks export on errors", () => {
    const exportStudioDraft = vi.fn();
    const broken: PublicStudioDraft = {
      ...draft,
      name: "",
      validation: {
        ...validOk,
        findings: [
          {
            code: "frontmatter_invalid",
            line: 1,
            message: "x",
            path: "SKILL.md",
            severity: "error",
          },
        ],
        name: "",
        ok: false,
      },
    };
    const { container } = render(
      <StudioView
        client={bridge({ exportStudioDraft })}
        studio={state({
          drafts: [broken],
          preview: {
            draftId: "draft-1",
            preview: {
              blocks: [
                {
                  children: [{ kind: "text", text: "Demo" }],
                  kind: "heading",
                  level: 1,
                },
                {
                  children: [
                    {
                      children: [{ kind: "text", text: "docs" }],
                      kind: "link",
                      target: "javascript:alert(1)",
                    },
                    { alt: "logo", kind: "image", target: "logo.png" },
                    { kind: "text", text: "<script>alert(1)</script>" },
                  ],
                  kind: "paragraph",
                },
              ],
              profileVersion: 1,
              truncated: true,
            },
            renderedAt: "2026-09-15T10:06:00.000Z",
            revision: 2,
          },
        })}
      />,
    );
    const preview = screen.getByTestId("studio-preview");
    expect(preview).toHaveTextContent("Demo");
    expect(preview).toHaveTextContent("[image: logo (logo.png)]");
    expect(preview).toHaveTextContent("rendered from an earlier revision");
    expect(preview).toHaveTextContent("Preview truncated at the block limit.");
    expect(container.querySelectorAll("a, img, script, iframe")).toHaveLength(
      0,
    );
    expect(container.innerHTML).not.toContain("<script>");
    expect(screen.getByTestId("studio-export")).toBeDisabled();
    expect(screen.getByTestId("studio-validation")).toHaveTextContent(
      "1 error",
    );
  });

  it("exports through main and shows the recorded destination label", async () => {
    const exportStudioDraft = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-5" },
    }));
    render(
      <StudioView
        client={bridge({ exportStudioDraft })}
        studio={state({
          drafts: [draft],
          lastExport: {
            destinationLabel: "skills",
            draftId: "draft-1",
            fileCount: 1,
            name: "demo-skill",
            writtenAt: "2026-09-15T10:07:00.000Z",
          },
        })}
      />,
    );
    expect(screen.getByTestId("studio-export-written")).toHaveTextContent(
      "Exported demo-skill into skills",
    );
    fireEvent.click(screen.getByTestId("studio-export"));
    await waitFor(() =>
      expect(exportStudioDraft).toHaveBeenCalledWith("draft-1"),
    );
  });

  it("surfaces main-side errors with user-facing copy", () => {
    render(
      <StudioView
        client={bridge()}
        studio={state({
          lastError: {
            code: "studio_export_failed",
            effects: "none",
            message: "raw",
            phase: "export",
            retryable: false,
          },
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Skill could not be exported.",
    );
  });
});
