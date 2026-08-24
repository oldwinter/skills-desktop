import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import mainConfig from "../apps/desktop/vite.main.config.js";
import preloadConfig from "../apps/desktop/vite.preload.config.js";
import rendererConfig from "../apps/desktop/vite.renderer.config.js";
import reviewPreloadConfig from "../apps/desktop/vite.review-preload.config.js";
import reviewRendererConfig from "../apps/desktop/vite.review-renderer.config.js";
import remoteBootstrapConfig from "../packages/remote-bootstrap/vite.release.config.js";
import {
  buildCandidate,
  runCandidateCommand,
  runCandidateNpm,
} from "../scripts/release/build-candidate.mjs";
import {
  emitReleaseOutputs,
  parseReleaseIntegrityOptions,
  readReleaseJson,
  releaseContext,
  runReleaseIntegrityCommand,
} from "../scripts/release/release-integrity-cli.mjs";
import coverageConfig from "../vitest.config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const sourceCommit = "a".repeat(40);
const candidateArgv = [
  "--architecture",
  "x64",
  "--output-directory",
  "candidate-output",
  "--platform",
  "linux",
  "--repository",
  "oldwinter/skills-desktop",
  "--source-commit",
  sourceCommit,
  "--workflow-event",
  "push",
  "--workflow-run-attempt",
  "2",
  "--workflow-run-id",
  "12345",
];

function candidateHarness({
  bootstrapDigest,
  checkedOutCommit = sourceCommit,
  dirty = "",
  versions = ["0.1.0", "0.1.0", "0.1.0", "0.1.0"],
}: {
  readonly bootstrapDigest?: string;
  readonly checkedOutCommit?: string;
  readonly dirty?: string;
  readonly versions?: readonly string[];
} = {}) {
  const root = join(tmpdir(), "skills-desktop-candidate-entrypoint");
  const bootstrapProgram = "console.log('fixed bootstrap')";
  const calculatedDigest = createHash("sha256")
    .update(bootstrapProgram)
    .digest("hex");
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
  const npmCalls: Array<{ args: string[]; environment: Record<string, string> }> = [];
  const removals: string[] = [];
  const writes: Array<{
    data: string | Uint8Array;
    options?: { flag?: string };
    path: string;
  }> = [];
  const commandCalls: Array<{
    args: string[];
    command: string;
    options: Record<string, unknown>;
  }> = [];
  const output: string[] = [];
  const packageValues = [
    { version: versions[0] },
    {
      devDependencies: {
        "@electron-forge/cli": "7.11.2",
        electron: "43.4.1",
      },
      version: versions[1],
    },
    { version: versions[2] },
    { version: versions[3] },
  ];
  let packageIndex = 0;
  return {
    commandCalls,
    npmCalls,
    output,
    removals,
    root,
    services: {
      collectBuildOutputs: vi.fn(async () => buildOutputs),
      loadBootstrap: vi.fn(async () => ({
        REMOTE_BOOTSTRAP_PROGRAM: bootstrapProgram,
        describeRemoteBootstrap: () => ({
          digest: bootstrapDigest ?? calculatedDigest,
          protocolVersion: 1,
        }),
      })),
      readJson: vi.fn(async () => packageValues[packageIndex++]),
      remove: vi.fn(async (path: string) => {
        removals.push(path);
      }),
      runCommand: vi.fn(
        async (
          command: string,
          args: string[],
          options: Record<string, unknown>,
        ) => {
          commandCalls.push({ args, command, options });
          if (args[0] === "rev-parse") return checkedOutCommit;
          if (args[0] === "status") return dirty;
          if (args[0] === "cat-file") return Buffer.from("fixed-lockfile\n");
          throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        },
      ),
      runNpm: vi.fn(
        async (args: string[], environment: Record<string, string>) => {
          npmCalls.push({ args, environment });
        },
      ),
      stageArtifacts: vi.fn(async () => [
        {
          fileName: "skills-desktop-0.1.0-linux-x64.deb",
          kind: "linux-deb",
          sha256: "b".repeat(64),
          sizeBytes: 101,
        },
        {
          fileName: "skills-desktop-0.1.0-linux-x64.rpm",
          kind: "linux-rpm",
          sha256: "c".repeat(64),
          sizeBytes: 202,
        },
      ]),
      writeFile: vi.fn(
        async (
          path: string,
          data: string | Uint8Array,
          options?: { flag?: string },
        ) => {
          writes.push({ data, options, path });
        },
      ),
      writeOutput: vi.fn((value: string) => output.push(value)),
    },
    writes,
  };
}

