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
  PublicStudioDraft,
  PublicStudioGrant,
  PublicStudioState,
  PublicStudioValidation as StudioValidation,
  WorkspaceBridge,
} from "../../../contracts/workspace.js";
import { StudioView } from "./StudioView.js";
import { LocaleProvider } from "../../i18n/LocaleProvider.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

const secondDraft: PublicStudioDraft = {
  ...draft,
  id: "draft-2",
  name: "other-skill",
  revision: 1,
  skillMd: "---\nname: other-skill\ndescription: Other.\n---\n\n# Other\n",
};

describe("StudioView (ADR 0018)", () => {
  it("offers search only when there are Drafts to find", () => {
    render(<StudioView client={bridge()} studio={state()} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText("No Drafts yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Draft" })).toBeEnabled();
  });

  it("filters Draft names and descriptions, trimming whitespace and ignoring case", () => {
    render(
      <StudioView
        client={bridge()}
        studio={state({ drafts: [draft, {
          ...secondDraft,
          validation: { ...validOk, description: "Review pull requests." },
        }] })}
      />,
    );
    const search = screen.getByRole("searchbox", { name: "Search Drafts" });
    fireEvent.change(search, { target: { value: "  OTHER-SKILL  " } });
    expect(screen.getByText("1 of 2 Drafts")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "other-skill · r1" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "demo-skill · r3" })).not.toBeInTheDocument();
    expect(screen.getByTestId("studio-draft-select")).toHaveValue("");
    expect(screen.getByRole("option", { name: "Choose a matching Draft" })).toBeDisabled();
    fireEvent.change(search, { target: { value: " PULL REQUESTS " } });
    expect(screen.getByRole("option", { name: "other-skill · r1" })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "   " } });
    expect(screen.getByText("2 of 2 Drafts")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("keeps pending edits and autosave on the open Draft when search hides it", async () => {
    const saveStudioDraft = vi.fn(async () => ({
      ok: true as const, value: { operationId: "save" },
    }));
    render(
      <StudioView client={bridge({ saveStudioDraft })}
        studio={state({ drafts: [draft, secondDraft] })} />,
    );
    const editor = screen.getByTestId("studio-editor-textarea");
    const edited = `${draft.skillMd}Pending text`;
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no match" } });
    expect(screen.getByText("0 of 2 Drafts")).toBeInTheDocument();
    expect(screen.getByText(/No matching Drafts/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByTestId("studio-editor-textarea")).toBe(editor);
    expect(editor).toHaveValue(edited);
    await waitFor(() =>
      expect(saveStudioDraft).toHaveBeenCalledWith(draft.id, draft.revision, edited),
    );
    expect(saveStudioDraft).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear Draft search" }));
    expect(editor).toHaveValue(edited);
  });

  it("clears search by button or Escape and keeps the explicitly chosen Draft", () => {
    render(<StudioView client={bridge()} studio={state({ drafts: [draft, secondDraft] })} />);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "other" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: secondDraft.id } });
    expect(screen.getByTestId("studio-editor-textarea")).toHaveValue(secondDraft.skillMd);
    fireEvent.click(screen.getByRole("button", { name: "Clear Draft search" }));
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveValue(secondDraft.id);
    fireEvent.change(search, { target: { value: "missing" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveValue(secondDraft.id);
    expect(screen.queryByRole("button", { name: "Clear Draft search" })).not.toBeInTheDocument();
  });

  it("finds localized Untitled Drafts and updates results from new snapshots", () => {
    const client = bridge();
    const untitled = { ...secondDraft, name: "" };
    const view = (drafts: PublicStudioDraft[]) => (
      <LocaleProvider locale="zh-CN">
        <StudioView client={client} studio={state({ drafts })} />
      </LocaleProvider>
    );
    const { rerender } = render(view([draft, untitled]));
    const search = screen.getByRole("searchbox", { name: "搜索草稿" });
    expect(search).toHaveAttribute("placeholder", "名称或描述");
    fireEvent.change(search, { target: { value: "未命名" } });
    expect(screen.getByText("显示 1 / 2 个草稿")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "未命名 · r1" })).toBeInTheDocument();
    rerender(view([draft, secondDraft]));
    expect(search).toHaveValue("未命名");
    expect(screen.getByText("显示 0 / 2 个草稿")).toBeInTheDocument();
    expect(screen.getByText(/没有匹配的草稿/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除草稿搜索" }));
    expect(search).toHaveFocus();
    expect(screen.getByText("显示 2 / 2 个草稿")).toBeInTheDocument();
  });

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

  it("autosaves the edited Draft after switching away before the debounce", async () => {
    vi.useFakeTimers();
    const saveStudioDraft = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-switch" },
    }));
    render(
      <StudioView
        client={bridge({ saveStudioDraft })}
        studio={state({ drafts: [draft, secondDraft] })}
      />,
    );
    const edited = `${draft.skillMd}\nPending.\n`;
    fireEvent.change(screen.getByTestId("studio-editor-textarea"), {
      target: { value: edited },
    });
    // Switch Drafts before the autosave debounce fires.
    fireEvent.change(screen.getByTestId("studio-draft-select"), {
      target: { value: "draft-2" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveStudioDraft).toHaveBeenCalledWith("draft-1", 3, edited);
    // The acknowledged save settles the session; nothing else is pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(saveStudioDraft).toHaveBeenCalledTimes(1);
    // Switching back shows the authored text, not the stale persisted copy.
    fireEvent.change(screen.getByTestId("studio-draft-select"), {
      target: { value: "draft-1" },
    });
    expect(screen.getByTestId("studio-editor-textarea")).toHaveValue(edited);
  });

  it("completes an in-flight save and retains the text across a Draft switch", async () => {
    vi.useFakeTimers();
    let resolveSave:
      | ((result: { ok: true; value: { operationId: string } }) => void)
      | undefined;
    const saveStudioDraft = vi.fn(
      () =>
        new Promise<{ ok: true; value: { operationId: string } }>(
          (resolve) => {
            resolveSave = resolve;
          },
        ),
    );
    render(
      <StudioView
        client={bridge({ saveStudioDraft })}
        studio={state({ drafts: [draft, secondDraft] })}
      />,
    );
    const edited = `${draft.skillMd}\nIn flight.\n`;
    fireEvent.change(screen.getByTestId("studio-editor-textarea"), {
      target: { value: edited },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(saveStudioDraft).toHaveBeenCalledWith("draft-1", 3, edited);
    // Switch away while the save is still in flight, then let it land.
    fireEvent.change(screen.getByTestId("studio-draft-select"), {
      target: { value: "draft-2" },
    });
    await act(async () => {
      resolveSave?.({ ok: true, value: { operationId: "op-flight" } });
    });
    fireEvent.change(screen.getByTestId("studio-draft-select"), {
      target: { value: "draft-1" },
    });
    expect(screen.getByTestId("studio-editor-textarea")).toHaveValue(edited);
    expect(screen.getByTestId("studio-draft-revision")).toHaveTextContent("4");
  });

  it("serializes a follow-up save when edits arrive during a save", async () => {
    vi.useFakeTimers();
    let resolveSave:
      | ((result: { ok: true; value: { operationId: string } }) => void)
      | undefined;
    const saveStudioDraft = vi.fn(
      () =>
        new Promise<{ ok: true; value: { operationId: string } }>(
          (resolve) => {
            resolveSave = resolve;
          },
        ),
    );
    render(
      <StudioView
        client={bridge({ saveStudioDraft })}
        studio={state({ drafts: [draft] })}
      />,
    );
    const first = `${draft.skillMd}\nFirst.\n`;
    fireEvent.change(screen.getByTestId("studio-editor-textarea"), {
      target: { value: first },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(saveStudioDraft).toHaveBeenCalledWith("draft-1", 3, first);
    // More text arrives while that save is in flight.
    const second = `${first}Second.\n`;
    fireEvent.change(screen.getByTestId("studio-editor-textarea"), {
      target: { value: second },
    });
    await act(async () => {
      resolveSave?.({ ok: true, value: { operationId: "op-a" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveStudioDraft).toHaveBeenLastCalledWith("draft-1", 4, second);
    expect(saveStudioDraft).toHaveBeenCalledTimes(2);
  });

  it("keeps an idle Draft's autosave deadline across unrelated snapshots and sibling edits", async () => {
    vi.useFakeTimers();
    const saveStudioDraft = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "op-idle" },
    }));
    const client = bridge({ saveStudioDraft });
    const { rerender } = render(
      <StudioView
        client={client}
        studio={state({ drafts: [draft, secondDraft] })}
      />,
    );
    const edited = `${draft.skillMd}\nIdle.\n`;
    fireEvent.change(screen.getByTestId("studio-editor-textarea"), {
      target: { value: edited },
    });
    // Editing another Draft and receiving unchanged snapshots must not
    // postpone the idle Draft's pending autosave.
    fireEvent.change(screen.getByTestId("studio-draft-select"), {
      target: { value: "draft-2" },
    });
    fireEvent.change(screen.getByTestId("studio-editor-textarea"), {
      target: { value: `${secondDraft.skillMd}Sibling.\n` },
    });
    for (let index = 0; index < 10; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      rerender(
        <StudioView
          client={client}
          studio={state({ drafts: [draft, secondDraft] })}
        />,
      );
    }
    expect(saveStudioDraft).toHaveBeenCalledWith("draft-1", 3, edited);
  });

  it("reconnects a remounted editor to an in-flight save and keeps newer edits", async () => {
    vi.useFakeTimers();
    let persistedRevision = draft.revision;
    let persistedText = draft.skillMd;
    const pendingResolutions: Array<() => void> = [];
    const conflict = {
      error: {
        code: "studio_draft_conflict" as const,
        effects: "none" as const,
        message: "conflict",
        phase: "studio",
        retryable: false,
      },
      ok: false as const,
    };
    const saveStudioDraft = vi.fn(
      (_draftId: string, expectedRevision: number, skillMd: string) =>
        new Promise<
          { ok: true; value: { operationId: string } } | typeof conflict
        >((resolve) => {
          pendingResolutions.push(() => {
            if (expectedRevision !== persistedRevision) {
              resolve(conflict);
              return;
            }
            persistedRevision = expectedRevision + 1;
            persistedText = skillMd;
            resolve({
              ok: true,
              value: { operationId: `op-${persistedRevision}` },
            });
          });
        }),
    );
    const client = bridge({ saveStudioDraft });
    const studio = state({ drafts: [draft] });
    const first = render(<StudioView client={client} studio={studio} />);
    const edited = `${draft.skillMd}\nBefore navigation.\n`;
    fireEvent.change(screen.getByTestId("studio-editor-textarea"), {
      target: { value: edited },
    });
    // Leave Studio before the debounce: the flush's save stays in flight.
    act(() => first.unmount());
    await act(async () => {});
    expect(saveStudioDraft).toHaveBeenCalledWith("draft-1", 3, edited);
    // Returning while the flush is still pending reconnects the same
    // session instead of starting over at the persisted revision.
    render(<StudioView client={client} studio={studio} />);
    const textarea = screen.getByTestId("studio-editor-textarea");
    expect(textarea).toHaveValue(edited);
    expect(textarea).toBeEnabled();
    const newer = `${edited}After returning.\n`;
    fireEvent.change(textarea, { target: { value: newer } });
    await act(async () => {
      pendingResolutions.shift()?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    // The follow-up save carries the revision the flush acknowledged, so
    // the editor's own earlier save cannot conflict it away.
    expect(saveStudioDraft).toHaveBeenLastCalledWith("draft-1", 4, newer);
    await act(async () => {
      pendingResolutions.shift()?.();
    });
    expect(persistedText).toBe(newer);
    expect(textarea).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("studio-draft-revision")).toHaveTextContent("5");
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
