import { createHash } from "node:crypto";
import { COPYFILE_EXCL, createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const sha256Pattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^\d+\.\d+\.\d+$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const targetArtifacts = new Map([
  [
    "darwin/arm64",
    [
      ["macos-dmg", ({ stem }) => `${stem}.dmg`],
      ["macos-update-zip", ({ stem }) => `${stem}.zip`],
    ],
  ],
  [
    "darwin/x64",
    [
      ["macos-dmg", ({ stem }) => `${stem}.dmg`],
      ["macos-update-zip", ({ stem }) => `${stem}.zip`],
    ],
  ],
  [
    "linux/x64",
    [
      ["linux-deb", ({ stem }) => `${stem}.deb`],
      ["linux-rpm", ({ stem }) => `${stem}.rpm`],
    ],
  ],
  [
    "win32/x64",
    [
      ["windows-squirrel-installer", ({ stem }) => `${stem}-setup.exe`],
      [
        "windows-full-nuget",
        ({ version }) => `skills_desktop-${version}-full.nupkg`,
      ],
      ["windows-releases-metadata", () => "RELEASES"],
    ],
  ],
]);

const expectedTargetKeys = [...targetArtifacts.keys()].sort();
const expectedBuildOutputs = [
  "electron-main",
  "workspace-preload",
  "review-preload",
  "workspace-renderer",
  "review-renderer",
  "remote-bootstrap",
];

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value, keys, message) {
  if (!isPlainObject(value)) {
    fail(message);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(message);
  }
}

function assertString(value, pattern, message) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(message);
  }
}

function artifactPlan({ architecture, platform, version }) {
  const definitions = targetArtifacts.get(`${platform}/${architecture}`);
  if (definitions === undefined || !versionPattern.test(version)) {
    fail("Release candidate manifest target is unsupported.");
  }
  const stem = `skills-desktop-${version}-${platform}-${architecture}`;
  return definitions.map(([kind, fileName]) => ({
    fileName: fileName({ stem, version }),
    kind,
  }));
}

function parseCandidateManifest(value, expected) {
  assertExactKeys(
    value,
    [
      "architecture",
      "artifacts",
      "buildInputs",
      "buildOutputs",
      "candidateUse",
      "platform",
      "schemaVersion",
      "signingStatus",
      "source",
      "version",
      "workflow",
    ],
    "Release candidate manifest schema is invalid.",
  );
  if (
    !["arm64", "x64"].includes(value.architecture) ||
    !["darwin", "linux", "win32"].includes(value.platform) ||
    value.schemaVersion !== 1 ||
    value.candidateUse !== "local-or-internal-only" ||
    value.signingStatus !== "unsigned"
  ) {
    fail("Release candidate manifest schema is invalid.");
  }
  assertString(
    value.version,
    versionPattern,
    "Release candidate manifest schema is invalid.",
  );

  assertExactKeys(
    value.source,
    ["commit", "repository"],
    "Release candidate source identity is invalid.",
  );
  assertString(
    value.source.commit,
    commitPattern,
    "Release candidate source identity is invalid.",
  );
  assertString(
    value.source.repository,
    repositoryPattern,
    "Release candidate source identity is invalid.",
  );
  if (
    value.source.commit !== expected.sourceCommit ||
    value.source.repository !== expected.repository
  ) {
    fail("Release candidate source identity does not match this workflow.");
  }

  assertExactKeys(
    value.workflow,
    ["event", "name", "runAttempt", "runId"],
    "Release candidate workflow identity is invalid.",
  );
  const workflowValues = {
    event: expected.workflowEvent,
    name: expected.workflowName,
    runAttempt: expected.workflowRunAttempt,
    runId: expected.workflowRunId,
  };
  if (
    !Object.entries(workflowValues).every(
      ([key, expectedValue]) => value.workflow[key] === expectedValue,
    )
  ) {
    fail("Release candidate workflow identity does not match this workflow.");
  }

  assertExactKeys(
    value.buildInputs,
    [
      "electronVersion",
      "forgeVersion",
      "lockfileSha256",
      "nodeVersion",
      "remoteBootstrapDigest",
      "remoteBootstrapProtocolVersion",
    ],
    "Release candidate build inputs are invalid.",
  );
  for (const name of ["electronVersion", "forgeVersion", "nodeVersion"]) {
    assertString(
      value.buildInputs[name],
      versionPattern,
      "Release candidate build inputs are invalid.",
    );
  }
  for (const name of ["lockfileSha256", "remoteBootstrapDigest"]) {
    assertString(
      value.buildInputs[name],
      sha256Pattern,
      "Release candidate build inputs are invalid.",
    );
  }
  if (
    !Number.isInteger(value.buildInputs.remoteBootstrapProtocolVersion) ||
    value.buildInputs.remoteBootstrapProtocolVersion < 1
  ) {
    fail("Release candidate build inputs are invalid.");
  }

  if (!Array.isArray(value.buildOutputs)) {
    fail("Release candidate build outputs are invalid.");
  }
  const buildOutputs = new Map();
  for (const output of value.buildOutputs) {
    assertExactKeys(
      output,
      ["entry", "sha256"],
      "Release candidate build outputs are invalid.",
    );
    if (
      !expectedBuildOutputs.includes(output.entry) ||
      !sha256Pattern.test(output.sha256) ||
      buildOutputs.has(output.entry)
    ) {
      fail("Release candidate build outputs are invalid.");
    }
    buildOutputs.set(output.entry, output.sha256);
  }
  if (
    buildOutputs.size !== expectedBuildOutputs.length ||
    expectedBuildOutputs.some((entry) => !buildOutputs.has(entry))
  ) {
    fail("Release candidate build outputs are invalid.");
  }

  const plan = artifactPlan(value);
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== plan.length) {
    fail("Release candidate artifact evidence is incomplete.");
  }
  const artifacts = value.artifacts.map((artifact, index) => {
    assertExactKeys(
      artifact,
      ["fileName", "kind", "sha256", "sizeBytes"],
      "Release candidate artifact evidence is invalid.",
    );
    const expectedArtifact = plan[index];
    if (
      expectedArtifact === undefined ||
      artifact.fileName !== expectedArtifact.fileName ||
      artifact.kind !== expectedArtifact.kind ||
      !sha256Pattern.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.sizeBytes) ||
      artifact.sizeBytes < 1
    ) {
      fail("Release candidate artifact evidence is invalid.");
    }
    return artifact;
  });

  return { ...value, artifacts };
}

