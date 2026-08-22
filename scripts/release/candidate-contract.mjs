import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";

import { z } from "zod";

const SUPPORTED_TARGETS = new Set([
  "darwin/arm64",
  "darwin/x64",
  "linux/x64",
  "win32/x64",
]);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const exactVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const buildOutputEntries = [
  "electron-main",
  "workspace-preload",
  "review-preload",
  "workspace-renderer",
  "review-renderer",
  "remote-bootstrap",
];
const releaseCredentialEnvironmentNames = [
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_ID",
  "APPLE_TEAM_ID",
  "AZURE_ARTIFACT_SIGNING_ACCOUNT",
  "AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "MACOS_CERTIFICATE",
  "MACOS_CERTIFICATE_PASSWORD",
  "WINDOWS_CERTIFICATE",
  "WINDOWS_CERTIFICATE_PASSWORD",
  "WIN_CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
];
const buildOutputSchema = z
  .object({
    entry: z.enum(buildOutputEntries),
    sha256: sha256Schema,
  })
  .strict();
const artifactSchema = z
  .object({
    fileName: z.string().min(1).max(256),
    kind: z.enum([
      "linux-deb",
      "linux-rpm",
      "macos-dmg",
      "macos-update-zip",
      "windows-full-nuget",
      "windows-releases-metadata",
      "windows-squirrel-installer",
    ]),
    sha256: sha256Schema,
    sizeBytes: z.number().int().positive(),
  })
  .strict();
const manifestInputSchema = z
  .object({
    architecture: z.enum(["arm64", "x64"]),
    artifacts: z.array(artifactSchema).min(1).max(3),
    buildInputs: z
      .object({
        electronVersion: exactVersionSchema,
        forgeVersion: exactVersionSchema,
        lockfileSha256: sha256Schema,
        nodeVersion: exactVersionSchema,
        remoteBootstrapDigest: sha256Schema,
        remoteBootstrapProtocolVersion: z.number().int().positive(),
      })
      .strict(),
    buildOutputs: z.array(buildOutputSchema).length(buildOutputEntries.length),
    platform: z.enum(["darwin", "linux", "win32"]),
    source: z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        repository: z
          .string()
          .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
          .max(256),
      })
      .strict(),
    version: exactVersionSchema,
    workflow: z
      .object({
        event: z.string().min(1).max(64),
        name: z.literal("Unsigned Release Candidates"),
        runAttempt: z.string().regex(/^[1-9]\d*$/),
        runId: z.string().regex(/^[1-9]\d*$/),
      })
      .strict(),
  })
  .strict();
const candidateArgumentNames = new Map([
  ["--architecture", "architecture"],
  ["--output-directory", "outputDirectory"],
  ["--platform", "platform"],
  ["--repository", "repository"],
  ["--source-commit", "sourceCommit"],
  ["--workflow-event", "workflowEvent"],
  ["--workflow-run-attempt", "workflowRunAttempt"],
  ["--workflow-run-id", "workflowRunId"],
]);
const candidateArgumentsSchema = z
  .object({
    architecture: z.enum(["arm64", "x64"]),
    outputDirectory: z
      .string()
      .min(1)
      .max(4_096)
      .refine((value) => !value.includes("\0")),
    platform: z.enum(["darwin", "linux", "win32"]),
    repository: manifestInputSchema.shape.source.shape.repository,
    sourceCommit: manifestInputSchema.shape.source.shape.commit,
    workflowEvent: z.string().min(1).max(64),
    workflowRunAttempt: z.string().regex(/^[1-9]\d*$/),
    workflowRunId: z.string().regex(/^[1-9]\d*$/),
  })
  .strict();

