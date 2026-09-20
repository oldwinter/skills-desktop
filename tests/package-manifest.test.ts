import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("root package manifest", () => {
  it("allowlists install scripts for the desktop Electron version", async () => {
    const root = JSON.parse(
      await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
      allowScripts: Record<string, boolean>;
      scripts: Record<string, string>;
    };
    const desktop = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "apps", "desktop", "package.json"),
        "utf8",
      ),
    ) as { devDependencies: Record<string, string> };

    expect(root.scripts.verify).toContain("check:context");
    expect(
      root.allowScripts[`electron@${desktop.devDependencies.electron}`],
    ).toBe(true);
  });
});