async function digestFile(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readCandidatePackage(path, expected) {
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    fail("Release candidate packages may contain only regular files.");
  }
  const fileNames = entries.map((entry) => entry.name).sort(compareNames);
  const manifestName = "candidate-manifest-v1.json";
  const manifestBytes = await readFile(join(path, manifestName));
  const manifestDigest = createHash("sha256").update(manifestBytes).digest("hex");
  if (basename(path) !== `unsigned-package-${manifestDigest}`) {
    fail("Release candidate package is not addressed by its manifest digest.");
  }
  const checksumName = "candidate-manifest-v1.sha256";
  if (
    (await readFile(join(path, checksumName), "utf8")) !==
    `${manifestDigest}  ${manifestName}\n`
  ) {
    fail("Release candidate manifest checksum is invalid.");
  }
  let parsed;
  try {
    parsed = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("Release candidate manifest is not valid JSON.");
  }
  const manifest = parseCandidateManifest(parsed, expected);
  const expectedFileNames = [
    ...manifest.artifacts.map((artifact) => artifact.fileName),
    checksumName,
    manifestName,
  ].sort(compareNames);
  if (
    fileNames.length !== expectedFileNames.length ||
    fileNames.some((fileName, index) => fileName !== expectedFileNames[index])
  ) {
    fail("Release candidate package contains an unexpected file set.");
  }

  const artifacts = [];
  for (const artifact of manifest.artifacts) {
    const artifactPath = join(path, artifact.fileName);
    const artifactStat = await stat(artifactPath);
    if (
      !artifactStat.isFile() ||
      artifactStat.size !== artifact.sizeBytes ||
      (await digestFile(artifactPath)) !== artifact.sha256
    ) {
      fail("Release candidate artifact bytes do not match the manifest.");
    }
    artifacts.push({
      ...artifact,
      architecture: manifest.architecture,
      candidateManifestDigest: manifestDigest,
      path: artifactPath,
      platform: manifest.platform,
      version: manifest.version,
    });
  }
  return { artifacts, manifest, manifestBytes, manifestDigest };
}

async function readCandidateSet(candidateRoot, expected) {
  const entries = await readdir(candidateRoot, { withFileTypes: true });
  if (entries.some((entry) => !entry.isDirectory())) {
    fail("Release candidate input contains an unexpected entry.");
  }
  const packages = [];
  for (const entry of entries) {
    packages.push(
      await readCandidatePackage(join(candidateRoot, entry.name), expected),
    );
  }
  const targetKeys = packages
    .map(({ manifest }) => `${manifest.platform}/${manifest.architecture}`)
    .sort();
  if (
    targetKeys.length !== expectedTargetKeys.length ||
    targetKeys.some((key, index) => key !== expectedTargetKeys[index])
  ) {
    fail("Release candidate target set is incomplete or duplicated.");
  }
  const versions = new Set(packages.map(({ manifest }) => manifest.version));
  if (versions.size !== 1) {
    fail("Release candidates must share one immutable version.");
  }
  const artifacts = packages
    .flatMap((candidatePackage) => candidatePackage.artifacts)
    .sort((left, right) => compareNames(left.fileName, right.fileName));
  if (new Set(artifacts.map(({ fileName }) => fileName)).size !== artifacts.length) {
    fail("Release candidate artifact names must be globally unique.");
  }
  return {
    artifacts,
    packages,
    version: packages[0].manifest.version,
  };
}

async function assertCandidateLockfile(candidateSet, packageLockPath) {
  const packageLockBytes = await readFile(packageLockPath);
  const packageLockDigest = createHash("sha256")
    .update(packageLockBytes)
    .digest("hex");
  if (
    candidateSet.packages.some(
      ({ manifest }) =>
        manifest.buildInputs.lockfileSha256 !== packageLockDigest,
    )
  ) {
    fail("Release candidate lockfile digest does not match this checkout.");
  }
  return packageLockBytes;
}

function bindCandidateSetDigest(candidateSet) {
  const checksumBytes = candidateSet.artifacts
    .map(({ fileName, sha256 }) => `${sha256} *${fileName}\n`)
    .join("");
  return {
    ...candidateSet,
    candidateSetDigest: createHash("sha256")
      .update(checksumBytes)
      .digest("hex"),
    checksumBytes,
  };
}

export async function identifyCandidatePackage({
  candidateRoot,
  expected,
  expectedArchitecture,
  expectedPlatform,
  packageLockPath,
}) {
  const entries = await readdir(candidateRoot, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) {
    fail("Package job must emit exactly one candidate package directory.");
  }
  const candidateDirectory = join(candidateRoot, entries[0].name);
  const candidatePackage = await readCandidatePackage(
    candidateDirectory,
    expected,
  );
  const candidateSet = {
    artifacts: candidatePackage.artifacts,
    packages: [candidatePackage],
    version: candidatePackage.manifest.version,
  };
  await assertCandidateLockfile(candidateSet, packageLockPath);
  if (
    candidatePackage.manifest.platform !== expectedPlatform ||
    candidatePackage.manifest.architecture !== expectedArchitecture
  ) {
    fail("Package job candidate target does not match its matrix identity.");
  }
  return {
    architecture: candidatePackage.manifest.architecture,
    candidateDirectory,
    manifestDigest: candidatePackage.manifestDigest,
    platform: candidatePackage.manifest.platform,
    version: candidatePackage.manifest.version,
  };
}

