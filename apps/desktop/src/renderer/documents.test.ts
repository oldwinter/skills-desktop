import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const documents = {
  review: resolve(sourceRoot, "review-renderer/index.html"),
  workspace: resolve(sourceRoot, "renderer/index.html"),
} as const;

describe("renderer entry documents", () => {
  it.each(Object.entries(documents))(
    "%s declares color-scheme so native chrome follows the appearance (#190)",
    async (_name, path) => {
      const html = await readFile(path, "utf8");
      expect(html).toContain(
        '<meta name="color-scheme" content="light dark" />',
      );
      expect(html).toContain('data-appearance="system"');
      expect(html).toContain('http-equiv="Content-Security-Policy"');
    },
  );

  it.each([
    resolve(sourceRoot, "renderer/styles.css"),
    resolve(sourceRoot, "review-renderer/styles.css"),
  ])("%s pins color-scheme per appearance", async (path) => {
    const css = await readFile(path, "utf8");
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light;/);
    expect(css).toMatch(
      /:root\[data-appearance="dark"\]\s*\{[^}]*color-scheme:\s*dark;/,
    );
  });
});
