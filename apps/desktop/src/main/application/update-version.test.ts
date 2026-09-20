import { describe, expect, it } from "vitest";

import { isStrictlyNewerStableVersion } from "./update-version.js";

describe("isStrictlyNewerStableVersion", () => {
  it("accepts any strictly newer numeric component", () => {
    expect(isStrictlyNewerStableVersion("1.2.4", "1.2.3")).toBe(true);
    expect(isStrictlyNewerStableVersion("1.3.0", "1.2.9")).toBe(true);
    expect(isStrictlyNewerStableVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isStrictlyNewerStableVersion("1.10.0", "1.9.0")).toBe(true);
  });

  it("rejects older or identical versions", () => {
    expect(isStrictlyNewerStableVersion("1.2.3", "1.2.4")).toBe(false);
    expect(isStrictlyNewerStableVersion("1.2.3", "1.2.3")).toBe(false);
    expect(isStrictlyNewerStableVersion("0.9.9", "1.0.0")).toBe(false);
  });

  it("rejects candidates that are not parseable versions", () => {
    expect(isStrictlyNewerStableVersion("v1.2.4", "1.2.3")).toBe(false);
    expect(isStrictlyNewerStableVersion("1.2", "1.2.3")).toBe(false);
    expect(isStrictlyNewerStableVersion("", "1.2.3")).toBe(false);
    expect(isStrictlyNewerStableVersion("1.2.3.4", "1.2.3")).toBe(false);
    expect(isStrictlyNewerStableVersion("1.2.4", "nightly")).toBe(false);
    expect(
      isStrictlyNewerStableVersion("9007199254740993.0.0", "1.0.0"),
    ).toBe(false);
  });

  it("prefers a stable candidate over a prerelease at the same base version", () => {
    expect(isStrictlyNewerStableVersion("1.0.0", "1.0.0-rc.1")).toBe(true);
    expect(isStrictlyNewerStableVersion("1.0.0-rc.1", "1.0.0")).toBe(false);
    // Any same-base candidate counts as newer while the running build is a
    // prerelease; the caller's schema only admits X.Y.Z candidates anyway.
    expect(isStrictlyNewerStableVersion("1.0.0-rc.1", "1.0.0-rc.1")).toBe(true);
    expect(isStrictlyNewerStableVersion("1.0.0-rc.2", "1.0.0-rc.1")).toBe(true);
    expect(isStrictlyNewerStableVersion("1.0.1-rc.1", "1.0.0")).toBe(true);
  });
});