export async function inspectCandidateSubjects({
  candidateRoot,
  expected,
  packageLockPath,
}) {
  const candidateSet = bindCandidateSetDigest(
    await readCandidateSet(candidateRoot, expected),
  );
  await assertCandidateLockfile(candidateSet, packageLockPath);
  return {
    candidateSetDigest: candidateSet.candidateSetDigest,
    subjects: candidateSet.artifacts.map(({ fileName, path, sha256 }) => ({
      fileName,
      path,
      sha256,
    })),
    version: candidateSet.version,
  };
}

function packageNameFromLockPath(path, entry) {
  if (typeof entry.name === "string" && entry.name !== "") {
    return entry.name;
  }
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index === -1 ? undefined : path.slice(index + marker.length);
}

function packageChecksum(integrity) {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
    return undefined;
  }
  try {
    return Buffer.from(integrity.slice("sha512-".length), "base64").toString(
      "hex",
    );
  } catch {
    return undefined;
  }
}

function createSpdxDocument({ artifacts, candidateSetDigest, createdAt, lock, version }) {
  if (
    !isPlainObject(lock) ||
    lock.lockfileVersion !== 3 ||
    !isPlainObject(lock.packages)
  ) {
    fail("Release package lock is unsupported.");
  }
  const artifactPackages = artifacts.map((artifact, index) => ({
    SPDXID: `SPDXRef-Package-Candidate-${index + 1}`,
    checksums: [{ algorithm: "SHA256", checksumValue: artifact.sha256 }],
    copyrightText: "NOASSERTION",
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: "NOASSERTION",
    name: artifact.fileName,
    versionInfo: version,
  }));
  const dependencyEntries = Object.entries(lock.packages)
    .filter(
      ([path, entry]) =>
        path !== "" &&
        isPlainObject(entry) &&
        (entry.dev !== true || path === "node_modules/electron") &&
        typeof entry.version === "string",
    )
    .map(([path, entry]) => ({
      entry,
      name: packageNameFromLockPath(path, entry),
      path,
    }))
    .filter(({ name }) => typeof name === "string")
    .sort((left, right) => compareNames(left.name, right.name));
  const seenDependencies = new Set();
  const dependencyPackages = [];
  for (const { entry, name } of dependencyEntries) {
    const identity = `${name}@${entry.version}`;
    if (seenDependencies.has(identity)) {
      continue;
    }
    seenDependencies.add(identity);
    const checksum = packageChecksum(entry.integrity);
    dependencyPackages.push({
      SPDXID: `SPDXRef-Package-Dependency-${dependencyPackages.length + 1}`,
      ...(checksum === undefined
        ? {}
        : { checksums: [{ algorithm: "SHA512", checksumValue: checksum }] }),
      copyrightText: "NOASSERTION",
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded:
        typeof entry.license === "string" ? entry.license : "NOASSERTION",
      licenseDeclared:
        typeof entry.license === "string" ? entry.license : "NOASSERTION",
      name,
      versionInfo: entry.version,
    });
  }
  const desktopPackage = dependencyPackages.find(
    ({ name }) => name === "@skills-desktop/desktop",
  );
  const relationships = artifactPackages.map((artifactPackage) => ({
    relatedSpdxElement: artifactPackage.SPDXID,
    relationshipType: "DESCRIBES",
    spdxElementId: "SPDXRef-DOCUMENT",
  }));
  if (desktopPackage !== undefined) {
    relationships.push(
      ...artifactPackages.map((artifactPackage) => ({
        relatedSpdxElement: desktopPackage.SPDXID,
        relationshipType: "CONTAINS",
        spdxElementId: artifactPackage.SPDXID,
      })),
    );
    relationships.push(
      ...dependencyPackages
        .filter(({ SPDXID }) => SPDXID !== desktopPackage.SPDXID)
        .map((dependencyPackage) => ({
          relatedSpdxElement: dependencyPackage.SPDXID,
          relationshipType: "DEPENDS_ON",
          spdxElementId: desktopPackage.SPDXID,
        })),
    );
  }
  return {
    SPDXID: "SPDXRef-DOCUMENT",
    creationInfo: {
      created: new Date(createdAt).toISOString(),
      creators: ["Tool: skills-desktop-release-integrity/1"],
    },
    dataLicense: "CC0-1.0",
    documentDescribes: artifactPackages.map(({ SPDXID }) => SPDXID),
    documentNamespace: `https://github.com/oldwinter/skills-desktop/releases/candidates/${candidateSetDigest}`,
    name: `Skills Desktop ${version} unsigned candidate SBOM`,
    packages: [...artifactPackages, ...dependencyPackages],
    relationships,
    spdxVersion: "SPDX-2.3",
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function evidenceFilePlan(version) {
  return new Map([
    ["SHA256SUMS", "candidate-checksums"],
    ["candidate-provenance-v1.json", "candidate-provenance"],
    [
      `skills-desktop-${version}.spdx.json`,
      "spdx-sbom",
    ],
    ...["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"].flatMap(
      (target) => [
        [`candidate-manifest-v1-${target}.json`, "candidate-manifest"],
        [
          `candidate-manifest-v1-${target}.sha256`,
          "candidate-manifest-checksum",
        ],
      ],
    ),
    [
      "attestation-candidate-identity.sigstore.json",
      "candidate-identity-attestation",
    ],
    ["attestation-provenance.sigstore.json", "provenance-attestation"],
    ["attestation-sbom.sigstore.json", "sbom-attestation"],
  ]);
}

async function assertExactRegularFiles(root, expectedNames, message) {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    fail(message);
  }
  const actualNames = entries.map(({ name }) => name).sort(compareNames);
  const sortedExpectedNames = [...expectedNames].sort(compareNames);
  if (
    actualNames.length !== sortedExpectedNames.length ||
    actualNames.some(
      (fileName, index) => fileName !== sortedExpectedNames[index],
    )
  ) {
    fail(message);
  }
}

export async function finalizeReleaseEvidence({
  attestationBundles,
  evidenceRoot,
  expectedCandidateSetDigest,
}) {
  assertExactKeys(
    attestationBundles,
    ["candidateIdentity", "provenance", "sbom"],
    "Release attestation bundle set is invalid.",
  );
  const predicatePath = join(evidenceRoot, "candidate-provenance-v1.json");
  let predicate;
  try {
    predicate = JSON.parse(await readFile(predicatePath, "utf8"));
  } catch {
    fail("Release candidate provenance evidence is invalid.");
  }
  if (
    !isPlainObject(predicate) ||
    predicate.schemaVersion !== 1 ||
    predicate.candidateSetDigest !== expectedCandidateSetDigest ||
    typeof predicate.version !== "string" ||
    !versionPattern.test(predicate.version)
  ) {
    fail("Release candidate provenance evidence is invalid.");
  }
  const filePlan = evidenceFilePlan(predicate.version);
  const bundleNames = new Map([
    [
      "candidateIdentity",
      "attestation-candidate-identity.sigstore.json",
    ],
    ["provenance", "attestation-provenance.sigstore.json"],
    ["sbom", "attestation-sbom.sigstore.json"],
  ]);
  const preAttestationNames = [...filePlan.keys()].filter(
    (fileName) => !fileName.startsWith("attestation-"),
  );
  await assertExactRegularFiles(
    evidenceRoot,
    preAttestationNames,
    "Release evidence contains an unexpected pre-attestation file set.",
  );
  const validatedBundles = [];
  const bundleDigests = new Set();
  for (const [key, destinationName] of bundleNames) {
    const source = attestationBundles[key];
    if (typeof source !== "string") {
      fail("Release attestation bundle set is invalid.");
    }
    let bundle;
    try {
      const sourceStat = await stat(source);
      if (!sourceStat.isFile() || sourceStat.size < 1) {
        fail("Release attestation bundle is invalid.");
      }
      bundle = JSON.parse(await readFile(source, "utf8"));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Release attestation bundle is invalid."
      ) {
        throw error;
      }
      fail("Release attestation bundle is invalid.");
    }
    if (!isPlainObject(bundle)) {
      fail("Release attestation bundle is invalid.");
    }
    const digest = await digestFile(source);
    if (bundleDigests.has(digest)) {
      fail("Release attestation bundles must be distinct.");
    }
    bundleDigests.add(digest);
    validatedBundles.push({ destinationName, source });
  }
  for (const { destinationName, source } of validatedBundles) {
    await copyFile(source, join(evidenceRoot, destinationName), COPYFILE_EXCL);
  }
  await assertExactRegularFiles(
    evidenceRoot,
    filePlan.keys(),
    "Release evidence contains an unexpected file set.",
  );
  const files = [];
  for (const [fileName, kind] of [...filePlan].sort(([left], [right]) =>
    compareNames(left, right),
  )) {
    const path = join(evidenceRoot, fileName);
    const fileStat = await stat(path);
    files.push({
      fileName,
      kind,
      sha256: await digestFile(path),
      sizeBytes: fileStat.size,
    });
  }
  const evidenceSetDigest = createHash("sha256")
    .update(
      files
        .map(({ fileName, sha256 }) => `${sha256} *${fileName}\n`)
        .join(""),
    )
    .digest("hex");
  await writeJson(join(evidenceRoot, "candidate-evidence-v1.json"), {
    candidateSetDigest: expectedCandidateSetDigest,
    evidenceSetDigest,
    files,
    schemaVersion: 1,
    version: predicate.version,
  });
  const indexPath = join(evidenceRoot, "candidate-evidence-v1.json");
  const indexStat = await stat(indexPath);
  const evidenceArtifactFiles = [
    ...files,
    {
      fileName: "candidate-evidence-v1.json",
      sha256: await digestFile(indexPath),
      sizeBytes: indexStat.size,
    },
  ].sort((left, right) => compareNames(left.fileName, right.fileName));
  const evidenceArtifactDigest = createHash("sha256")
    .update(
      evidenceArtifactFiles
        .map(({ fileName, sha256 }) => `${sha256} *${fileName}\n`)
        .join(""),
    )
    .digest("hex");
  return {
    candidateSetDigest: expectedCandidateSetDigest,
    evidenceArtifactDigest,
    evidenceSetDigest,
    version: predicate.version,
  };
}

