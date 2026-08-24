import { describe, expect, it } from "vitest";

import { violationsFor } from "../scripts/check-imports.mjs";

const WINDOWS_ROOT = "C:\\repo\\skills-desktop";

function windowsPath(path) {
  return `${WINDOWS_ROOT}\\${path.replaceAll("/", "\\")}`;
}

describe("import boundary rules", () => {
  it("enforces package and contract boundaries for Windows paths", () => {
    expect(
      violationsFor(
        windowsPath("packages/skills-runtime/src/index.ts"),
        "node:fs",
      ),
    ).toEqual(["skills-runtime must stay runtime-neutral"]);
    expect(
      violationsFor(
        windowsPath("packages/remote-bootstrap/src/index.ts"),
        "node:child_process",
      ),
    ).toEqual(["remote-bootstrap may depend only on skills-runtime"]);
    expect(
      violationsFor(
        windowsPath("apps/desktop/src/contracts/index.ts"),
        "electron",
      ),
    ).toEqual(["public contracts must stay runtime-neutral"]);
  });

  it("enforces renderer and preload boundaries for Windows paths", () => {
    expect(
      violationsFor(
        windowsPath("apps/desktop/src/renderer/app.tsx"),
        "node:fs",
      ),
    ).toEqual([
      "renderers may depend only on public contracts and renderer code",
    ]);
    expect(
      violationsFor(
        windowsPath("apps/desktop/src/renderer/app.tsx"),
        "../main/index",
      ),
    ).toEqual([
      "renderers may depend only on public contracts and renderer code",
    ]);
    expect(
      violationsFor(
        windowsPath("apps/desktop/src/preload/workspace.ts"),
        "../renderer/app",
      ),
    ).toEqual(["preloads may depend only on Electron and public contracts"]);
  });

  it("keeps allowed public edges intact for Windows paths", () => {
    expect(
      violationsFor(
        windowsPath("packages/remote-bootstrap/src/index.ts"),
        "@skills-desktop/skills-runtime",
      ),
    ).toEqual([]);
    expect(
      violationsFor(
        windowsPath("apps/desktop/src/renderer/app.tsx"),
        "../contracts/index",
      ),
    ).toEqual([]);
    expect(
      violationsFor(
        windowsPath("apps/desktop/src/preload/workspace.ts"),
        "electron",
      ),
    ).toEqual([]);
    expect(
      violationsFor(
        windowsPath("apps/desktop/src/preload/workspace.ts"),
        "../contracts/index",
      ),
    ).toEqual([]);
  });
});
