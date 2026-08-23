import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type TargetBinding = {
  readonly generation: number;
  readonly harness: string;
  readonly kind: "local" | "ssh";
  readonly ssh?: unknown;
  readonly targetId: string;
  readonly workspace: string;
};

const fixture = vi.hoisted(() => ({
  capabilitiesOptions: undefined as
    | {
        readonly onReviewRequested?: unknown;
        readonly platform?: unknown;
        readonly skillsTargets: { readonly primaryTarget: unknown };
        readonly v1LocalOnlyTargets?: unknown;
      }
    | undefined,
  home: "",
  skillsTargetsOptions: undefined as
    | {
        readonly processFor: (binding: TargetBinding) => unknown;
        readonly workspace: string;
      }
    | undefined,
  updateOptions: undefined as
    | {
        readonly architecture?: string;
        readonly app?: unknown;
        readonly platform?: NodeJS.Platform;
        readonly releaseChannel?: string;
        readonly restartSafety?: unknown;
      }
    | undefined,
  userData: "",
}));

const factories = vi.hoisted(() => ({
  createLocalSkillsProcess: vi.fn((options: unknown) => ({
    kind: "local-process",
    options,
  })),
  createOpenSshHostKeyProbe: vi.fn(() => ({ scan: vi.fn() })),
  createOpenSshTargetAccess: vi.fn(() => ({
    confirm: vi.fn(),
    inspect: vi.fn(),
    pendingChallenge: vi.fn(),
  })),
  createOpenSshToolRunner: vi.fn(() => ({ run: vi.fn() })),
  createSshSkillsProcess: vi.fn((options: unknown) => ({
    kind: "ssh-process",
    options,
  })),
  createSshTransportRunner: vi.fn(() => ({ run: vi.fn() })),
  createSpawnProcessRunner: vi.fn(() => ({ run: vi.fn() })),
}));

const getPath = vi.hoisted(() =>
  vi.fn((name: string) => (name === "home" ? fixture.home : fixture.userData)),
);

vi.mock("electron", () => ({
  app: { getPath },
  autoUpdater: {},
  dialog: {},
}));

vi.mock("./adapters/local-skills-process.js", () => ({
  createLocalSkillsProcess: factories.createLocalSkillsProcess,
  createSpawnProcessRunner: factories.createSpawnProcessRunner,
}));

vi.mock("./adapters/ssh-skills-process.js", () => ({
  createSshSkillsProcess: factories.createSshSkillsProcess,
  createSshTransportRunner: factories.createSshTransportRunner,
}));

vi.mock("./ssh/openssh-target.js", () => ({
  createOpenSshHostKeyProbe: factories.createOpenSshHostKeyProbe,
  createOpenSshTargetAccess: factories.createOpenSshTargetAccess,
  createOpenSshToolRunner: factories.createOpenSshToolRunner,
}));

vi.mock("./targets/local-skills-targets.js", () => ({
  createLocalSkillsTargets: vi.fn(
    (options: {
      readonly processFor: (binding: TargetBinding) => unknown;
      readonly workspace: string;
    }) => {
      fixture.skillsTargetsOptions = options;
      return {
        primaryTarget: {
          connectionReference: null,
          generation: 1,
          harness: "Codex",
          id: "00000000-0000-4000-8000-000000000001",
          kind: "local",
          label: "This device",
          workspace: options.workspace,
          workspaceLabel: basename(options.workspace),
        },
      };
    },
  ),
}));

vi.mock("./application/desktop-capabilities.js", () => ({
  createDesktopCapabilities: vi.fn(
    (options: {
      readonly skillsTargets: { readonly primaryTarget: unknown };
      readonly onReviewRequested?: unknown;
      readonly platform?: unknown;
      readonly v1LocalOnlyTargets?: unknown;
    }) => {
      fixture.capabilitiesOptions = options;
      return {
        initialize: vi.fn(async () => undefined),
        restartSafety: vi.fn(() => ({ guardReasons: [] })),
      };
    },
  ),
}));

vi.mock("./update-composition.js", () => ({
  createElectronUpdateComposition: vi.fn(
    async (options: {
      readonly architecture?: string;
      readonly app?: unknown;
      readonly platform?: NodeJS.Platform;
      readonly releaseChannel?: string;
      readonly restartSafety?: unknown;
    }) => {
      fixture.updateOptions = options;
      return {};
    },
  ),
}));