export const SLSA_PROVENANCE_PREDICATE_TYPE =
  "https://slsa.dev/provenance/v1";
export const SPDX_PREDICATE_TYPE = "https://spdx.dev/Document/v2.3";
export const CANDIDATE_IDENTITY_PREDICATE_TYPE =
  "https://github.com/oldwinter/skills-desktop/attestations/unsigned-candidate/v1";

export function draftReleaseTag({ sourceCommit, version }) {
  assertString(
    sourceCommit,
    commitPattern,
    "Draft release identity is invalid.",
  );
  assertString(version, versionPattern, "Draft release identity is invalid.");
  return `candidate-v${version}-${sourceCommit}`;
}

export function draftReleaseName({ sourceCommit, version }) {
  return `Skills Desktop ${version} unsigned candidate ${draftReleaseTag({
    sourceCommit,
    version,
  }).slice(-12)}`;
}

export function createDraftReleaseNotes({
  candidateSetDigest,
  evidenceSetDigest,
  payloadDigest,
  repository,
  sourceCommit,
  version,
  workflowRunUrl,
}) {
  for (const digest of [
    candidateSetDigest,
    evidenceSetDigest,
    payloadDigest,
  ]) {
    assertString(digest, sha256Pattern, "Draft release notes are invalid.");
  }
  assertString(
    repository,
    repositoryPattern,
    "Draft release notes are invalid.",
  );
  assertString(
    sourceCommit,
    commitPattern,
    "Draft release notes are invalid.",
  );
  assertString(version, versionPattern, "Draft release notes are invalid.");
  if (
    typeof workflowRunUrl !== "string" ||
    workflowRunUrl !==
      `https://github.com/${repository}/actions/runs/${workflowRunUrl.split("/").at(-1)}` ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9]\d*$/.test(
      workflowRunUrl,
    )
  ) {
    fail("Draft release notes are invalid.");
  }
  return [
    "# UNSIGNED PRIVATE DRAFT",
    "",
    "This candidate is unsigned, unpublished, private to collaborators, and not stable-eligible.",
    "It must not be represented as signed or promoted to a public or stable release.",
    "",
    `- Version: \`${version}\``,
    `- Source commit: \`${sourceCommit}\``,
    `- Candidate set SHA-256: \`${candidateSetDigest}\``,
    `- Evidence set SHA-256: \`${evidenceSetDigest}\``,
    `- Verified payload SHA-256: \`${payloadDigest}\``,
    `- Workflow run: ${workflowRunUrl}`,
    "",
    "Apple/Windows signing, notarization, Authenticode, production approval, stable publication, and stable-feed activation remain deferred human gates under issue #22.",
    "",
  ].join("\n");
}

