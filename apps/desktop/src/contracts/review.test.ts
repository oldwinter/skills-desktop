import { describe, expect, it } from "vitest";

import {
  reviewDecisionRequestSchema,
  reviewSnapshotSchema,
} from "./review.js";

describe("Review Protocol envelope", () => {
  it("accepts only the bundled Review Protocol v2", () => {
    const request = {
      decision: "reject" as const,
      type: "review.decide" as const,
      version: 2 as const,
    };

    expect(reviewDecisionRequestSchema.parse(request)).toEqual(request);
    expect(
      reviewDecisionRequestSchema.safeParse({ ...request, version: 1 })
        .success,
    ).toBe(false);
    const snapshot = {
      schemaVersion: 2 as const,
      status: "unavailable" as const,
    };
    expect(reviewSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      reviewSnapshotSchema.safeParse({ ...snapshot, schemaVersion: 1 })
        .success,
    ).toBe(false);
  });
});
