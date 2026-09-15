// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReviewBridge } from "../contracts/review.js";
import { ReviewSurface } from "./ReviewSurface.js";

const targetV4Metadata = {
  connectionReference: null,
  dialectId: "skills-1.5.23" as const,
  executionBindingDigest: null,
  harnessIds: ["codex"],
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de" as const,
  registryVersion: 1 as const,
  workspace: "/work/skills-desktop",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Trusted Review surface", () => {
  it("shows a persisted approved decision with an explicit close action", async () => {
    const closeWindow = vi
      .spyOn(window, "close")
      .mockImplementation(() => undefined);
    const client: ReviewBridge = {
      async approve() {
        return { ok: true, value: { operationId: "settled-review" } };
      },
      async getReview() {
        return {
          ok: true,
          value: {
            decision: "approve",
            schemaVersion: 2,
            status: "settled",
          },
        };
      },
      async reject() {
        return { ok: true, value: { operationId: "settled-review" } };
      },
    };

    render(<ReviewSurface client={client} />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Review approved",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close review" }));
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("shows the immutable Official Collection evidence before approval", async () => {
    const approve = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "collection-execution" },
    }));
    const client: ReviewBridge = {
      approve,
      async getReview() {
        return {
          ok: true as const,
          value: {
            projection: {
              collectionPlan: {
                assessmentDigest: `sha256:${"b".repeat(64)}`,
                childCommandPlan: {
                  harness: "Codex",
                  names: ["find-skills"],
                  operation: "add" as const,
                  preview: "Pinned add preview",
                  schemaVersion: 1 as const,
                  scope: "project" as const,
                  source: {
                    revision: "0123456789abcdef0123456789abcdef01234567",
                    source: "vercel-labs/skills",
                    sourceType: "github" as const,
                  },
                  targetId: "00000000-0000-4000-8000-000000000001",
                  timeoutMs: 600_000,
                },
                childPreparedDigest: "c".repeat(64),
                collectionId: "skills-desktop-starter",
                expiresAt: "2026-08-22T06:10:00.000Z",
                id: "collection-plan",
                inventoryDigest: `sha256:${"d".repeat(64)}`,
                manifestDigest: `sha256:${"a".repeat(64)}`,
                order: [
                  {
                    names: ["find-skills"],
                    position: 1,
                    targetId: "00000000-0000-4000-8000-000000000001",
                  },
                ],
                releaseEvidence: {
                  compatibility: {
                    cliVersion: "1.5.23" as const,
                    harnesses: ["Codex"],
                    platforms: ["linux" as const],
                    requiredCapabilities: ["local" as const],
                  },
                  receipt: {
                    author: "Collection author",
                    manifestDigest: `sha256:${"a".repeat(64)}`,
                    reviewLocation:
                      "https://github.com/oldwinter/skills-desktop/pull/20",
                    reviewPolicy: "official-collection-v1" as const,
                    reviewedAt: "2026-08-22T05:00:00.000Z",
                    reviewer: "Reviewer B",
                    schemaVersion: 1 as const,
                    status: "approved" as const,
                  },
                  status: "active" as const,
                },
                releaseNumber: 1,
                reviewDigest: `sha256:${"e".repeat(64)}`,
                schemaVersion: 1 as const,
                scope: "project" as const,
                selections: [{ mode: "add" as const, name: "find-skills" }],
                source: {
                  repository: "vercel-labs/skills",
                  reviewedRevision: "0123456789abcdef0123456789abcdef01234567",
                },
                targetGeneration: 1,
                targetId: "00000000-0000-4000-8000-000000000001",
              },
              expiresAt: "2026-08-22T06:10:00.000Z",
              reviewId: "collection-review",
              target: {
                ...targetV4Metadata,
                generation: 1,
                id: "00000000-0000-4000-8000-000000000001",
                kind: "local" as const,
                label: "This device",
                workspace: "/work/skills-desktop",
                workspaceLabel: "skills-desktop",
              },
            },
            schemaVersion: 2 as const,
            status: "pending" as const,
          },
        };
      },
      async reject() {
        return {
          ok: true as const,
          value: { operationId: "collection-review" },
        };
      },
    };
    render(<ReviewSurface client={client} />);

    expect(
      await screen.findByRole("heading", {
        name: "Review Official Collection",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "vercel-labs/skills@0123456789abcdef0123456789abcdef01234567",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(`sha256:${"a".repeat(64)}`)).toBeInTheDocument();
    expect(screen.getByText(`sha256:${"e".repeat(64)}`)).toBeInTheDocument();
    expect(screen.getAllByText("Details")[0]).toBeInTheDocument();
    expect(
      screen.queryByText("2026-08-22T05:00:00.000Z"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Collection author")).toBeInTheDocument();
    expect(screen.getByText("Reviewer B")).toBeInTheDocument();
    expect(
      screen.getByText("https://github.com/oldwinter/skills-desktop/pull/20"),
    ).toBeInTheDocument();
    expect(screen.getByText(/CLI 1\.5\.23/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Approve Official Collection plan" }),
    );
    await waitFor(() => expect(approve).toHaveBeenCalledWith());
  });

  it("shows every aggregate Collection child in stable order before one approval", async () => {
    const approve = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "collection-execution-many" },
    }));
    const localTarget = {
      ...targetV4Metadata,
      generation: 1,
      id: "00000000-0000-4000-8000-000000000001",
      kind: "local" as const,
      label: "This device",
      workspaceLabel: "skills-desktop",
    };
    const sshTarget = {
      ...targetV4Metadata,
      connectionReference: "build-host",
      generation: 3,
      id: "00000000-0000-4000-8000-000000000002",
      kind: "ssh" as const,
      label: "Build host",
      workspace: "/srv/skills-desktop",
      workspaceLabel: "remote",
    };
    const commandPlan = (
      targetId: string,
      name: string,
      preview: string,
      scope: "global" | "project",
    ) => ({
      harness: "Codex",
      names: [name],
      operation: "add" as const,
      preview,
      schemaVersion: 1 as const,
      scope,
      source: {
        revision: "0123456789abcdef0123456789abcdef01234567",
        source: "vercel-labs/skills",
        sourceType: "github" as const,
      },
      targetId,
      timeoutMs: 600_000,
    });
    const client: ReviewBridge = {
      approve,
      async getReview() {
        return {
          ok: true as const,
          value: {
            projection: {
              collectionPlan: {
                children: [
                  {
                    assessmentDigest: `sha256:${"1".repeat(64)}`,
                    bindingDigest: `sha256:${"2".repeat(64)}`,
                    commandPlan: commandPlan(
                      localTarget.id,
                      "find-skills",
                      "Pinned local add preview",
                      "project",
                    ),
                    inventoryDigest: `sha256:${"3".repeat(64)}`,
                    position: 1,
                    preparedDigest: "4".repeat(64),
                    scope: "project" as const,
                    selections: [{ mode: "add" as const, name: "find-skills" }],
                    target: localTarget,
                  },
                  {
                    assessmentDigest: `sha256:${"5".repeat(64)}`,
                    bindingDigest: `sha256:${"6".repeat(64)}`,
                    commandPlan: commandPlan(
                      sshTarget.id,
                      "tdd",
                      "Pinned SSH add preview",
                      "global",
                    ),
                    inventoryDigest: `sha256:${"7".repeat(64)}`,
                    position: 2,
                    preparedDigest: "8".repeat(64),
                    scope: "global" as const,
                    selections: [{ mode: "add" as const, name: "tdd" }],
                    target: sshTarget,
                  },
                ],
                collectionId: "skills-desktop-starter",
                expiresAt: "2026-08-22T06:10:00.000Z",
                id: "collection-plan-many",
                manifestDigest: `sha256:${"a".repeat(64)}`,
                order: [
                  {
                    names: ["find-skills"],
                    position: 1,
                    scope: "project" as const,
                    targetId: localTarget.id,
                  },
                  {
                    names: ["tdd"],
                    position: 2,
                    scope: "global" as const,
                    targetId: sshTarget.id,
                  },
                ],
                releaseEvidence: {
                  compatibility: {
                    cliVersion: "1.5.23" as const,
                    harnesses: ["Codex"],
                    platforms: ["linux" as const],
                    requiredCapabilities: ["local" as const, "ssh" as const],
                  },
                  receipt: {
                    author: "Collection author",
                    manifestDigest: `sha256:${"a".repeat(64)}`,
                    reviewLocation:
                      "https://github.com/oldwinter/skills-desktop/issues/20",
                    reviewPolicy: "official-collection-v1" as const,
                    reviewedAt: "2026-08-22T05:00:00.000Z",
                    reviewer: "Reviewer B",
                    schemaVersion: 1 as const,
                    status: "approved" as const,
                  },
                  status: "active" as const,
                },
                releaseNumber: 1,
                reviewDigest: `sha256:${"e".repeat(64)}`,
                schemaVersion: 2 as const,
                source: {
                  repository: "vercel-labs/skills",
                  reviewedRevision: "0123456789abcdef0123456789abcdef01234567",
                },
              },
              expiresAt: "2026-08-22T06:10:00.000Z",
              reviewId: "collection-review-many",
              target: localTarget,
            },
            schemaVersion: 2 as const,
            status: "pending" as const,
          },
        };
      },
      async reject() {
        return {
          ok: true as const,
          value: { operationId: "collection-review-many" },
        };
      },
    };
    render(<ReviewSurface client={client} />);

    const heading = await screen.findByRole("heading", {
      name: "Stable child order",
    });
    const orderedList = heading.parentElement?.querySelector("ol");
    expect(orderedList).not.toBeNull();
    const children = within(orderedList!).getAllByRole("listitem");
    expect(children).toHaveLength(2);
    expect(children[0]).toHaveTextContent("1. This device");
    expect(children[0]).toHaveTextContent("Pinned local add preview");
    expect(children[0]).toHaveTextContent(`sha256:${"2".repeat(64)}`);
    expect(children[1]).toHaveTextContent("2. Build host");
    expect(children[1]).toHaveTextContent("SSH / generation 3 / Global");
    expect(children[1]).toHaveTextContent("Pinned SSH add preview");
    expect(children[1]).toHaveTextContent("8".repeat(64));
    expect(
      screen.getByText("Sequential, non-transactional"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Approve Official Collection plan" }),
    );
    await waitFor(() => expect(approve).toHaveBeenCalledWith());
  });

  it("shows its immutable assignment and decides without renderer-supplied authority", async () => {
    const closeWindow = vi
      .spyOn(window, "close")
      .mockImplementation(() => undefined);
    const approve = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "mutation-1" },
    }));
    const reject = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "review-1" },
    }));
    const client: ReviewBridge = {
      approve,
      async getReview() {
        return {
          ok: true,
          value: {
            projection: {
              commandPlan: {
                harness: "Codex",
                names: ["tdd"],
                operation: "remove",
                preview: "npx skills@1.5.23 remove tdd --agent codex --yes",
                schemaVersion: 1,
                scope: "project",
                source: null,
                targetId: "00000000-0000-4000-8000-000000000001",
                timeoutMs: 120_000,
              },
              expiresAt: "2026-08-21T10:10:00.000Z",
              purpose: "execute",
              reviewId: "review-1",
              target: {
                ...targetV4Metadata,
                generation: 1,
                id: "00000000-0000-4000-8000-000000000001",
                kind: "local",
                label: "This device",
                workspace: "/work/skills-desktop",
                workspaceLabel: "skills-desktop",
              },
            },
            schemaVersion: 2,
            status: "pending",
          },
        };
      },
      reject,
    };
    render(<ReviewSurface client={client} />);

    expect(
      await screen.findByRole("heading", { name: "Review removal" }),
    ).toBeInTheDocument();
    const rejectButton = screen.getByRole("button", { name: "Reject" });
    expect(rejectButton).toHaveFocus();
    expect(screen.getByText("tdd")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(
      screen.getByText("npx skills@1.5.23 remove tdd --agent codex --yes"),
    ).toBeInTheDocument();
    // A plan without harnessEffect predates the field; remove is bound.
    const effect = screen.getByTestId("review-harness-effect");
    expect(effect).toHaveTextContent("Bound to selected harnesses");
    expect(effect).toHaveTextContent("Only the Codex link");

    fireEvent.click(screen.getByRole("button", { name: "Approve mutation" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith());
    expect(reject).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Mutation started",
    );
    const closeButton = screen.getByRole("button", { name: "Close review" });
    expect(closeButton).toHaveFocus();
    fireEvent.click(closeButton);
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("offers a skip-link into the review body ahead of Approve / Reject (#193)", async () => {
    const client: ReviewBridge = {
      async approve() {
        return { ok: true, value: { operationId: "mutation-1" } };
      },
      async getReview() {
        return {
          ok: true,
          value: {
            projection: {
              commandPlan: {
                harness: "Codex",
                names: ["tdd"],
                operation: "remove",
                preview: "npx skills@1.5.23 remove tdd --agent codex --yes",
                schemaVersion: 1,
                scope: "project",
                source: null,
                targetId: "00000000-0000-4000-8000-000000000001",
                timeoutMs: 120_000,
              },
              expiresAt: "2026-08-21T10:10:00.000Z",
              purpose: "execute",
              reviewId: "review-1",
              target: {
                ...targetV4Metadata,
                generation: 1,
                id: "00000000-0000-4000-8000-000000000001",
                kind: "local",
                label: "This device",
                workspace: "/work/skills-desktop",
                workspaceLabel: "skills-desktop",
              },
            },
            schemaVersion: 2,
            status: "pending",
          },
        };
      },
      async reject() {
        return { ok: true, value: { operationId: "review-1" } };
      },
    };
    const { container } = render(<ReviewSurface client={client} />);

    const main = await screen.findByRole("main");
    const skipLink = screen.getByRole("link", { name: "Skip to review" });
    expect(container.querySelector("a, button")).toBe(skipLink);
    expect(skipLink).toHaveAttribute("href", "#review-main");
    expect(main).toHaveAttribute("id", "review-main");
    expect(main).toHaveAttribute("tabindex", "-1");
    main.focus();
    expect(main).toHaveFocus();
  });

  it("discloses that update touches every CLI-managed harness in scope", async () => {
    const client: ReviewBridge = {
      async approve() {
        return { ok: true, value: { operationId: "mutation-2" } };
      },
      async getReview() {
        return {
          ok: true,
          value: {
            projection: {
              commandPlan: {
                harness: "amp codex",
                harnessEffect: {
                  kind: "cli-unscoped",
                  targetHarnessIds: ["amp", "codex"],
                },
                harnessIds: ["amp", "codex"],
                names: ["tdd"],
                operation: "update",
                preview: "npx skills@1.5.23 update tdd --project --yes",
                schemaVersion: 1,
                scope: "project",
                source: null,
                targetId: "00000000-0000-4000-8000-000000000001",
                timeoutMs: 600_000,
              },
              expiresAt: "2026-08-21T10:10:00.000Z",
              purpose: "execute",
              reviewId: "review-2",
              target: {
                ...targetV4Metadata,
                generation: 1,
                harnessIds: ["amp", "codex"],
                id: "00000000-0000-4000-8000-000000000001",
                kind: "local",
                label: "This device",
                workspace: "/work/skills-desktop",
                workspaceLabel: "skills-desktop",
              },
            },
            schemaVersion: 2,
            status: "pending",
          },
        };
      },
      async reject() {
        return { ok: true, value: { operationId: "review-2" } };
      },
    };
    render(<ReviewSurface client={client} />);

    expect(
      await screen.findByRole("heading", { name: "Review update" }),
    ).toBeInTheDocument();
    const effect = screen.getByTestId("review-harness-effect");
    expect(effect).toHaveTextContent("Affects every CLI-managed harness");
    expect(effect).toHaveTextContent(
      "updates every CLI-managed link for the listed Skills in project scope, including harnesses this Target does not bind",
    );
    expect(effect).toHaveTextContent("This Target binds amp, codex.");
    expect(effect).toHaveClass("review-effect--cli-unscoped");
    expect(screen.queryByTestId("review-source-disclosure")).toBeNull();
  });

  it("discloses an inspected add source and whether it can still move before execution (#201)", async () => {
    const client: ReviewBridge = {
      async approve() {
        return { ok: true, value: { operationId: "mutation-3" } };
      },
      async getReview() {
        return {
          ok: true,
          value: {
            projection: {
              commandPlan: {
                harness: "codex",
                harnessEffect: { harnessIds: ["codex"], kind: "bound" },
                harnessIds: ["codex"],
                names: ["find-skills"],
                operation: "add",
                preview:
                  "npx skills@1.5.23 add vercel-labs/skills#main --skill find-skills --agent codex --yes",
                schemaVersion: 1,
                scope: "project",
                source: {
                  family: "github",
                  inspectionDigest: "a".repeat(64),
                  inspectionId: "inspection-1",
                  mutability: "mutable",
                  ref: "main",
                  source: "vercel-labs/skills#main",
                  sourceType: "inspected",
                },
                targetId: "00000000-0000-4000-8000-000000000001",
                timeoutMs: 600_000,
              },
              expiresAt: "2026-08-21T10:10:00.000Z",
              purpose: "execute",
              reviewId: "review-3",
              target: {
                ...targetV4Metadata,
                generation: 1,
                id: "00000000-0000-4000-8000-000000000001",
                kind: "local",
                label: "This device",
                workspace: "/work/skills-desktop",
                workspaceLabel: "skills-desktop",
              },
            },
            schemaVersion: 2,
            status: "pending",
          },
        };
      },
      async reject() {
        return { ok: true, value: { operationId: "review-3" } };
      },
    };
    render(<ReviewSurface client={client} />);

    expect(
      await screen.findByRole("heading", { name: "Review add" }),
    ).toBeInTheDocument();
    const disclosure = screen.getByTestId("review-source-disclosure");
    expect(disclosure).toHaveTextContent(
      "Source: GitHub repository · Mutable source",
    );
    expect(disclosure).toHaveTextContent("vercel-labs/skills#main");
    expect(disclosure).toHaveTextContent(
      "vercel-labs/skills#main is fetched again at execution.",
    );
    expect(disclosure).toHaveClass("review-source--mutable");
  });

  it("renders in the locale and appearance carried by the Review Snapshot without translating identifiers (#210)", async () => {
    const client: ReviewBridge = {
      async approve() {
        return { ok: true, value: { operationId: "mutation-3" } };
      },
      async getReview() {
        return {
          ok: true,
          value: {
            preferences: {
              appearance: "high-contrast",
              locale: "zh-CN",
              localePreference: "zh-CN",
              systemLocale: "en",
            },
            projection: {
              commandPlan: {
                harness: "amp codex",
                harnessEffect: {
                  kind: "cli-unscoped",
                  targetHarnessIds: ["amp", "codex"],
                },
                harnessIds: ["amp", "codex"],
                names: ["tdd"],
                operation: "update",
                preview: "npx skills@1.5.23 update tdd --project --yes",
                schemaVersion: 1,
                scope: "project",
                source: null,
                targetId: "00000000-0000-4000-8000-000000000001",
                timeoutMs: 600_000,
              },
              expiresAt: "2026-08-21T10:10:00.000Z",
              purpose: "execute",
              reviewId: "review-3",
              target: {
                ...targetV4Metadata,
                generation: 1,
                harnessIds: ["amp", "codex"],
                id: "00000000-0000-4000-8000-000000000001",
                kind: "local",
                label: "This device",
                workspace: "/work/skills-desktop",
                workspaceLabel: "skills-desktop",
              },
            },
            schemaVersion: 2,
            status: "pending",
          },
        };
      },
      async reject() {
        return { ok: true, value: { operationId: "review-3" } };
      },
    };
    render(<ReviewSurface client={client} />);

    expect(
      await screen.findByRole("heading", { name: "复核更新" }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dataset["appearance"]).toBe(
      "high-contrast",
    );
    const effect = screen.getByTestId("review-harness-effect");
    expect(effect).toHaveTextContent("影响所有由 CLI 管理的 Harness");
    expect(effect).toHaveTextContent("该 Target 绑定 amp, codex。");
    expect(screen.getByText("amp codex")).toBeInTheDocument();
    expect(
      screen.getByText("npx skills@1.5.23 update tdd --project --yes"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "批准变更" }),
    ).toBeInTheDocument();
  });

  it("closes the dedicated window after a successful rejection", async () => {
    const closeWindow = vi
      .spyOn(window, "close")
      .mockImplementation(() => undefined);
    const reject = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "trust-review-rejected" },
    }));
    const client: ReviewBridge = {
      async approve() {
        return {
          ok: true as const,
          value: { operationId: "trust-review-approved" },
        };
      },
      async getReview() {
        return {
          ok: true as const,
          value: {
            projection: {
              algorithm: "ssh-ed25519",
              expiresAt: "2026-08-22T10:05:00.000Z",
              fingerprint: "SHA256:reviewed-fingerprint",
              identity: "deploy@resolved.internal:2222",
              reviewId: "trust-review-rejected",
              target: {
                ...targetV4Metadata,
                connectionReference: "build-host",
                generation: 4,
                id: "00000000-0000-4000-8000-000000000018",
                kind: "ssh" as const,
                label: "Build host",
                workspace: "/srv/skills",
                workspaceLabel: "skills",
              },
              trustAction: "first-use" as const,
            },
            schemaVersion: 2 as const,
            status: "pending" as const,
          },
        };
      },
      reject,
    };
    render(<ReviewSurface client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() => expect(reject).toHaveBeenCalledWith());
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("shows a changed host key assignment and approves without receiving key authority", async () => {
    const approve = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "trust-review-1" },
    }));
    const client: ReviewBridge = {
      approve,
      async getReview() {
        return {
          ok: true as const,
          value: {
            projection: {
              algorithm: "ssh-ed25519",
              expiresAt: "2026-08-22T10:05:00.000Z",
              fingerprint: "SHA256:reviewed-fingerprint",
              identity: "deploy@resolved.internal:2222",
              reviewId: "trust-review-1",
              target: {
                ...targetV4Metadata,
                connectionReference: "build-host",
                generation: 4,
                id: "00000000-0000-4000-8000-000000000018",
                kind: "ssh" as const,
                label: "Build host",
                workspace: "/srv/skills",
                workspaceLabel: "skills",
              },
              trustAction: "rotation" as const,
            },
            schemaVersion: 2 as const,
            status: "pending" as const,
          },
        };
      },
      async reject() {
        return {
          ok: true as const,
          value: { operationId: "trust-review-1" },
        };
      },
    };
    render(<ReviewSurface client={client} />);

    expect(
      await screen.findByRole("heading", { name: "Review changed host key" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("deploy@resolved.internal:2222"),
    ).toBeInTheDocument();
    expect(screen.getByText("ssh-ed25519")).toBeInTheDocument();
    expect(screen.getByText("SHA256:reviewed-fingerprint")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Approve host key rotation" }),
    );
    await waitFor(() => expect(approve).toHaveBeenCalledWith());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Host trust confirmed",
    );
  });

  it("shows every fact the fast-forward push binds to and approves without any Git argument (#207)", async () => {
    const approve = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "publish-op-1" },
    }));
    const digest = `sha256:${"d".repeat(64)}` as const;
    const client: ReviewBridge = {
      approve,
      async getReview() {
        return {
          ok: true as const,
          value: {
            projection: {
              expiresAt: "2026-09-15T10:11:00.000Z",
              plan: {
                base: { commit: "a".repeat(40), kind: "commit" as const },
                branch: "main",
                candidateCommit: "c".repeat(40),
                createdAt: "2026-09-15T10:01:00.000Z",
                expiresAt: "2026-09-15T10:11:00.000Z",
                exporterVersion: 1 as const,
                files: [
                  {
                    digest,
                    path: ".well-known/agent-skills/hello/SKILL.md",
                  },
                  { digest, path: ".well-known/agent-skills/index.json" },
                ],
                id: "plan-1",
                planDigest: `sha256:${"e".repeat(64)}` as const,
                ref: "refs/heads/main",
                remote: {
                  host: "github.com",
                  kind: "https" as const,
                  url: "https://github.com/acme/skills.git",
                },
                schemaVersion: 1 as const,
                skills: ["hello"],
                treeDigest: `sha256:${"f".repeat(64)}` as const,
              },
              purpose: "publication-push" as const,
              reviewId: "publish-review-1",
            },
            schemaVersion: 2 as const,
            status: "pending" as const,
          },
        };
      },
      async reject() {
        return {
          ok: true as const,
          value: { operationId: "publish-review-1" },
        };
      },
    };
    render(<ReviewSurface client={client} />);

    expect(
      await screen.findByRole("heading", { name: "Review Git publication" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("https://github.com/acme/skills.git"),
    ).toBeInTheDocument();
    expect(screen.getByText("refs/heads/main")).toBeInTheDocument();
    expect(screen.getByText("a".repeat(40))).toBeInTheDocument();
    expect(screen.getByText("c".repeat(40))).toBeInTheDocument();
    expect(
      screen.getByText(".well-known/agent-skills/hello/SKILL.md"),
    ).toBeInTheDocument();
    expect(screen.getByText(`sha256:${"e".repeat(64)}`)).toBeInTheDocument();
    expect(
      screen.getByText(/no force, tags, hooks, or deletes/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Approve fast-forward push" }),
    );
    await waitFor(() => expect(approve).toHaveBeenCalledWith());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Publication attempted",
    );
  });
});