async function inspectDraftPayload(payloadRoot) {
  const entries = await readdir(payloadRoot, { withFileTypes: true });
  if (entries.length === 0 || entries.some((entry) => !entry.isFile())) {
    fail("Verified draft payload contains an unexpected entry.");
  }
  const assets = [];
  for (const fileName of entries.map(({ name }) => name).sort(compareNames)) {
    const path = join(payloadRoot, fileName);
    const fileStat = await stat(path);
    assets.push({
      fileName,
      sha256: await digestFile(path),
      sizeBytes: fileStat.size,
    });
  }
  const payloadDigest = createHash("sha256")
    .update(
      assets
        .map(({ fileName, sha256 }) => `${sha256} *${fileName}\n`)
        .join(""),
    )
    .digest("hex");
  return { assets, payloadDigest };
}

export async function verifyDraftPayload({ expectedPayloadDigest, payloadRoot }) {
  assertString(
    expectedPayloadDigest,
    sha256Pattern,
    "Verified draft payload digest is invalid.",
  );
  const payload = await inspectDraftPayload(payloadRoot);
  if (payload.payloadDigest !== expectedPayloadDigest) {
    fail("Verified draft payload bytes changed during job exchange.");
  }
  return payload;
}

export async function verifyGitHubDraftRelease({
  expected,
  payloadRoot,
  release,
}) {
  assertExactKeys(
    expected,
    ["payloadDigest", "repository", "sourceCommit", "version"],
    "GitHub draft verification input is invalid.",
  );
  assertString(
    expected.payloadDigest,
    sha256Pattern,
    "GitHub draft verification input is invalid.",
  );
  assertString(
    expected.repository,
    repositoryPattern,
    "GitHub draft verification input is invalid.",
  );
  const tag = draftReleaseTag(expected);
  if (
    !isPlainObject(release) ||
    release.draft !== true ||
    release.prerelease !== true ||
    release.published_at !== null
  ) {
    fail("GitHub candidate release is not a private draft.");
  }
  if (
    release.tag_name !== tag ||
    release.target_commitish !== expected.sourceCommit ||
    release.name !== draftReleaseName(expected) ||
    typeof release.body !== "string" ||
    !release.body.includes("# UNSIGNED PRIVATE DRAFT") ||
    !release.body.includes(expected.payloadDigest) ||
    !release.body.includes(expected.sourceCommit) ||
    typeof release.html_url !== "string" ||
    !release.html_url.startsWith(
      `https://github.com/${expected.repository}/releases/`,
    )
  ) {
    fail("GitHub draft release identity is invalid.");
  }
  const { assets, payloadDigest } = await inspectDraftPayload(payloadRoot);
  if (payloadDigest !== expected.payloadDigest || !Array.isArray(release.assets)) {
    fail("GitHub draft assets are missing, duplicated, extra, or changed.");
  }
  const remoteAssets = new Map();
  for (const asset of release.assets) {
    if (
      !isPlainObject(asset) ||
      typeof asset.name !== "string" ||
      remoteAssets.has(asset.name)
    ) {
      fail("GitHub draft assets are missing, duplicated, extra, or changed.");
    }
    remoteAssets.set(asset.name, asset);
  }
  if (
    remoteAssets.size !== assets.length ||
    assets.some(({ fileName, sha256, sizeBytes }) => {
      const asset = remoteAssets.get(fileName);
      return (
        asset === undefined ||
        asset.state !== "uploaded" ||
        asset.size !== sizeBytes ||
        asset.digest !== `sha256:${sha256}`
      );
    })
  ) {
    fail("GitHub draft assets are missing, duplicated, extra, or changed.");
  }
  return { assets, state: "draft", tag, url: release.html_url };
}

