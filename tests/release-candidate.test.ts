import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import forgeConfig from "../apps/desktop/forge.config.js";
import {
  assertPublicReleaseEligible,
  assertUnsignedCandidateEnvironment,
  candidateArtifactPlan,
  collectBuildOutputEvidence,
  createCandidateManifest,
  parseCandidateArguments,
  serializeCandidateManifest,
  stageCandidateArtifacts,
} from "../scripts/release/candidate-contract.mjs";

const linuxManifestInput = () => {
  const buildOutputs = [
    "electron-main",
    "workspace-preload",
    "review-preload",
    "workspace-renderer",
    "review-renderer",
    "remote-bootstrap",
  ].map((entry, index) => ({
    entry,
    sha256: String(index + 1).repeat(64),
  }));
  return {
    architecture: "x64",
    artifacts: [
      {
        fileName: "skills-desktop-0.1.0-linux-x64.rpm",
        kind: "linux-rpm",
        sha256: "b".repeat(64),
        sizeBytes: 202,
      },
      {
        fileName: "skills-desktop-0.1.0-linux-x64.deb",
        kind: "linux-deb",
        sha256: "a".repeat(64),
        sizeBytes: 101,
      },
    ],
    buildInputs: {
      electronVersion: "43.4.1",
      forgeVersion: "7.11.2",
      lockfileSha256: "c".repeat(64),
      nodeVersion: "24.19.0",
      remoteBootstrapDigest: "d".repeat(64),
      remoteBootstrapProtocolVersion: 1,
    },
    buildOutputs,
    platform: "linux",
    source: {
      commit: "e".repeat(40),
      repository: "oldwinter/skills-desktop",
    },
    version: "0.1.0",
    workflow: {
      event: "push",
      name: "Unsigned Release Candidates",
      runAttempt: "2",
      runId: "123456",
    },
  } as const;
};

