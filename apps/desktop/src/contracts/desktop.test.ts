import { describe, expect, it } from "vitest";

import { reviewWindowClosedEventSchema } from "./desktop.js";

describe("desktop contracts", () => {
  it("accepts only the versioned bounded review-window close event", () => {
    expect(
      reviewWindowClosedEventSchema.parse({
        reviewId: "review-1",
        schemaVersion: 1,
      }),
    ).toEqual({ reviewId: "review-1", schemaVersion: 1 });

    expect(() =>
      reviewWindowClosedEventSchema.parse({
        reviewId: "",
        schemaVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      reviewWindowClosedEventSchema.parse({
        reviewId: "r".repeat(257),
        schemaVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      reviewWindowClosedEventSchema.parse({
        reviewId: "review-1",
        schemaVersion: 2,
      }),
    ).toThrow();
    expect(() =>
      reviewWindowClosedEventSchema.parse({
        reviewId: "review-1",
        schemaVersion: 1,
        extra: true,
      }),
    ).toThrow();
  });
});