export function candidateArtifactPlan({ architecture, platform, version }) {
  if (!SUPPORTED_TARGETS.has(`${platform}/${architecture}`)) {
    throw new Error("Unsupported release candidate target.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("Release candidate versions must be exact SemVer values.");
  }

  const stem = `skills-desktop-${version}-${platform}-${architecture}`;
  if (platform === "darwin") {
    return [
      { fileName: `${stem}.dmg`, kind: "macos-dmg" },
      { fileName: `${stem}.zip`, kind: "macos-update-zip" },
    ];
  }
  if (platform === "win32") {
    return [
      {
        fileName: `${stem}-setup.exe`,
        kind: "windows-squirrel-installer",
      },
      {
        fileName: `skills_desktop-${version}-full.nupkg`,
        kind: "windows-full-nuget",
      },
      { fileName: "RELEASES", kind: "windows-releases-metadata" },
    ];
  }
  return [
    { fileName: `${stem}.deb`, kind: "linux-deb" },
    { fileName: `${stem}.rpm`, kind: "linux-rpm" },
  ];
}

export function parseCandidateArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const property = candidateArgumentNames.get(name);
    if (property === undefined) {
      throw new Error(`Unknown release candidate argument: ${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for release candidate argument: ${name}`);
    }
    if (Object.hasOwn(values, property)) {
      throw new Error(`Duplicate release candidate argument: ${name}`);
    }
    values[property] = value;
  }
  const parsed = candidateArgumentsSchema.parse(values);
  candidateArtifactPlan({
    architecture: parsed.architecture,
    platform: parsed.platform,
    version: "0.0.0",
  });
  return parsed;
}

export function createCandidateManifest(input) {
  const parsed = manifestInputSchema.parse(input);
  const plan = candidateArtifactPlan(parsed);
  const artifactsByKind = new Map(
    parsed.artifacts.map((artifact) => [artifact.kind, artifact]),
  );
  const artifacts = plan.map(({ fileName, kind }) => {
    const artifact = artifactsByKind.get(kind);
    if (artifact === undefined || artifact.fileName !== fileName) {
      throw new Error("Release candidate artifact evidence is incomplete.");
    }
    return artifact;
  });
  if (artifactsByKind.size !== plan.length) {
    throw new Error("Release candidate artifact evidence is not exact.");
  }

  const outputsByEntry = new Map(
    parsed.buildOutputs.map((output) => [output.entry, output]),
  );
  const buildOutputs = buildOutputEntries.map((entry) => {
    const output = outputsByEntry.get(entry);
    if (output === undefined) {
      throw new Error("Release build output evidence is incomplete.");
    }
    return output;
  });
  if (outputsByEntry.size !== buildOutputEntries.length) {
    throw new Error("Release build output evidence is not exact.");
  }

  return {
    architecture: parsed.architecture,
    artifacts,
    buildInputs: parsed.buildInputs,
    buildOutputs,
    candidateUse: "local-or-internal-only",
    platform: parsed.platform,
    schemaVersion: 1,
    signingStatus: "unsigned",
    source: parsed.source,
    version: parsed.version,
    workflow: parsed.workflow,
  };
}

export function serializeCandidateManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function assertPublicReleaseEligible(_manifest) {
  // Issue #23 has no signing identity, provider enrollment, or publication authority.
  throw new Error(
    "Stable publication is unavailable: signing and provider enrollment are deferred.",
  );
}

export function assertUnsignedCandidateEnvironment(environment) {
  if (
    releaseCredentialEnvironmentNames.some(
      (name) => environment[name] !== undefined && environment[name] !== "",
    )
  ) {
    throw new Error(
      "Unsigned candidate jobs cannot receive release credentials.",
    );
  }
}