describe("release candidate executable entrypoint", () => {
  it("orchestrates one native clean-tree build into immutable manifest bytes", async () => {
    const harness = candidateHarness();
    const environment = { PATH: "/fixture/bin" };

    const result = await buildCandidate({
      argv: candidateArgv,
      environment,
      nativePlatform: "linux",
      nodeVersion: "24.19.0",
      root: harness.root,
      services: harness.services,
    });

    expect(result).toEqual({
      candidateDirectory: join(
        harness.root,
        "candidate-output",
        "skills-desktop-0.1.0-linux-x64",
      ),
      manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(harness.commandCalls.map(({ args }) => args)).toEqual([
      ["rev-parse", "HEAD"],
      ["status", "--short", "--untracked-files=all"],
      ["cat-file", "blob", `${sourceCommit}:package-lock.json`],
    ]);
    expect(
      harness.commandCalls.every(
        ({ options }) =>
          options.cwd === harness.root && options.environment === environment,
      ),
    ).toBe(true);
    expect(harness.npmCalls.map(({ args }) => args)).toEqual([
      ["run", "build", "--workspace", "@skills-desktop/skills-runtime"],
      ["run", "build", "--workspace", "@skills-desktop/remote-bootstrap"],
      ["run", "build", "--workspace", "@skills-desktop/desktop"],
      [
        "exec",
        "--workspace",
        "@skills-desktop/desktop",
        "electron-forge",
        "make",
        "--",
        "--platform=linux",
        "--arch=x64",
      ],
    ]);
    expect(
      harness.npmCalls.every(
        ({ environment: candidateEnvironment }) =>
          candidateEnvironment.PATH === environment.PATH &&
          candidateEnvironment.CSC_IDENTITY_AUTO_DISCOVERY === "false",
      ),
    ).toBe(true);
    expect(harness.removals).toEqual([
      join(harness.root, "apps/desktop/dist"),
      join(harness.root, "apps/desktop/out"),
    ]);
    expect(harness.writes).toHaveLength(3);
    expect(harness.writes.every(({ options }) => options?.flag === "wx")).toBe(
      true,
    );
    const manifestWrite = harness.writes.find(({ path }) =>
      path.endsWith("candidate-manifest-v1.json"),
    );
    if (manifestWrite === undefined) throw new Error("Manifest write is missing.");
    expect(JSON.parse(String(manifestWrite?.data))).toMatchObject({
      buildInputs: {
        lockfileSha256: createHash("sha256")
          .update("fixed-lockfile\n")
          .digest("hex"),
        nodeVersion: "24.19.0",
      },
      candidateUse: "unsigned-preview-only",
      signingStatus: "unsigned",
      source: { commit: sourceCommit },
    });
    expect(
      createHash("sha256").update(manifestWrite.data).digest("hex"),
    ).toBe(result.manifestDigest);
    expect(
      harness.writes.find(({ path }) =>
        path.endsWith("candidate-manifest-v1.sha256"),
      ),
    ).toMatchObject({
      data: `${result.manifestDigest}  candidate-manifest-v1.json\n`,
    });
    expect(
      harness.writes.find(({ path }) => path.endsWith("remote-bootstrap.json")),
    ).toMatchObject({
      data: `${JSON.stringify(
        {
          digest: createHash("sha256")
            .update("console.log('fixed bootstrap')")
            .digest("hex"),
          protocolVersion: 1,
          schemaVersion: 1,
        },
        null,
        2,
      )}\n`,
    });
    expect(harness.output).toEqual([`${JSON.stringify(result)}\n`]);
  });

  it.each([
    {
      expected: "native platform",
      harness: {},
      nativePlatform: "darwin",
    },
    {
      expected: "share one immutable version",
      harness: { versions: ["0.1.0", "0.1.0", "0.1.0", "0.2.0"] },
      nativePlatform: "linux",
    },
    {
      expected: "does not match the checked-out commit",
      harness: { checkedOutCommit: "b".repeat(40) },
      nativePlatform: "linux",
    },
    {
      expected: "clean tracked source tree",
      harness: { dirty: " M package.json" },
      nativePlatform: "linux",
    },
    {
      expected: "build digest does not bind",
      harness: { bootstrapDigest: "0".repeat(64) },
      nativePlatform: "linux",
    },
  ])("fails closed when release state does not $expected", async (scenario) => {
    const harness = candidateHarness(scenario.harness);
    await expect(
      buildCandidate({
        argv: candidateArgv,
        environment: { PATH: "/fixture/bin" },
        nativePlatform: scenario.nativePlatform,
        nodeVersion: "24.19.0",
        root: harness.root,
        services: harness.services,
      }),
    ).rejects.toThrow(scenario.expected);
  });

  it("requires npm ownership and forwards argument arrays through Node", async () => {
    await expect(
      runCandidateNpm(["run", "build"], {}, { npmExecutable: "" }),
    ).rejects.toThrow("must run through npm");
    const runCommand = vi.fn(async () => "");
    await runCandidateNpm(["run", "build"], { PATH: "/bin" }, {
      npmExecutable: "/fixture/npm-cli.js",
      root: "/fixture/repository",
      runCommand,
    });
    expect(runCommand).toHaveBeenCalledWith(
      process.execPath,
      ["/fixture/npm-cli.js", "run", "build"],
      {
        cwd: "/fixture/repository",
        environment: { PATH: "/bin" },
      },
    );
  });

  it("captures command output as text or bytes and rejects nonzero exits", async () => {
    await expect(
      runCandidateCommand(
        process.execPath,
        ["-e", "process.stdout.write('  candidate  ')"] ,
        { capture: true, cwd: process.cwd() },
      ),
    ).resolves.toBe("candidate");
    await expect(
      runCandidateCommand(
        process.execPath,
        ["-e", "process.stdout.write('bytes')"],
        { capture: "buffer", cwd: process.cwd() },
      ),
    ).resolves.toEqual(Buffer.from("bytes"));
    await expect(
      runCandidateCommand(process.execPath, ["-e", "process.exit(7)"], {
        capture: true,
        cwd: process.cwd(),
      }),
    ).rejects.toThrow("exit 7");
  });
});

describe("release integrity executable entrypoint", () => {
  it("parses an exact option set into release context", () => {
    const options = parseReleaseIntegrityOptions(
      [
        "--repository",
        "oldwinter/skills-desktop",
        "--source-commit",
        sourceCommit,
        "--workflow-event",
        "push",
        "--workflow-name",
        "Unsigned Release Candidates",
        "--workflow-run-attempt",
        "2",
        "--workflow-run-id",
        "12345",
      ],
      [
        "--repository",
        "--source-commit",
        "--workflow-event",
        "--workflow-name",
        "--workflow-run-attempt",
        "--workflow-run-id",
      ],
    );

    expect(releaseContext(options)).toEqual({
      repository: "oldwinter/skills-desktop",
      sourceCommit,
      workflowEvent: "push",
      workflowName: "Unsigned Release Candidates",
      workflowRunAttempt: "2",
      workflowRunId: "12345",
    });
  });

  it.each([
    {
      allowed: ["--known"],
      argv: ["--unknown", "value"],
      expected: "Unknown",
    },
    { allowed: ["--known"], argv: ["--known"], expected: "Invalid" },
    {
      allowed: ["--known"],
      argv: ["--known", "--other"],
      expected: "Invalid",
    },
    {
      allowed: ["--known"],
      argv: ["--known", "bad\0value"],
      expected: "Invalid",
    },
    {
      allowed: ["--known"],
      argv: ["--known", "bad\rvalue"],
      expected: "Invalid",
    },
    {
      allowed: ["--known"],
      argv: ["--known", "bad\nvalue"],
      expected: "Invalid",
    },
    {
      allowed: ["--known"],
      argv: ["--known", "one", "--known", "two"],
      expected: "Duplicate",
    },
    {
      allowed: ["--known", "--required"],
      argv: ["--known", "value"],
      expected: "Missing",
    },
  ])("rejects malformed option vectors", ({ allowed, argv, expected }) => {
    expect(() => parseReleaseIntegrityOptions(argv, allowed)).toThrow(expected);
  });

  it("encodes scalar and multiline GitHub outputs without shell interpolation", async () => {
    const append = vi.fn(async () => undefined);
    await emitReleaseOutputs(
      { "subject-paths": "one\ntwo", version: "0.1.0" },
      { append, outputPath: "/fixture/github-output" },
    );

    expect(append).toHaveBeenCalledWith(
      "/fixture/github-output",
      "subject-paths<<SKILLS_DESKTOP_SUBJECT_PATHS_EOF\none\ntwo\nSKILLS_DESKTOP_SUBJECT_PATHS_EOF\nversion=0.1.0\n",
    );
    append.mockClear();
    await emitReleaseOutputs({ version: "0.1.0" }, { append, outputPath: "" });
    expect(append).not.toHaveBeenCalled();
  });

  it.each([
    {
      outputs: { value: "bad\rvalue" },
      expected: "carriage return",
    },
    {
      outputs: {
        value: "line\nSKILLS_DESKTOP_VALUE_EOF\ncollision",
      },
      expected: "delimiter collision",
    },
  ])("rejects unsafe GitHub output encoding", async ({ expected, outputs }) => {
    await expect(
      emitReleaseOutputs(outputs, {
        append: vi.fn(async () => undefined),
        outputPath: "/fixture/github-output",
      }),
    ).rejects.toThrow(expected);
  });

  it("reads structured JSON with a stable public failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-cli-json-"));
    temporaryDirectories.push(root);
    const valid = join(root, "valid.json");
    const invalid = join(root, "invalid.json");
    await writeFile(valid, '{"ok":true}\n');
    await writeFile(invalid, "not-json");

    await expect(readReleaseJson(valid, "invalid evidence")).resolves.toEqual({
      ok: true,
    });
    await expect(readReleaseJson(invalid, "invalid evidence")).rejects.toThrow(
      "invalid evidence",
    );
  });

  it("dispatches one exact command and emits one JSON result", async () => {
    const handler = vi.fn(async (argv: string[]) => ({ argv, ok: true }));
    const output: string[] = [];

    await expect(
      runReleaseIntegrityCommand(["fixed", "--value", "one"], {
        commandHandlers: new Map([["fixed", handler]]),
        writeOutput: (value: string) => output.push(value),
      }),
    ).resolves.toEqual({ argv: ["--value", "one"], ok: true });
    expect(output).toEqual([
      '{"argv":["--value","one"],"ok":true}\n',
    ]);
    await expect(
      runReleaseIntegrityCommand(["unknown"], {
        commandHandlers: new Map(),
      }),
    ).rejects.toThrow("Unknown release integrity command: unknown");
  });

  it("writes preview notes and structured workflow outputs through the real command", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-cli-notes-"));
    temporaryDirectories.push(root);
    const outputPath = join(root, "release-notes.md");
    const githubOutputPath = join(root, "github-output");
    const output: string[] = [];
    vi.stubEnv("GITHUB_OUTPUT", githubOutputPath);

    const result = await runReleaseIntegrityCommand(
      [
        "notes",
        "--candidate-set-digest",
        "b".repeat(64),
        "--evidence-set-digest",
        "c".repeat(64),
        "--output-path",
        outputPath,
        "--payload-digest",
        "d".repeat(64),
        "--repository",
        "oldwinter/skills-desktop",
        "--source-commit",
        sourceCommit,
        "--version",
        "0.1.0",
        "--workflow-run-url",
        "https://github.com/oldwinter/skills-desktop/actions/runs/12345",
      ],
      { writeOutput: (value: string) => output.push(value) },
    );

    expect(result).toEqual({
      name: "Skills Desktop 0.1.0 unsigned developer preview aaaaaaaaaaaa",
      tag: `preview-v0.1.0-${sourceCommit}`,
    });
    expect(await readFile(outputPath, "utf8")).toContain(
      "# UNSIGNED DEVELOPER PREVIEW",
    );
    expect(await readFile(githubOutputPath, "utf8")).toBe(
      `release-name=${result.name}\nrelease-tag=${result.tag}\n`,
    );
    expect(output).toEqual([`${JSON.stringify(result)}\n`]);
  });

  it("preflights the exact staged payload bytes through the real command", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-cli-payload-"));
    temporaryDirectories.push(root);
    const payloadRoot = join(root, "payload");
    await mkdir(payloadRoot);
    const bytes = "candidate bytes\n";
    const fileName = "candidate.zip";
    await writeFile(join(payloadRoot, fileName), bytes);
    const fileDigest = createHash("sha256").update(bytes).digest("hex");
    const payloadDigest = createHash("sha256")
      .update(`${fileDigest} *${fileName}\n`)
      .digest("hex");
    const output: string[] = [];

    await expect(
      runReleaseIntegrityCommand(
        [
          "preflight-draft",
          "--payload-digest",
          payloadDigest,
          "--payload-root",
          payloadRoot,
        ],
        { writeOutput: (value: string) => output.push(value) },
      ),
    ).resolves.toEqual({ assetCount: 1, payloadDigest });
    expect(output).toEqual([
      `${JSON.stringify({ assetCount: 1, payloadDigest })}\n`,
    ]);
  });

  it("validates attestation JSON with optional exact predicate evidence", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "skills-release-cli-attestation-"),
    );
    temporaryDirectories.push(root);
    const expectedPredicate = {
      candidateSetDigest: "b".repeat(64),
      schemaVersion: 1,
    };
    const predicateType =
      "https://github.com/oldwinter/skills-desktop/attestations/unsigned-candidate/v1";
    const subjects = [
      { fileName: "candidate.zip", sha256: "c".repeat(64) },
    ];
    const result = [
      {
        verificationResult: {
          statement: {
            predicate: expectedPredicate,
            predicateType,
            subject: [
              {
                digest: { sha256: subjects[0]!.sha256 },
                name: `candidate-inputs/package/${subjects[0]!.fileName}`,
              },
            ],
          },
        },
      },
    ];
    const expectedPredicatePath = join(root, "predicate.json");
    const resultPath = join(root, "result.json");
    const subjectsPath = join(root, "subjects.json");
    await Promise.all([
      writeFile(expectedPredicatePath, JSON.stringify(expectedPredicate)),
      writeFile(resultPath, JSON.stringify(result)),
      writeFile(subjectsPath, JSON.stringify({ subjects })),
    ]);
    const baseArguments = [
      "--predicate-type",
      predicateType,
      "--result-json",
      resultPath,
      "--subjects-json",
      subjectsPath,
    ];

    for (const argv of [
      [
        "verify-attestation",
        "--expected-predicate",
        expectedPredicatePath,
        ...baseArguments,
      ],
      ["verify-attestation", ...baseArguments],
    ]) {
      const output: string[] = [];
      await expect(
        runReleaseIntegrityCommand(argv, {
          writeOutput: (value: string) => output.push(value),
        }),
      ).resolves.toEqual({ predicateType, subjectCount: 1 });
      expect(output).toEqual([
        `${JSON.stringify({ predicateType, subjectCount: 1 })}\n`,
      ]);
    }
  });
});

