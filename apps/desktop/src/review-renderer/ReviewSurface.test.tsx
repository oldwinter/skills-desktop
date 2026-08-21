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

import type { ReviewBridge } from "../contracts/review.js";
import { ReviewSurface } from "./ReviewSurface.js";

afterEach(cleanup);

describe("Trusted Review surface", () => {
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
                generation: 1,
                harness: "Codex",
                id: "00000000-0000-4000-8000-000000000001",
                kind: "local" as const,
                label: "This device",
                workspaceLabel: "skills-desktop",
              },
            },
            schemaVersion: 1 as const,
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
  it("shows its immutable assignment and decides without renderer-supplied authority", async () => {
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
                generation: 1,
                harness: "Codex",
                id: "00000000-0000-4000-8000-000000000001",
                kind: "local",
                label: "This device",
                workspaceLabel: "skills-desktop",
              },
            },
            schemaVersion: 1,
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
    expect(screen.getByText("tdd")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(
      screen.getByText("npx skills@1.5.23 remove tdd --agent codex --yes"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve mutation" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith());
    expect(reject).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Mutation started",
    );
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
                connectionReference: "build-host",
                generation: 4,
                harness: "Codex",
                id: "00000000-0000-4000-8000-000000000018",
                kind: "ssh" as const,
                label: "Build host",
                workspace: "/srv/skills",
                workspaceLabel: "skills",
              },
              trustAction: "rotation" as const,
            },
            schemaVersion: 1 as const,
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
});