export function assertVerifiedAttestationResult({
  expectedPredicate,
  predicateType,
  result,
  subjects,
}) {
  if (!Array.isArray(result) || result.length !== 1) {
    fail("Verified attestation result is missing or ambiguous.");
  }
  const statement = result[0]?.verificationResult?.statement;
  if (
    !isPlainObject(statement) ||
    statement.predicateType !== predicateType ||
    !Array.isArray(statement.subject)
  ) {
    fail("Verified attestation result is invalid.");
  }
  if (
    expectedPredicate !== undefined &&
    !isDeepStrictEqual(statement.predicate, expectedPredicate)
  ) {
    fail("Verified attestation predicate does not match release evidence.");
  }
  if (!Array.isArray(subjects)) {
    fail("Expected attestation subjects are invalid.");
  }
  const expectedSubjects = subjects
    .map((subject) => {
      if (
        !isPlainObject(subject) ||
        typeof subject.fileName !== "string" ||
        !sha256Pattern.test(subject.sha256)
      ) {
        fail("Expected attestation subjects are invalid.");
      }
      return `${subject.sha256} *${subject.fileName}`;
    })
    .sort(compareNames);
  const actualSubjects = statement.subject
    .map((subject) => {
      if (
        !isPlainObject(subject) ||
        typeof subject.name !== "string" ||
        !isPlainObject(subject.digest) ||
        !sha256Pattern.test(subject.digest.sha256)
      ) {
        fail("Verified attestation subjects are incomplete or changed.");
      }
      return `${subject.digest.sha256} *${basename(subject.name)}`;
    })
    .sort(compareNames);
  if (
    actualSubjects.length !== expectedSubjects.length ||
    actualSubjects.some((subject, index) => subject !== expectedSubjects[index])
  ) {
    fail("Verified attestation subjects are incomplete or changed.");
  }
  return { predicateType, subjectCount: actualSubjects.length };
}

function expectedPredicateTypes() {
  return [
    CANDIDATE_IDENTITY_PREDICATE_TYPE,
    SPDX_PREDICATE_TYPE,
    SLSA_PROVENANCE_PREDICATE_TYPE,
  ];
}

function parseEvidenceIndex(value, version) {
  assertExactKeys(
    value,
    [
      "candidateSetDigest",
      "evidenceSetDigest",
      "files",
      "schemaVersion",
      "version",
    ],
    "Release evidence index is invalid.",
  );
  if (
    value.schemaVersion !== 1 ||
    value.version !== version ||
    !sha256Pattern.test(value.candidateSetDigest) ||
    !sha256Pattern.test(value.evidenceSetDigest) ||
    !Array.isArray(value.files)
  ) {
    fail("Release evidence index is invalid.");
  }
  const plan = evidenceFilePlan(version);
  if (value.files.length !== plan.size) {
    fail("Release evidence index is incomplete.");
  }
  const seen = new Set();
  for (const file of value.files) {
    assertExactKeys(
      file,
      ["fileName", "kind", "sha256", "sizeBytes"],
      "Release evidence index is invalid.",
    );
    if (
      plan.get(file.fileName) !== file.kind ||
      !sha256Pattern.test(file.sha256) ||
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes < 1 ||
      seen.has(file.fileName)
    ) {
      fail("Release evidence index is invalid.");
    }
    seen.add(file.fileName);
  }
  if ([...plan.keys()].some((fileName) => !seen.has(fileName))) {
    fail("Release evidence index is incomplete.");
  }
  return value;
}

