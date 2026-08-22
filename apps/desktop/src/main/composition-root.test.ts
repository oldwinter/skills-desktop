import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  capabilitiesOptions: undefined as
    | { readonly skillsTargets: { readonly primaryTarget: unknown } }
    | undefined,
  home: "",
  userData: "",
}));

const getPath = vi.hoisted(() =>
  vi.fn((name: string) => (name === "home" ? fixture.home : fixture.userData)),
);

vi.mock("electron", () => ({
  app: { getPath },
  autoUpdater: {},
  dialog: {},
}));

vi.mock("./application/desktop-capabilities.js", () => ({
  createDesktopCapabilities: vi.fn(
    (options: { readonly skillsTargets: { readonly primaryTarget: unknown } }) => {
      fixture.capabilitiesOptions = options;
      return {
        initialize: vi.fn(async () => undefined),
        restartSafety: vi.fn(() => ({ guardReasons: [] })),
      };
    },
  ),
}));

vi.mock("./update-composition.js", () => ({
  createElectronUpdateComposition: vi.fn(async () => ({})),
}));

import { createCompositionRoot } from "./composition-root.js";

describe("desktop composition workspace selection", () => {
  const originalWorkspace = process.env.SKILLS_DESKTOP_WORKSPACE;

  afterEach(() => {
    vi.restoreAllMocks();
    getPath.mockClear();
    fixture.capabilitiesOptions = undefined;
    if (originalWorkspace === undefined) {
      delete process.env.SKILLS_DESKTOP_WORKSPACE;
    } else {
      process.env.SKILLS_DESKTOP_WORKSPACE = originalWorkspace;
    }
  });

  it("uses the user home instead of the filesystem root after a Finder-style launch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-desktop-startup-"));
    fixture.home = directory;
    fixture.userData = join(directory, "user-data");
    delete process.env.SKILLS_DESKTOP_WORKSPACE;
    vi.spyOn(process, "cwd").mockReturnValue("/");

    try {
      await createCompositionRoot();

      const selected = fixture.capabilitiesOptions?.skillsTargets.primaryTarget;
      expect(selected).toMatchObject({
        workspace: await realpath(directory),
        workspaceLabel: basename(directory),
      });
      expect(getPath).toHaveBeenCalledWith("home");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("preserves an explicit workspace override after a root-directory launch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-desktop-explicit-"));
    fixture.home = join(directory, "unused-home");
    fixture.userData = join(directory, "user-data");
    process.env.SKILLS_DESKTOP_WORKSPACE = directory;
    vi.spyOn(process, "cwd").mockReturnValue("/");

    try {
      await createCompositionRoot();

      expect(
        fixture.capabilitiesOptions?.skillsTargets.primaryTarget,
      ).toMatchObject({
        workspace: await realpath(directory),
        workspaceLabel: basename(directory),
      });
      expect(getPath).not.toHaveBeenCalledWith("home");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
