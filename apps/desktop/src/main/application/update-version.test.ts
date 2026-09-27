import { describe, expect, it } from "vitest";

import { isStrictlyNewerStableVersion } from "./update-version.js";

describe("update version ordering", () => {
  it.each([
    { candidate: "1.2.4", expected: true, running: "1.2.3" },
    { candidate: "1.3.0", expected: true, running: "1.2.9" },
    { candidate: "2.0.0", expected: true, running: "1.9.9" },
    { candidate: "1.2.3", expected: false, running: "1.2.4" },
    { candidate: "1.2.3", expected: false, running: "1.2.3" },
    { candidate: "1.2.4-beta", expected: true, running: "1.2.3" },
    { candidate: "1.2.3", expected: false, running: "1.2.4-beta" },
  ])(
    "orders numeric triples: $candidate vs $running is $expected",
    ({ candidate, expected, running }) => {
      expect(isStrictlyNewerStableVersion(candidate, running)).toBe(expected);
    },
  );

  it.each([
    { candidate: "1.2.3", expected: true, running: "1.2.3-beta" },
    { candidate: "1.2.3", expected: true, running: "1.2.3-alpha.1" },
    { candidate: "1.2.3-beta", expected: false, running: "1.2.3" },
    { candidate: "1.2.3-alpha", expected: false, running: "1.2.3" },
  ])(
    "prefers the stable release at a tied triple: $candidate vs $running is $expected",
    ({ candidate, expected, running }) => {
      expect(isStrictlyNewerStableVersion(candidate, running)).toBe(expected);
    },
  );

  it.each([
    { candidate: "1.2.3-beta", expected: true, running: "1.2.3-alpha" },
    { candidate: "1.2.3-alpha.1", expected: true, running: "1.2.3-alpha" },
    { candidate: "1.2.3-alpha.beta", expected: true, running: "1.2.3-alpha.1" },
    { candidate: "1.2.3-10", expected: true, running: "1.2.3-2" },
    { candidate: "1.2.3-alpha", expected: true, running: "1.2.3-1" },
    { candidate: "1.2.3-alpha", expected: false, running: "1.2.3-beta" },
    { candidate: "1.2.3-alpha", expected: false, running: "1.2.3-alpha.1" },
    { candidate: "1.2.3-2", expected: false, running: "1.2.3-10" },
    { candidate: "1.2.3-1", expected: false, running: "1.2.3-alpha" },
  ])(
    "orders prerelease tags: $candidate vs $running is $expected",
    ({ candidate, expected, running }) => {
      expect(isStrictlyNewerStableVersion(candidate, running)).toBe(expected);
    },
  );

  it.each([
    { candidate: "1.2.3-beta", running: "1.2.3-beta" },
    { candidate: "1.2.3-alpha.1", running: "1.2.3-alpha.1" },
    { candidate: "1.2.3-beta+2", running: "1.2.3-beta+1" },
    { candidate: "1.2.3-beta+build", running: "1.2.3-beta" },
  ])(
    "never reports an equal version as newer: $candidate vs $running",
    ({ candidate, running }) => {
      expect(isStrictlyNewerStableVersion(candidate, running)).toBe(false);
      expect(isStrictlyNewerStableVersion(running, candidate)).toBe(false);
    },
  );

  it.each([
    { candidate: "notaversion", running: "1.2.3" },
    { candidate: "1.2.3", running: "notaversion" },
    { candidate: "1.2", running: "1.2.3" },
    { candidate: "1.2.3.4", running: "1.2.3" },
    { candidate: "", running: "1.2.3" },
    { candidate: "1.2.3", running: "" },
  ])(
    "rejects malformed input: $candidate vs $running",
    ({ candidate, running }) => {
      expect(isStrictlyNewerStableVersion(candidate, running)).toBe(false);
    },
  );

  it.each([
    { candidate: "9007199254740993.0.0", running: "1.2.3" },
    { candidate: "1.2.3", running: "9007199254740993.0.0" },
    { candidate: "1.9007199254740993.0", running: "1.2.3" },
    { candidate: "1.2.9007199254740993", running: "1.2.3" },
  ])(
    "rejects non-safe-integer components: $candidate vs $running",
    ({ candidate, running }) => {
      expect(isStrictlyNewerStableVersion(candidate, running)).toBe(false);
    },
  );
});