describe("production build configuration coverage", () => {
  it("binds every packaged entrypoint to its intended production output", () => {
    expect(mainConfig).toMatchObject({
      build: { outDir: expect.stringMatching(/dist[/\\]main$/) },
    });
    expect(preloadConfig).toMatchObject({
      build: {
        lib: { entry: expect.stringMatching(/preload[/\\]workspace\.ts$/) },
        outDir: expect.stringMatching(/dist[/\\]preload$/),
      },
    });
    expect(preloadConfig.build?.lib).not.toBeInstanceOf(Array);
    const workspaceFileName = (preloadConfig.build?.lib as { fileName: () => string })
      .fileName;
    expect(workspaceFileName()).toBe("workspace.cjs");
    expect(reviewPreloadConfig).toMatchObject({
      build: {
        emptyOutDir: false,
        lib: { entry: expect.stringMatching(/preload[/\\]review\.ts$/) },
      },
    });
    const reviewFileName = (
      reviewPreloadConfig.build?.lib as { fileName: () => string }
    ).fileName;
    expect(reviewFileName()).toBe("review.cjs");
    expect(rendererConfig).toMatchObject({
      base: "./",
      root: expect.stringMatching(/src[/\\]renderer$/),
    });
    expect(reviewRendererConfig).toMatchObject({
      base: "./",
      root: expect.stringMatching(/src[/\\]review-renderer$/),
    });
    expect(remoteBootstrapConfig).toMatchObject({
      build: {
        outDir: expect.stringMatching(/dist[/\\]release$/),
        ssr: expect.stringMatching(/src[/\\]index\.ts$/),
      },
      ssr: { target: "node" },
    });
  });

  it("keeps the coverage denominator explicit and free of substring exclusions", () => {
    const coverage = coverageConfig.test?.coverage as {
      exclude: string[];
      include: string[];
      thresholds: Record<string, number>;
    };
    expect(coverage.include).toEqual([
      "apps/*/src/**/*.{ts,tsx}",
      "apps/desktop/forge.config.ts",
      "apps/desktop/vite.*.config.ts",
      "packages/*/src/**/*.{ts,tsx}",
      "packages/remote-bootstrap/vite.release.config.ts",
      "scripts/release/*.mjs",
    ]);
    expect(coverage.exclude).toEqual([
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.d.ts",
    ]);
    expect(coverage.thresholds).toEqual({
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    });
  });
});