describe("unsigned release candidate contract", () => {
  it("provides the package metadata required by native makers", async () => {
    const desktopPackage = JSON.parse(
      await readFile(
        new URL("../apps/desktop/package.json", import.meta.url),
        "utf8",
      ),
    );

    expect(desktopPackage).toMatchObject({
      description:
        "Cross-platform desktop client for inspecting and managing agent Skills.",
      name: "@skills-desktop/desktop",
      productName: "Skills Desktop",
      version: "0.1.0",
    });
    const linuxMakers = Array.isArray(forgeConfig.makers)
      ? forgeConfig.makers.filter((maker) =>
          ["@electron-forge/maker-deb", "@electron-forge/maker-rpm"].includes(
            maker.name,
          ),
        )
      : [];
    expect(linuxMakers).toHaveLength(2);
    expect(linuxMakers).toEqual(
      linuxMakers.map((maker) =>
        expect.objectContaining({
          config: expect.objectContaining({
            options: expect.objectContaining({
              bin: "skills-desktop",
              name: "skills-desktop",
            }),
          }),
        }),
      ),
    );
  });

  it.each([
    {
      architecture: "arm64",
      expected: [
        {
          fileName: "skills-desktop-0.1.0-darwin-arm64.dmg",
          kind: "macos-dmg",
        },
        {
          fileName: "skills-desktop-0.1.0-darwin-arm64.zip",
          kind: "macos-update-zip",
        },
      ],
      platform: "darwin",
    },
    {
      architecture: "x64",
      expected: [
        {
          fileName: "skills-desktop-0.1.0-darwin-x64.dmg",
          kind: "macos-dmg",
        },
        {
          fileName: "skills-desktop-0.1.0-darwin-x64.zip",
          kind: "macos-update-zip",
        },
      ],
      platform: "darwin",
    },
    {
      architecture: "x64",
      expected: [
        {
          fileName: "skills-desktop-0.1.0-win32-x64-setup.exe",
          kind: "windows-squirrel-installer",
        },
        {
          fileName: "skills_desktop-0.1.0-full.nupkg",
          kind: "windows-full-nuget",
        },
        { fileName: "RELEASES", kind: "windows-releases-metadata" },
      ],
      platform: "win32",
    },
    {
      architecture: "x64",
      expected: [
        {
          fileName: "skills-desktop-0.1.0-linux-x64.deb",
          kind: "linux-deb",
        },
        {
          fileName: "skills-desktop-0.1.0-linux-x64.rpm",
          kind: "linux-rpm",
        },
      ],
      platform: "linux",
    },
  ] as const)(
    "defines the official $platform/$architecture maker shapes",
    ({ architecture, expected, platform }) => {
      expect(
        candidateArtifactPlan({ architecture, platform, version: "0.1.0" }),
      ).toEqual(expected);
    },
  );

  it("serializes one immutable manifest from normalized build evidence", () => {
    const shared = linuxManifestInput();

    const manifest = createCandidateManifest(shared);
    expect(manifest).toEqual({
      architecture: "x64",
      artifacts: [
        {
          fileName: "skills-desktop-0.1.0-linux-x64.deb",
          kind: "linux-deb",
          sha256: "a".repeat(64),
          sizeBytes: 101,
        },
        {
          fileName: "skills-desktop-0.1.0-linux-x64.rpm",
          kind: "linux-rpm",
          sha256: "b".repeat(64),
          sizeBytes: 202,
        },
      ],
      buildInputs: shared.buildInputs,
      buildOutputs: shared.buildOutputs,
      candidateUse: "local-or-internal-only",
      platform: "linux",
      schemaVersion: 1,
      signingStatus: "unsigned",
      source: shared.source,
      version: "0.1.0",
      workflow: shared.workflow,
    });
    expect(serializeCandidateManifest(manifest)).toBe(
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    expect(createCandidateManifest(shared)).toEqual(manifest);
  });

  it("fails every stable or public publication attempt closed", () => {
    const manifest = createCandidateManifest(linuxManifestInput());

    expect(() => assertPublicReleaseEligible(manifest)).toThrowError(
      "Stable publication is unavailable: signing and provider enrollment are deferred.",
    );
    expect(() =>
      assertPublicReleaseEligible({
        ...manifest,
        candidateUse: "public-stable",
        signingStatus: "signed",
      }),
    ).toThrowError(
      "Stable publication is unavailable: signing and provider enrollment are deferred.",
    );
  });

  it("rejects signing and publication credentials without disclosing them", () => {
    const secretSentinel = "credential-sentinel-do-not-print";

    expect(() =>
      assertUnsignedCandidateEnvironment({
        APPLE_API_KEY: secretSentinel,
        PATH: "/usr/bin",
      }),
    ).toThrowError("Unsigned candidate jobs cannot receive release credentials.");
    try {
      assertUnsignedCandidateEnvironment({ APPLE_API_KEY: secretSentinel });
    } catch (error) {
      expect(String(error)).not.toContain(secretSentinel);
    }
    expect(() =>
      assertUnsignedCandidateEnvironment({ PATH: "/usr/bin" }),
    ).not.toThrow();
  });

  it("stages exact maker outputs with deterministic names and digest evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-candidate-"));
    const makeDirectory = join(directory, "make");
    const candidateDirectory = join(directory, "candidate");
    try {
      await mkdir(join(makeDirectory, "deb", "x64"), { recursive: true });
      await mkdir(join(makeDirectory, "rpm", "x64"), { recursive: true });
      await writeFile(
        join(makeDirectory, "deb", "x64", "forge-output.deb"),
        "deb-bytes",
      );
      await writeFile(
        join(makeDirectory, "rpm", "x64", "forge-output.rpm"),
        "rpm-bytes",
      );

      await expect(
        stageCandidateArtifacts({
          architecture: "x64",
          candidateDirectory,
          makeDirectory,
          platform: "linux",
          version: "0.1.0",
        }),
      ).resolves.toEqual([
        {
          fileName: "skills-desktop-0.1.0-linux-x64.deb",
          kind: "linux-deb",
          sha256:
            "3adc870b6595ccbffaa9ccaa6fa5653652136fbeea99ffd754c52960bd0b9ea9",
          sizeBytes: 9,
        },
        {
          fileName: "skills-desktop-0.1.0-linux-x64.rpm",
          kind: "linux-rpm",
          sha256:
            "e262f1de2c38fd96cb1a8a8410f58222f0e0b5681b84217b877e78c114eb9a31",
          sizeBytes: 9,
        },
      ]);
      await expect(
        readFile(
          join(
            candidateDirectory,
            "skills-desktop-0.1.0-linux-x64.deb",
          ),
          "utf8",
        ),
      ).resolves.toBe("deb-bytes");
      await expect(
        stageCandidateArtifacts({
          architecture: "x64",
          candidateDirectory,
          makeDirectory,
          platform: "linux",
          version: "0.1.0",
        }),
      ).rejects.toThrow("Release candidate directories are immutable.");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("parses only explicit unsigned candidate generation inputs", () => {
    const sourceCommit = "f".repeat(40);
    const argv = [
      "--platform",
      "darwin",
      "--architecture",
      "arm64",
      "--output-directory",
      "/tmp/internal-candidates",
      "--repository",
      "oldwinter/skills-desktop",
      "--source-commit",
      sourceCommit,
      "--workflow-event",
      "workflow_dispatch",
      "--workflow-run-attempt",
      "1",
      "--workflow-run-id",
      "98765",
    ];

    expect(parseCandidateArguments(argv)).toEqual({
      architecture: "arm64",
      outputDirectory: "/tmp/internal-candidates",
      platform: "darwin",
      repository: "oldwinter/skills-desktop",
      sourceCommit,
      workflowEvent: "workflow_dispatch",
      workflowRunAttempt: "1",
      workflowRunId: "98765",
    });
    expect(() =>
      parseCandidateArguments([...argv, "--publish", "stable"]),
    ).toThrow("Unknown release candidate argument: --publish");
  });

  it("binds every explicit standalone build output before packaging", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-build-evidence-"));
    try {
      await mkdir(join(directory, "main"), { recursive: true });
      await mkdir(join(directory, "preload"), { recursive: true });
      await mkdir(join(directory, "renderer", "assets"), { recursive: true });
      await mkdir(join(directory, "review-renderer", "assets"), {
        recursive: true,
      });
      await writeFile(join(directory, "main", "index.js"), "main");
      await writeFile(
        join(directory, "preload", "workspace.cjs"),
        "workspace-preload",
      );
      await writeFile(
        join(directory, "preload", "review.cjs"),
        "review-preload",
      );
      await writeFile(join(directory, "renderer", "index.html"), "workspace");
      await writeFile(
        join(directory, "renderer", "assets", "index.js"),
        "workspace-renderer",
      );
      await writeFile(
        join(directory, "review-renderer", "index.html"),
        "review",
      );
      await writeFile(
        join(directory, "review-renderer", "assets", "index.js"),
        "review-renderer",
      );

      const evidence = await collectBuildOutputEvidence({
        desktopDistDirectory: directory,
        remoteBootstrapProgram: "bootstrap",
      });
      expect(evidence.map(({ entry }) => entry)).toEqual([
        "electron-main",
        "workspace-preload",
        "review-preload",
        "workspace-renderer",
        "review-renderer",
        "remote-bootstrap",
      ]);
      expect(evidence).toEqual(
        evidence.map((output) => ({
          entry: output.entry,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        })),
      );
      expect(evidence.at(-1)).toEqual({
        entry: "remote-bootstrap",
        sha256:
          "333c04dd151a2a6831c039cb9a651df29198be8a04e16ce861d4b6a34a11c954",
      });
      await rm(join(directory, "review-renderer"), {
        force: true,
        recursive: true,
      });
      await expect(
        collectBuildOutputEvidence({
          desktopDistDirectory: directory,
          remoteBootstrapProgram: "bootstrap",
        }),
      ).rejects.toThrow("Standalone release build output is incomplete.");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