async function verifyReleaseEvidence({
  candidateSet,
  evidenceRoot,
  expected,
  expectedEvidenceArtifactDigest,
  expectedEvidenceSetDigest,
}) {
  const evidenceNames = [
    ...evidenceFilePlan(candidateSet.version).keys(),
    "candidate-evidence-v1.json",
  ];
  await assertExactRegularFiles(
    evidenceRoot,
    evidenceNames,
    "Release evidence contains an unexpected file set.",
  );
  let index;
  try {
    index = parseEvidenceIndex(
      JSON.parse(
        await readFile(join(evidenceRoot, "candidate-evidence-v1.json"), "utf8"),
      ),
      candidateSet.version,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Release evidence")) {
      throw error;
    }
    fail("Release evidence index is invalid.");
  }
  if (
    index.candidateSetDigest !== candidateSet.candidateSetDigest ||
    index.evidenceSetDigest !== expectedEvidenceSetDigest
  ) {
    fail("Release evidence digest identity does not match verified inputs.");
  }
  const sortedIndexFiles = [...index.files].sort((left, right) =>
    compareNames(left.fileName, right.fileName),
  );
  for (const file of sortedIndexFiles) {
    const path = join(evidenceRoot, file.fileName);
    const fileStat = await stat(path);
    if (
      !fileStat.isFile() ||
      fileStat.size !== file.sizeBytes ||
      (await digestFile(path)) !== file.sha256
    ) {
      fail("Release evidence bytes do not match the evidence index.");
    }
  }
  const calculatedEvidenceSetDigest = createHash("sha256")
    .update(
      sortedIndexFiles
        .map(({ fileName, sha256 }) => `${sha256} *${fileName}\n`)
        .join(""),
    )
    .digest("hex");
  if (calculatedEvidenceSetDigest !== expectedEvidenceSetDigest) {
    fail("Release evidence set digest is invalid.");
  }
  const indexPath = join(evidenceRoot, "candidate-evidence-v1.json");
  const indexStat = await stat(indexPath);
  const evidenceArtifactFiles = [
    ...sortedIndexFiles,
    {
      fileName: "candidate-evidence-v1.json",
      sha256: await digestFile(indexPath),
      sizeBytes: indexStat.size,
    },
  ].sort((left, right) => compareNames(left.fileName, right.fileName));
  const calculatedEvidenceArtifactDigest = createHash("sha256")
    .update(
      evidenceArtifactFiles
        .map(({ fileName, sha256 }) => `${sha256} *${fileName}\n`)
        .join(""),
    )
    .digest("hex");
  if (calculatedEvidenceArtifactDigest !== expectedEvidenceArtifactDigest) {
    fail("Release evidence artifact digest is invalid.");
  }
  const checksumBytes = candidateSet.artifacts
    .map(({ fileName, sha256 }) => `${sha256} *${fileName}\n`)
    .join("");
  if (
    (await readFile(join(evidenceRoot, "SHA256SUMS"), "utf8")) !== checksumBytes
  ) {
    fail("Release candidate checksums do not match verified artifacts.");
  }
  for (const candidatePackage of candidateSet.packages) {
    const suffix = `${candidatePackage.manifest.platform}-${candidatePackage.manifest.architecture}`;
    const evidenceManifestName = `candidate-manifest-v1-${suffix}.json`;
    const evidenceManifestBytes = await readFile(
      join(evidenceRoot, evidenceManifestName),
    );
    if (!evidenceManifestBytes.equals(candidatePackage.manifestBytes)) {
      fail("Release manifest evidence does not match the candidate package.");
    }
    if (
      (await readFile(
        join(evidenceRoot, `candidate-manifest-v1-${suffix}.sha256`),
        "utf8",
      )) !== `${candidatePackage.manifestDigest}  ${evidenceManifestName}\n`
    ) {
      fail("Release manifest checksum evidence is invalid.");
    }
  }
  let predicate;
  try {
    predicate = JSON.parse(
      await readFile(join(evidenceRoot, "candidate-provenance-v1.json"), "utf8"),
    );
  } catch {
    fail("Release candidate provenance evidence is invalid.");
  }
  assertExactKeys(
    predicate,
    [
      "candidateSetDigest",
      "candidateUse",
      "repository",
      "schemaVersion",
      "signingStatus",
      "sourceCommit",
      "subjects",
      "version",
      "workflow",
    ],
    "Release candidate provenance evidence is invalid.",
  );
  const expectedSubjects = candidateSet.artifacts.map((artifact) => ({
    architecture: artifact.architecture,
    candidateManifestDigest: artifact.candidateManifestDigest,
    fileName: artifact.fileName,
    kind: artifact.kind,
    platform: artifact.platform,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    version: artifact.version,
  }));
  if (
    predicate.schemaVersion !== 1 ||
    predicate.candidateSetDigest !== candidateSet.candidateSetDigest ||
    predicate.candidateUse !== "private-draft-only" ||
    predicate.repository !== expected.repository ||
    predicate.signingStatus !== "unsigned" ||
    predicate.sourceCommit !== expected.sourceCommit ||
    predicate.version !== candidateSet.version ||
    JSON.stringify(predicate.subjects) !== JSON.stringify(expectedSubjects) ||
    JSON.stringify(predicate.workflow) !==
      JSON.stringify({
        event: expected.workflowEvent,
        name: expected.workflowName,
        runAttempt: expected.workflowRunAttempt,
        runId: expected.workflowRunId,
      })
  ) {
    fail("Release candidate provenance evidence is invalid.");
  }
  let sbom;
  try {
    sbom = JSON.parse(
      await readFile(
        join(evidenceRoot, `skills-desktop-${candidateSet.version}.spdx.json`),
        "utf8",
      ),
    );
  } catch {
    fail("Release SPDX evidence is invalid.");
  }
  if (
    !isPlainObject(sbom) ||
    sbom.spdxVersion !== "SPDX-2.3" ||
    sbom.dataLicense !== "CC0-1.0" ||
    !Array.isArray(sbom.documentDescribes) ||
    sbom.documentDescribes.length !== candidateSet.artifacts.length ||
    !Array.isArray(sbom.packages)
  ) {
    fail("Release SPDX evidence is invalid.");
  }
  for (const artifact of candidateSet.artifacts) {
    const matchingPackages = sbom.packages.filter(
      (candidate) =>
        isPlainObject(candidate) &&
        candidate.name === artifact.fileName &&
        Array.isArray(candidate.checksums) &&
        candidate.checksums.some(
          (checksum) =>
            isPlainObject(checksum) &&
            checksum.algorithm === "SHA256" &&
            checksum.checksumValue === artifact.sha256,
        ),
    );
    if (matchingPackages.length !== 1) {
      fail("Release SPDX evidence is incomplete.");
    }
  }
  return index;
}

