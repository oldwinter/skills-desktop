// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReviewBridge } from "../contracts/review.js";
import { ReviewSurface } from "./ReviewSurface.js";

afterEach(cleanup);

describe("Trusted Review surface", () => {
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
                targetId: "local-target",
                timeoutMs: 120_000,
              },
              expiresAt: "2026-08-21T10:10:00.000Z",
              purpose: "execute",
              reviewId: "review-1",
              target: {
                generation: 1,
                harness: "Codex",
                id: "local-target",
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
});
