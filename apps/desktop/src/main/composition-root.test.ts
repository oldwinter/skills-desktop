import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type TargetBinding = {
  readonly generation: number;
  readonly harnessIds: readonly string[];
  readonly kind: "local" | "ssh";
  readonly ssh?: unknown;
  readonly targetId: string;
  readonly workspace: string;
};

const fixture = vi.hoisted(() => ({
  capabilitiesOptions: undefined as
    | {
        readonly externalBrowser?: {
          readonly openExternal: (url: string) => Promise<void>;
        };
        readonly onReviewRequested?: unknown;
        readonly platform?: unknown;
        readonly skillsTargets: { readonly primaryTarget: unknown };
        readonly v1LocalOnlyTargets?: unknown;
      }
    | undefined,
  home: "",
  preferencesOptions: undefined as
    | { readonly systemLocaleTag?: () => string }
    | undefined,
  publisherOptions: undefined as
    | { readonly clock?: () => Date }
    | undefined,
  sshAccessOptions: undefined as
    | { readonly clock?: () => Date }
    | undefined,
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
  createOpenSshTargetAccess: vi.fn((options: unknown) => {
    fixture.sshAccessOptions = options as {
      readonly clock?: () => Date;
    };
    return {
      confirm: vi.fn(),
      inspect: vi.fn(),
      pendingChallenge: vi.fn(),
    };
  }),
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
const shellOpenExternal = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("electron", () => ({
  app: { getLocale: () => "en-US", getPath },
  autoUpdater: {},
  dialog: {},
  shell: { openExternal: shellOpenExternal },
}));

vi.mock("./adapters/local-skills-process.js", () => ({
  createLocalSkillsProcess: factories.createLocalSkillsProcess,
  createSpawnProcessRunner: factories.createSpawnProcessRunner,
}));

vi.mock("./application/preferences.js", () => ({
  createPreferenceAuthority: vi.fn(
    (options: { readonly systemLocaleTag?: () => string }) => {
      fixture.preferencesOptions = options;
      return { kind: "preferences" };
    },
  ),
}));

vi.mock("./git/git-publisher.js", () => ({
  createSystemGitPublisher: vi.fn(
    (options: { readonly clock?: () => Date }) => {
      fixture.publisherOptions = options;
      return { kind: "git-publisher" };
    },
  ),
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
          harnessIds: ["codex"],
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
    shellOpenExternal.mockClear();
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
        harnessIds: ["amp", "codex"],
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
            harnessIds: ["amp", "codex"],
            targetId: localBinding.targetId,
          },
          platform: process.platform,
          workspace: localBinding.workspace,
        }),
      );

      const sshBinding: TargetBinding = {
        generation: 3,
        harnessIds: ["codex"],
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
          harnessIds: ["codex"],
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

  it("delegates composed default providers to platform sources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-desktop-defaults-"));
    fixture.home = join(directory, "unused-home");
    fixture.userData = join(directory, "user-data");
    process.env.SKILLS_DESKTOP_WORKSPACE = directory;

    try {
      await createCompositionRoot();

      expect(fixture.preferencesOptions?.systemLocaleTag?.()).toBe("en-US");
      expect(fixture.sshAccessOptions?.clock?.()).toBeInstanceOf(Date);
      expect(fixture.publisherOptions?.clock?.()).toBeInstanceOf(Date);
      expect(fixture.capabilitiesOptions).toBeDefined();

      const capabilitiesClock = (
        fixture.capabilitiesOptions as unknown as {
          readonly clock?: () => Date;
          readonly id?: () => string;
        }
      );
      expect(capabilitiesClock.clock?.()).toBeInstanceOf(Date);
      expect(capabilitiesClock.id?.()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      const targetOptions = fixture.skillsTargetsOptions;
      const localProcess = targetOptions?.processFor({
        generation: 1,
        harnessIds: ["codex"],
        kind: "local",
        targetId: "00000000-0000-4000-8000-000000000001",
        workspace: await realpath(directory),
      }) as {
        readonly options: {
          readonly clock?: () => Date;
          readonly id?: () => string;
        };
      };
      expect(localProcess.options.clock?.()).toBeInstanceOf(Date);
      expect(localProcess.options.id?.()).toMatch(/^[0-9a-f-]{36}$/);

      const sshProcess = targetOptions?.processFor({
        generation: 3,
        harnessIds: ["codex"],
        kind: "ssh",
        ssh: { connectionReference: "build-host" },
        targetId: "00000000-0000-4000-8000-000000000002",
        workspace: "/srv/project",
      }) as {
        readonly options: {
          readonly clock?: () => Date;
          readonly id?: () => string;
        };
      };
      expect(sshProcess.options.clock?.()).toBeInstanceOf(Date);
      expect(sshProcess.options.id?.()).toMatch(/^[0-9a-f-]{36}$/);

      const restartSafety = (
        fixture.updateOptions as unknown as {
          readonly restartSafety?: () => { readonly guardReasons: string[] };
        }
      ).restartSafety;
      expect(restartSafety?.()).toEqual({ guardReasons: [] });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("opens only a canonical skills.sh URL through the process-edge allowlist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-desktop-browser-"));
    fixture.home = join(directory, "unused-home");
    fixture.userData = join(directory, "user-data");
    process.env.SKILLS_DESKTOP_WORKSPACE = directory;

    try {
      await createCompositionRoot();
      const openExternal = fixture.capabilitiesOptions?.externalBrowser
        ?.openExternal;
      expect(openExternal).toBeTypeOf("function");

      await openExternal!("https://skills.sh/vercel-labs/skills");
      expect(shellOpenExternal).toHaveBeenCalledWith(
        "https://skills.sh/vercel-labs/skills",
        { activate: true },
      );
      await openExternal!(
        "https://skills.sh/vercel-labs/skills/find-skills",
      );
      expect(shellOpenExternal).toHaveBeenLastCalledWith(
        "https://skills.sh/vercel-labs/skills/find-skills",
        { activate: true },
      );

      for (const refused of [
        "https://evil.example/vercel-labs/skills",
        "http://skills.sh/vercel-labs/skills",
        "https://skills.sh",
        "https://user:pw@skills.sh/vercel-labs/skills",
        "https://skills.sh/vercel-labs/skills?x=1",
        "not a url",
      ]) {
        await expect(openExternal!(refused)).rejects.toThrow();
      }
      expect(shellOpenExternal).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
