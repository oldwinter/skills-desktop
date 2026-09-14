import { describe, expect, it } from "vitest";

import config, { normalizeBasePath } from "./vite.config.js";

describe("website vite config", () => {
  it("normalizes the deploy base path to a slash-wrapped segment", () => {
    expect(normalizeBasePath(undefined)).toBe("/");
    expect(normalizeBasePath("")).toBe("/");
    expect(normalizeBasePath("/")).toBe("/");
    expect(normalizeBasePath("skills-desktop")).toBe("/skills-desktop/");
    expect(normalizeBasePath("/skills-desktop")).toBe("/skills-desktop/");
    expect(normalizeBasePath(" /skills-desktop/ ")).toBe("/skills-desktop/");
  });

  it("builds into the workspace dist directory", () => {
    expect(config).toMatchObject({
      base: "/",
      build: {
        emptyOutDir: true,
        outDir: expect.stringMatching(/apps[/\\]website[/\\]dist$/),
      },
    });
  });
});