import { createCompositionRoot } from "./composition-root.js";

describe("desktop composition workspace selection", () => {
  const originalWorkspace = process.env.SKILLS_DESKTOP_WORKSPACE;

  afterEach(() => {
    vi.restoreAllMocks();
    getPath.mockClear();
    fixture.capabilitiesOptions = undefined;
    fixture.skillsTargetsOptions = undefined;
    fixture.updateOptions = undefined;
    for (const factory of Object.values(factories)) factory.mockClear();
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
      expect(fixture.updateOptions).toMatchObject({
        releaseChannel: "unsigned-preview",
      });
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

  it("treats an empty workspace override like an unset override", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-desktop-empty-"));
    fixture.home = directory;
    fixture.userData = join(directory, "user-data");
    process.env.SKILLS_DESKTOP_WORKSPACE = "";
    vi.spyOn(process, "cwd").mockReturnValue("/");

    try {
      await createCompositionRoot();

      expect(
        fixture.capabilitiesOptions?.skillsTargets.primaryTarget,
      ).toMatchObject({
        workspace: await realpath(directory),
        workspaceLabel: basename(directory),
      });
      expect(getPath).toHaveBeenCalledWith("home");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("uses the launch directory when it is already a local workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-desktop-launch-"));
    fixture.home = join(directory, "unused-home");
    fixture.userData = join(directory, "user-data");
    delete process.env.SKILLS_DESKTOP_WORKSPACE;
    vi.spyOn(process, "cwd").mockReturnValue(directory);

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

  it("passes platform defaults and selects the local or SSH process factory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-desktop-factories-"));
    fixture.home = join(directory, "unused-home");
    fixture.userData = join(directory, "user-data");
    process.env.SKILLS_DESKTOP_WORKSPACE = directory;
    const onReviewRequested = vi.fn();

    try {
      await createCompositionRoot({ onReviewRequested });

      const targetOptions = fixture.skillsTargetsOptions;
      expect(targetOptions).toBeDefined();
      expect(targetOptions?.workspace).toBe(await realpath(directory));
      expect(factories.createSpawnProcessRunner).toHaveBeenCalledWith({
        platform: process.platform,
      });
      expect(factories.createSshTransportRunner).toHaveBeenCalledWith({
        platform: process.platform,
      });

      const localBinding: TargetBinding = {
        generation: 1,
        harness: "Codex",
        kind: "local",
        targetId: "00000000-0000-4000-8000-000000000001",
        workspace: await realpath(directory),
      };
      const localProcess = targetOptions?.processFor(localBinding);
      expect(localProcess).toMatchObject({ kind: "local-process" });
      expect(factories.createLocalSkillsProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          binding: {
            generation: 1,
            harness: "Codex",
            targetId: localBinding.targetId,
          },
          platform: process.platform,
          workspace: localBinding.workspace,
        }),
      );

      const sshBinding: TargetBinding = {
        generation: 3,
        harness: "Codex",
        kind: "ssh",
        ssh: { connectionReference: "build-host" },
        targetId: "00000000-0000-4000-8000-000000000002",
        workspace: "/srv/project",
      };
      const sshProcess = targetOptions?.processFor(sshBinding);
      expect(sshProcess).toMatchObject({ kind: "ssh-process" });
      expect(factories.createSshSkillsProcess).toHaveBeenCalledWith({
        binding: {
          generation: 3,
          harness: "Codex",
          kind: "ssh",
          ssh: sshBinding.ssh,
          targetId: sshBinding.targetId,
          workspace: sshBinding.workspace,
        },
        clock: expect.any(Function),
        id: expect.any(Function),
        runner: expect.any(Object),
      });

      expect(fixture.capabilitiesOptions).toMatchObject({
        onReviewRequested,
        platform: process.platform,
        v1LocalOnlyTargets: true,
      });
      expect(fixture.updateOptions).toMatchObject({
        architecture: process.arch,
        platform: process.platform,
        releaseChannel: "unsigned-preview",
        app: expect.any(Object),
        restartSafety: expect.any(Function),
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