async function listMakerFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("Release maker outputs cannot contain symbolic links.");
    }
    if (entry.isDirectory()) {
      files.push(...(await listMakerFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function isPlatformArtifact(path, platform) {
  const extension = extname(path).toLocaleLowerCase("en-US");
  if (platform === "darwin") {
    return extension === ".dmg" || extension === ".zip";
  }
  if (platform === "win32") {
    return (
      extension === ".exe" ||
      extension === ".msi" ||
      extension === ".nupkg" ||
      basename(path) === "RELEASES" ||
      basename(path) === "RELEASES.json"
    );
  }
  return extension === ".deb" || extension === ".rpm";
}

function sourceMatchesKind(path, kind) {
  const fileName = basename(path);
  switch (kind) {
    case "linux-deb":
      return fileName.endsWith(".deb");
    case "linux-rpm":
      return fileName.endsWith(".rpm");
    case "macos-dmg":
      return fileName.endsWith(".dmg");
    case "macos-update-zip":
      return fileName.endsWith(".zip");
    case "windows-full-nuget":
      return fileName.endsWith("-full.nupkg");
    case "windows-releases-metadata":
      return fileName === "RELEASES";
    case "windows-squirrel-installer":
      return fileName.endsWith(".exe");
  }
}

async function digestFile(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

async function digestDirectory(path) {
  const files = (await listMakerFiles(path)).sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  if (files.length === 0) {
    throw new Error("Standalone release build output is incomplete.");
  }
  const digest = createHash("sha256");
  for (const file of files) {
    const relativePath = relative(path, file).split(sep).join("/");
    const fileStat = await stat(file);
    digest.update(relativePath);
    digest.update("\0");
    digest.update(await digestFile(file));
    digest.update("\0");
    digest.update(String(fileStat.size));
    digest.update("\n");
  }
  return digest.digest("hex");
}

export async function collectBuildOutputEvidence({
  desktopDistDirectory,
  remoteBootstrapProgram,
}) {
  const outputs = [
    {
      entry: "electron-main",
      path: join(desktopDistDirectory, "main", "index.js"),
      type: "file",
    },
    {
      entry: "workspace-preload",
      path: join(desktopDistDirectory, "preload", "workspace.cjs"),
      type: "file",
    },
    {
      entry: "review-preload",
      path: join(desktopDistDirectory, "preload", "review.cjs"),
      type: "file",
    },
    {
      entry: "workspace-renderer",
      path: join(desktopDistDirectory, "renderer"),
      type: "directory",
    },
    {
      entry: "review-renderer",
      path: join(desktopDistDirectory, "review-renderer"),
      type: "directory",
    },
  ];
  try {
    const evidence = [];
    for (const output of outputs) {
      evidence.push({
        entry: output.entry,
        sha256:
          output.type === "file"
            ? await digestFile(output.path)
            : await digestDirectory(output.path),
      });
    }
    evidence.push({
      entry: "remote-bootstrap",
      sha256: createHash("sha256")
        .update(remoteBootstrapProgram)
        .digest("hex"),
    });
    return evidence;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Standalone release build output is incomplete."
    ) {
      throw error;
    }
    throw new Error("Standalone release build output is incomplete.", {
      cause: error,
    });
  }
}

export async function stageCandidateArtifacts({
  architecture,
  candidateDirectory,
  makeDirectory,
  platform,
  version,
}) {
  const plan = candidateArtifactPlan({ architecture, platform, version });
  const makerFiles = (await listMakerFiles(makeDirectory)).filter((path) =>
    isPlatformArtifact(path, platform),
  );
  const sources = plan.map(({ kind }) => {
    const matches = makerFiles.filter((path) => sourceMatchesKind(path, kind));
    if (matches.length !== 1) {
      throw new Error("Forge did not emit the exact release artifact set.");
    }
    return matches[0];
  });
  if (new Set(sources).size !== makerFiles.length) {
    throw new Error("Forge emitted an unexpected release artifact.");
  }

  await mkdir(dirname(candidateDirectory), { recursive: true });
  try {
    await mkdir(candidateDirectory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "EEXIST") {
        throw new Error("Release candidate directories are immutable.");
      }
    }
    throw error;
  }

  try {
    const evidence = [];
    for (const [index, artifact] of plan.entries()) {
      const source = sources[index];
      if (source === undefined) {
        throw new Error("Forge did not emit the exact release artifact set.");
      }
      const destination = join(candidateDirectory, artifact.fileName);
      await copyFile(source, destination);
      const fileStat = await stat(destination);
      if (!fileStat.isFile() || fileStat.size === 0) {
        throw new Error("Forge emitted an empty release artifact.");
      }
      evidence.push({
        ...artifact,
        sha256: await digestFile(destination),
        sizeBytes: fileStat.size,
      });
    }
    return evidence;
  } catch (error) {
    await rm(candidateDirectory, { force: true, recursive: true });
    throw error;
  }
}