export async function assembleVerifiedDraft({
  attestation,
  candidateRoot,
  evidenceRoot,
  expected,
  expectedEvidenceArtifactDigest,
  expectedEvidenceSetDigest,
  outputRoot,
  packageLockPath,
  verifiedAt,
}) {
  assertExactKeys(
    attestation,
    ["predicateTypes", "signerWorkflow", "sourceRef"],
    "Release attestation verification receipt is invalid.",
  );
  const suppliedPredicateTypes = [...new Set(attestation.predicateTypes)];
  const predicateTypes = expectedPredicateTypes();
  if (
    suppliedPredicateTypes.length !== predicateTypes.length ||
    predicateTypes.some((predicateType) =>
      !suppliedPredicateTypes.includes(predicateType),
    ) ||
    attestation.signerWorkflow !==
      `${expected.repository}/.github/workflows/release-candidates.yml` ||
    typeof attestation.sourceRef !== "string" ||
    !/^refs\/(heads|tags)\/[A-Za-z0-9._/-]+$/.test(attestation.sourceRef)
  ) {
    fail("Release attestation verification receipt is invalid.");
  }
  const candidateSet = bindCandidateSetDigest(
    await readCandidateSet(candidateRoot, expected),
  );
  await assertCandidateLockfile(candidateSet, packageLockPath);
  const evidenceIndex = await verifyReleaseEvidence({
    candidateSet,
    evidenceRoot,
    expected,
    expectedEvidenceArtifactDigest,
    expectedEvidenceSetDigest,
  });
  await mkdir(outputRoot);
  try {
    for (const artifact of candidateSet.artifacts) {
      await copyFile(
        artifact.path,
        join(outputRoot, artifact.fileName),
        COPYFILE_EXCL,
      );
    }
    for (const fileName of [
      ...evidenceFilePlan(candidateSet.version).keys(),
      "candidate-evidence-v1.json",
    ]) {
      await copyFile(
        join(evidenceRoot, fileName),
        join(outputRoot, fileName),
        COPYFILE_EXCL,
      );
    }
    await writeJson(join(outputRoot, "verification-receipt-v1.json"), {
      candidateSetDigest: candidateSet.candidateSetDigest,
      candidateUse: "private-draft-only",
      evidenceArtifactDigest: expectedEvidenceArtifactDigest,
      evidenceSetDigest: evidenceIndex.evidenceSetDigest,
      predicateTypes,
      repository: expected.repository,
      schemaVersion: 1,
      signerWorkflow: attestation.signerWorkflow,
      signingStatus: "unsigned",
      sourceCommit: expected.sourceCommit,
      sourceRef: attestation.sourceRef,
      stableEligible: false,
      verifiedAt: new Date(verifiedAt).toISOString(),
      version: candidateSet.version,
      workflow: {
        event: expected.workflowEvent,
        name: expected.workflowName,
        runAttempt: expected.workflowRunAttempt,
        runId: expected.workflowRunId,
      },
    });
  } catch (error) {
    fail(
      error instanceof Error && error.message.startsWith("Release ")
        ? error.message
        : "Verified draft payload assembly failed.",
    );
  }
  const payloadEntries = await readdir(outputRoot, { withFileTypes: true });
  if (payloadEntries.some((entry) => !entry.isFile())) {
    fail("Verified draft payload contains an unexpected entry.");
  }
  const payloadFiles = [];
  for (const fileName of payloadEntries.map(({ name }) => name).sort(compareNames)) {
    const path = join(outputRoot, fileName);
    payloadFiles.push({ fileName, sha256: await digestFile(path) });
  }
  const payloadDigest = createHash("sha256")
    .update(
      payloadFiles
        .map(({ fileName, sha256 }) => `${sha256} *${fileName}\n`)
        .join(""),
    )
    .digest("hex");
  return {
    candidateSetDigest: candidateSet.candidateSetDigest,
    evidenceArtifactDigest: expectedEvidenceArtifactDigest,
    evidenceSetDigest: evidenceIndex.evidenceSetDigest,
    payloadDigest,
    version: candidateSet.version,
  };
}

export async function generateReleaseEvidence({
  candidateRoot,
  createdAt,
  expected,
  outputRoot,
  packageLockPath,
}) {
  const candidateSet = bindCandidateSetDigest(
    await readCandidateSet(candidateRoot, expected),
  );
  const packageLockBytes = await assertCandidateLockfile(
    candidateSet,
    packageLockPath,
  );
  const { candidateSetDigest, checksumBytes } = candidateSet;
  await mkdir(outputRoot);
  await writeFile(join(outputRoot, "SHA256SUMS"), checksumBytes, { flag: "wx" });

  const lock = JSON.parse(packageLockBytes.toString("utf8"));
  const sbom = createSpdxDocument({
    artifacts: candidateSet.artifacts,
    candidateSetDigest,
    createdAt,
    lock,
    version: candidateSet.version,
  });
  await writeJson(
    join(outputRoot, `skills-desktop-${candidateSet.version}.spdx.json`),
    sbom,
  );
  const subjects = candidateSet.artifacts.map((artifact) => ({
    architecture: artifact.architecture,
    candidateManifestDigest: artifact.candidateManifestDigest,
    fileName: artifact.fileName,
    kind: artifact.kind,
    platform: artifact.platform,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    version: artifact.version,
  }));
  await writeJson(join(outputRoot, "candidate-provenance-v1.json"), {
    candidateSetDigest,
    candidateUse: "private-draft-only",
    repository: expected.repository,
    schemaVersion: 1,
    signingStatus: "unsigned",
    sourceCommit: expected.sourceCommit,
    subjects,
    version: candidateSet.version,
    workflow: {
      event: expected.workflowEvent,
      name: expected.workflowName,
      runAttempt: expected.workflowRunAttempt,
      runId: expected.workflowRunId,
    },
  });
  for (const candidatePackage of candidateSet.packages) {
    const suffix = `${candidatePackage.manifest.platform}-${candidatePackage.manifest.architecture}`;
    await writeFile(
      join(outputRoot, `candidate-manifest-v1-${suffix}.json`),
      candidatePackage.manifestBytes,
      { flag: "wx" },
    );
    await writeFile(
      join(outputRoot, `candidate-manifest-v1-${suffix}.sha256`),
      `${candidatePackage.manifestDigest}  candidate-manifest-v1-${suffix}.json\n`,
      { flag: "wx" },
    );
  }
  return {
    candidateSetDigest,
    subjectPaths: candidateSet.artifacts.map(({ path }) => path),
    version: candidateSet.version,
  };
}
