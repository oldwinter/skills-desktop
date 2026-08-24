import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  candidateArtifactPlan,
  createCandidateManifest,
  serializeCandidateManifest,
} from "../scripts/release/candidate-contract.mjs";
import {
  CANDIDATE_IDENTITY_PREDICATE_TYPE,
  SPDX_PREDICATE_TYPE,
  SLSA_PROVENANCE_PREDICATE_TYPE,
  assembleVerifiedDraft,
  assertTaggedPreviewVersions,
  assertVerifiedAttestationResult,
  createPreviewReleaseNotes,
  finalizeReleaseEvidence,
  generateReleaseEvidence,
  identifyCandidatePackage,
  previewReleaseName,
  previewReleaseTag,
  verifyGitHubDraftRelease,
  verifyGitHubPreviewRelease,
} from "../scripts/release/release-integrity.mjs";

const releaseContext = {
  repository: "oldwinter/skills-desktop",
  sourceCommit: "e".repeat(40),
  workflowEvent: "workflow_dispatch",
  workflowName: "Unsigned Release Candidates",
  workflowRunAttempt: "1",
  workflowRunId: "123456",
} as const;

const targets = [
  { architecture: "arm64", platform: "darwin" },
  { architecture: "x64", platform: "darwin" },
  { architecture: "x64", platform: "win32" },
  { architecture: "x64", platform: "linux" },
] as const;

const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function writeCandidateSet(root: string, lockfileSha256: string) {
  const candidateRoot = join(root, "candidate-inputs");
  await mkdir(candidateRoot);
  for (const target of targets) {
    const artifacts = candidateArtifactPlan({
      ...target,
      version: "0.1.0",
    }).map((artifact) => {
      const bytes = artifact.fileName;
      return {
        ...artifact,
        bytes,
        sha256: sha256(bytes),
        sizeBytes: Buffer.byteLength(bytes),
      };
    });
    const manifest = createCandidateManifest({
      ...target,
      artifacts: artifacts.map(({ bytes: _bytes, ...artifact }) => artifact),
      buildInputs: {
        electronVersion: "43.4.1",
        forgeVersion: "7.11.2",
        lockfileSha256,
        nodeVersion: "24.19.0",
        remoteBootstrapDigest: "d".repeat(64),
        remoteBootstrapProtocolVersion: 1,
      },
      buildOutputs: [
        "electron-main",
        "workspace-preload",
        "review-preload",
        "workspace-renderer",
        "review-renderer",
        "remote-bootstrap",
      ].map((entry, index) => ({
        entry,
        sha256: String(index + 1).repeat(64),
      })),
      source: {
        commit: releaseContext.sourceCommit,
        repository: releaseContext.repository,
      },
      version: "0.1.0",
      workflow: {
        event: releaseContext.workflowEvent,
        name: releaseContext.workflowName,
        runAttempt: releaseContext.workflowRunAttempt,
        runId: releaseContext.workflowRunId,
      },
    });
    const manifestBytes = serializeCandidateManifest(manifest);
    const manifestDigest = sha256(manifestBytes);
    const candidateDirectory = join(
      candidateRoot,
      `unsigned-package-${manifestDigest}`,
    );
    await mkdir(candidateDirectory);
    for (const artifact of artifacts) {
      await writeFile(join(candidateDirectory, artifact.fileName), artifact.bytes);
    }
    await writeFile(
      join(candidateDirectory, "candidate-manifest-v1.json"),
      manifestBytes,
    );
    await writeFile(
      join(candidateDirectory, "candidate-manifest-v1.sha256"),
      `${manifestDigest}  candidate-manifest-v1.json\n`,
    );
  }
  return candidateRoot;
}

async function writePackageLock(root: string) {
  const packageLockPath = join(root, "package-lock.json");
  const bytes = `${JSON.stringify({
      lockfileVersion: 3,
      name: "skills-desktop",
      packages: {
        "": { name: "skills-desktop", version: "0.1.0" },
        "apps/desktop": {
          dependencies: { zod: "4.4.3" },
          name: "@skills-desktop/desktop",
          version: "0.1.0",
        },
        "node_modules/electron": {
          dev: true,
          integrity:
            "sha512-jzh3++1za4mOgD5sfbN/Bw4zRXz92Q2Q3l3lh9wOXF1j4xLPXMEq9N5MLUEv3Y1+4aX9EBr2z6J0h8yZPZvknw==",
          license: "MIT",
          version: "43.4.1",
        },
        "node_modules/zod": {
          integrity:
            "sha512-/H7VKG+arKcQlS+lv4h1E1nq5tF4XhkQx1PpV6r7wJ8xO0aOhD1dFwTnQzXpnXvOQaTVwJj3E0T0JC0D5j9zNw==",
          license: "MIT",
          version: "4.4.3",
        },
      },
      requires: true,
    }, null, 2)}\n`;
  await writeFile(packageLockPath, bytes);
  return { packageLockPath, sha256: sha256(bytes) };
}

async function firstCandidateArtifact(candidateRoot: string) {
  for (const directoryName of await readdir(candidateRoot)) {
    const directory = join(candidateRoot, directoryName);
    for (const fileName of await readdir(directory)) {
      if (!fileName.startsWith("candidate-manifest-v1.")) {
        return { directory, path: join(directory, fileName) };
      }
    }
  }
  throw new Error("Candidate fixture has no artifact.");
}

describe("release integrity evidence contract", () => {
  it("identifies the maker's unhashed staging directory before artifact upload", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-integrity-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = await writeCandidateSet(root, lockfileSha256);
      const packageRoot = join(root, "package-output");
      await mkdir(packageRoot);
      let sourceDirectory: string | undefined;
      for (const directoryName of await readdir(candidateRoot)) {
        const directory = join(candidateRoot, directoryName);
        const manifest = JSON.parse(
          await readFile(
            join(directory, "candidate-manifest-v1.json"),
            "utf8",
          ),
        );
        if (manifest.platform === "linux") {
          sourceDirectory = directory;
          break;
        }
      }
      expect(sourceDirectory).toBeDefined();
      const stagingDirectory = join(
        packageRoot,
        "skills-desktop-0.1.0-linux-x64",
      );
      await rename(sourceDirectory!, stagingDirectory);

      const result = await identifyCandidatePackage({
        candidateRoot: packageRoot,
        expected: releaseContext,
        expectedArchitecture: "x64",
        expectedPlatform: "linux",
        packageLockPath,
      });

      expect(result).toMatchObject({
        architecture: "x64",
        candidateDirectory: stagingDirectory,
        manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        platform: "linux",
        version: "0.1.0",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("binds the exact candidate set to checksums, SPDX packages, and release identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-integrity-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = await writeCandidateSet(root, lockfileSha256);
      const outputRoot = join(root, "evidence");

      const result = await generateReleaseEvidence({
        candidateRoot,
        createdAt: "2026-08-22T08:00:00.000Z",
        expected: releaseContext,
        outputRoot,
        packageLockPath,
      });

      const expectedChecksums = [
        "d2f7935188646380c68cbcf8e6a0213981fa31d99074b13fed5994dc2af10726 *RELEASES",
        "98d56ef1c237e07666c96bf201d850eba57713591ffead680030245c71124e5c *skills-desktop-0.1.0-darwin-arm64.dmg",
        "b2e54d49bc7e67369273dcc45b34c32679ea9a3e00d3a86234bf10e715b225cb *skills-desktop-0.1.0-darwin-arm64.zip",
        "5a25fed73a8e3de5fe55f5d965af717285947adee930a463fe845919f58384ce *skills-desktop-0.1.0-darwin-x64.dmg",
        "3392e3bbe1228981dcfa4feb03f4e066bad6c11e6f6240fa0b182dc397f0d43a *skills-desktop-0.1.0-darwin-x64.zip",
        "ed18bd4f5f2e848408c624aa933b32e6aea1cd5caa1dfa31ed886b44ef5e2bc6 *skills-desktop-0.1.0-linux-x64.deb",
        "6ee4b6871b2651558fca48cccb0dc9aa27105159fae0f0dfd13c0bf3a8ac304e *skills-desktop-0.1.0-linux-x64.rpm",
        "ee8d6b2e442577ec0109c36125d0a49575e8a080c01ff5aae67a93e660ea8e26 *skills-desktop-0.1.0-win32-x64-setup.exe",
        "b1a4cfcc9f0936a3c0d6c48b2439738fc1860852d0e00e8a2cd66c0b29d26110 *skills_desktop-0.1.0-full.nupkg",
      ].join("\n") + "\n";
      expect(await readFile(join(outputRoot, "SHA256SUMS"), "utf8")).toBe(
        expectedChecksums,
      );
      expect(result).toMatchObject({
        candidateSetDigest:
          "b517be9792de1bece543697fa719120543e77128a7f9e5e858b24c361ae93a71",
        subjectPaths: expect.arrayContaining([
          expect.stringMatching(/RELEASES$/),
          expect.stringMatching(/darwin-arm64\.dmg$/),
        ]),
        version: "0.1.0",
      });
      expect(result.subjectPaths).toHaveLength(9);

      const sbom = JSON.parse(
        await readFile(
          join(outputRoot, "skills-desktop-0.1.0.spdx.json"),
          "utf8",
        ),
      );
      expect(sbom).toMatchObject({
        SPDXID: "SPDXRef-DOCUMENT",
        creationInfo: {
          created: "2026-08-22T08:00:00.000Z",
          creators: ["Tool: skills-desktop-release-integrity/1"],
        },
        dataLicense: "CC0-1.0",
        name: "Skills Desktop 0.1.0 unsigned candidate SBOM",
        spdxVersion: "SPDX-2.3",
      });
      expect(sbom.documentDescribes).toHaveLength(9);
      expect(sbom.packages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            checksums: [
              {
                algorithm: "SHA256",
                checksumValue:
                  "98d56ef1c237e07666c96bf201d850eba57713591ffead680030245c71124e5c",
              },
            ],
            filesAnalyzed: false,
            name: "skills-desktop-0.1.0-darwin-arm64.dmg",
            versionInfo: "0.1.0",
          }),
          expect.objectContaining({ name: "@skills-desktop/desktop" }),
          expect.objectContaining({ name: "electron", versionInfo: "43.4.1" }),
          expect.objectContaining({ name: "zod", versionInfo: "4.4.3" }),
        ]),
      );

      const predicate = JSON.parse(
        await readFile(
          join(outputRoot, "candidate-provenance-v1.json"),
          "utf8",
        ),
      );
      expect(predicate).toMatchObject({
        candidateSetDigest: result.candidateSetDigest,
        candidateUse: "unsigned-preview-only",
        repository: releaseContext.repository,
        schemaVersion: 1,
        signingStatus: "unsigned",
        sourceCommit: releaseContext.sourceCommit,
        version: "0.1.0",
        workflow: {
          event: releaseContext.workflowEvent,
          name: releaseContext.workflowName,
          runAttempt: releaseContext.workflowRunAttempt,
          runId: releaseContext.workflowRunId,
        },
      });
      expect(predicate.subjects).toHaveLength(9);
      expect(predicate.subjects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            architecture: "arm64",
            fileName: "skills-desktop-0.1.0-darwin-arm64.dmg",
            platform: "darwin",
            version: "0.1.0",
          }),
        ]),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects evidence generation when the checked-out lockfile changed", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-lock-drift-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = await writeCandidateSet(root, lockfileSha256);
      await writeFile(packageLockPath, "\n", { flag: "a" });

      await expect(
        generateReleaseEvidence({
          candidateRoot,
          createdAt: "2026-08-22T08:00:00.000Z",
          expected: releaseContext,
          outputRoot: join(root, "evidence"),
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Release candidate lockfile digest does not match this checkout.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      name: "changed",
      mutate: async (candidateRoot: string) => {
        const artifact = await firstCandidateArtifact(candidateRoot);
        await writeFile(artifact.path, "changed", { flag: "a" });
      },
      message: "Release candidate artifact bytes do not match the manifest.",
    },
    {
      name: "extra",
      mutate: async (candidateRoot: string) => {
        const artifact = await firstCandidateArtifact(candidateRoot);
        await writeFile(join(artifact.directory, "unexpected.bin"), "extra");
      },
      message: "Release candidate package contains an unexpected file set.",
    },
    {
      name: "missing",
      mutate: async (candidateRoot: string) => {
        const artifact = await firstCandidateArtifact(candidateRoot);
        await rm(artifact.path);
      },
      message: "Release candidate package contains an unexpected file set.",
    },
  ])("rejects $name candidate bytes", async ({ message, mutate }) => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-candidate-bad-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = await writeCandidateSet(root, lockfileSha256);
      await mutate(candidateRoot);

      await expect(
        generateReleaseEvidence({
          candidateRoot,
          createdAt: "2026-08-22T08:00:00.000Z",
          expected: releaseContext,
          outputRoot: join(root, "evidence"),
          packageLockPath,
        }),
      ).rejects.toThrow(message);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("seals exact attestation bundles into a digest-addressed evidence index", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-evidence-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = await writeCandidateSet(root, lockfileSha256);
      const outputRoot = join(root, "evidence");
      const generated = await generateReleaseEvidence({
        candidateRoot,
        createdAt: "2026-08-22T08:00:00.000Z",
        expected: releaseContext,
        outputRoot,
        packageLockPath,
      });
      const bundleRoot = join(root, "bundles");
      await mkdir(bundleRoot);
      const attestationBundles = {
        candidateIdentity: join(bundleRoot, "identity.json"),
        provenance: join(bundleRoot, "provenance.json"),
        sbom: join(bundleRoot, "sbom.json"),
      };
      await writeFile(
        attestationBundles.provenance,
        '{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json","kind":"provenance"}\n',
      );
      await writeFile(
        attestationBundles.sbom,
        '{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json","kind":"sbom"}\n',
      );
      await writeFile(
        attestationBundles.candidateIdentity,
        '{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json","kind":"candidate-identity"}\n',
      );

      const finalized = await finalizeReleaseEvidence({
        attestationBundles,
        evidenceRoot: outputRoot,
        expectedCandidateSetDigest: generated.candidateSetDigest,
      });

      expect(finalized).toEqual({
        candidateSetDigest: generated.candidateSetDigest,
        evidenceArtifactDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        evidenceSetDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        version: "0.1.0",
      });
      const evidenceIndex = JSON.parse(
        await readFile(join(outputRoot, "candidate-evidence-v1.json"), "utf8"),
      );
      expect(evidenceIndex).toMatchObject({
        candidateSetDigest: generated.candidateSetDigest,
        evidenceSetDigest: finalized.evidenceSetDigest,
        schemaVersion: 1,
        version: "0.1.0",
      });
      expect(evidenceIndex.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fileName: "SHA256SUMS",
            kind: "candidate-checksums",
            sha256:
              "b517be9792de1bece543697fa719120543e77128a7f9e5e858b24c361ae93a71",
          }),
          expect.objectContaining({
            fileName: "attestation-provenance.sigstore.json",
            kind: "provenance-attestation",
          }),
          expect.objectContaining({
            fileName: "attestation-sbom.sigstore.json",
            kind: "sbom-attestation",
          }),
          expect.objectContaining({
            fileName: "attestation-candidate-identity.sigstore.json",
            kind: "candidate-identity-attestation",
          }),
        ]),
      );
      expect(evidenceIndex.files).toHaveLength(14);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects duplicate attestation bundles across evidence roles", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-duplicate-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = await writeCandidateSet(root, lockfileSha256);
      const evidenceRoot = join(root, "evidence");
      const generated = await generateReleaseEvidence({
        candidateRoot,
        createdAt: "2026-08-22T08:00:00.000Z",
        expected: releaseContext,
        outputRoot: evidenceRoot,
        packageLockPath,
      });
      const duplicateBundle = join(root, "duplicate-bundle.json");
      await writeFile(duplicateBundle, '{"duplicate":true}\n');

      await expect(
        finalizeReleaseEvidence({
          attestationBundles: {
            candidateIdentity: duplicateBundle,
            provenance: duplicateBundle,
            sbom: duplicateBundle,
          },
          evidenceRoot,
          expectedCandidateSetDigest: generated.candidateSetDigest,
        }),
      ).rejects.toThrow("Release attestation bundles must be distinct.");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("assembles only independently reverified candidate and evidence bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-verified-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = await writeCandidateSet(root, lockfileSha256);
      const evidenceRoot = join(root, "evidence");
      const generated = await generateReleaseEvidence({
        candidateRoot,
        createdAt: "2026-08-22T08:00:00.000Z",
        expected: releaseContext,
        outputRoot: evidenceRoot,
        packageLockPath,
      });
      const bundleRoot = join(root, "bundles");
      await mkdir(bundleRoot);
      const attestationBundles = {
        candidateIdentity: join(bundleRoot, "identity.json"),
        provenance: join(bundleRoot, "provenance.json"),
        sbom: join(bundleRoot, "sbom.json"),
      };
      for (const [kind, path] of Object.entries(attestationBundles)) {
        await writeFile(path, `${JSON.stringify({ kind })}\n`);
      }
      const finalized = await finalizeReleaseEvidence({
        attestationBundles,
        evidenceRoot,
        expectedCandidateSetDigest: generated.candidateSetDigest,
      });
      const outputRoot = join(root, "verified-draft");

      const assembled = await assembleVerifiedDraft({
        attestation: {
          predicateTypes: [
            SLSA_PROVENANCE_PREDICATE_TYPE,
            SPDX_PREDICATE_TYPE,
            CANDIDATE_IDENTITY_PREDICATE_TYPE,
          ],
          signerWorkflow:
            "oldwinter/skills-desktop/.github/workflows/release-candidates.yml",
          sourceRef: "refs/heads/main",
        },
        candidateRoot,
        evidenceRoot,
        expected: releaseContext,
        expectedEvidenceArtifactDigest: finalized.evidenceArtifactDigest,
        expectedEvidenceSetDigest: finalized.evidenceSetDigest,
        outputRoot,
        packageLockPath,
        verifiedAt: "2026-08-22T08:05:00.000Z",
      });

      expect(assembled).toEqual({
        candidateSetDigest: generated.candidateSetDigest,
        evidenceArtifactDigest: finalized.evidenceArtifactDigest,
        evidenceSetDigest: finalized.evidenceSetDigest,
        payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        version: "0.1.0",
      });
      const payloadFiles = (await readdir(outputRoot)).sort();
      expect(payloadFiles).toHaveLength(25);
      expect(payloadFiles).toEqual(
        expect.arrayContaining([
          "RELEASES",
          "SHA256SUMS",
          "attestation-candidate-identity.sigstore.json",
          "attestation-provenance.sigstore.json",
          "attestation-sbom.sigstore.json",
          "candidate-evidence-v1.json",
          "skills-desktop-0.1.0-darwin-arm64.dmg",
          "skills-desktop-0.1.0.spdx.json",
          "verification-receipt-v1.json",
        ]),
      );
      const receipt = JSON.parse(
        await readFile(join(outputRoot, "verification-receipt-v1.json"), "utf8"),
      );
      expect(receipt).toEqual({
        candidateSetDigest: generated.candidateSetDigest,
        candidateUse: "unsigned-preview-only",
        evidenceArtifactDigest: finalized.evidenceArtifactDigest,
        evidenceSetDigest: finalized.evidenceSetDigest,
        predicateTypes: [
          CANDIDATE_IDENTITY_PREDICATE_TYPE,
          SPDX_PREDICATE_TYPE,
          SLSA_PROVENANCE_PREDICATE_TYPE,
        ],
        repository: releaseContext.repository,
        schemaVersion: 1,
        signerWorkflow:
          "oldwinter/skills-desktop/.github/workflows/release-candidates.yml",
        signingStatus: "unsigned",
        sourceCommit: releaseContext.sourceCommit,
        sourceRef: "refs/heads/main",
        stableEligible: false,
        verifiedAt: "2026-08-22T08:05:00.000Z",
        version: "0.1.0",
        workflow: {
          event: releaseContext.workflowEvent,
          name: releaseContext.workflowName,
          runAttempt: releaseContext.workflowRunAttempt,
          runId: releaseContext.workflowRunId,
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      name: "changed index",
      mutate: async (evidenceRoot: string) => {
        await writeFile(join(evidenceRoot, "candidate-evidence-v1.json"), "\n", {
          flag: "a",
        });
      },
      message: "Release evidence artifact digest is invalid.",
    },
    {
      name: "changed",
      mutate: async (evidenceRoot: string) => {
        await writeFile(
          join(evidenceRoot, "attestation-provenance.sigstore.json"),
          "changed",
          { flag: "a" },
        );
      },
      message: "Release evidence bytes do not match the evidence index.",
    },
    {
      name: "extra",
      mutate: async (evidenceRoot: string) => {
        await writeFile(join(evidenceRoot, "unexpected.log"), "extra");
      },
      message: "Release evidence contains an unexpected file set.",
    },
    {
      name: "missing",
      mutate: async (evidenceRoot: string) => {
        await rm(join(evidenceRoot, "attestation-sbom.sigstore.json"));
      },
      message: "Release evidence contains an unexpected file set.",
    },
  ])("rejects $name evidence bytes", async ({ message, mutate }) => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-evidence-bad-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = await writeCandidateSet(root, lockfileSha256);
      const evidenceRoot = join(root, "evidence");
      const generated = await generateReleaseEvidence({
        candidateRoot,
        createdAt: "2026-08-22T08:00:00.000Z",
        expected: releaseContext,
        outputRoot: evidenceRoot,
        packageLockPath,
      });
      const bundleRoot = join(root, "bundles");
      await mkdir(bundleRoot);
      const attestationBundles = {
        candidateIdentity: join(bundleRoot, "identity.json"),
        provenance: join(bundleRoot, "provenance.json"),
        sbom: join(bundleRoot, "sbom.json"),
      };
      for (const [kind, path] of Object.entries(attestationBundles)) {
        await writeFile(path, `${JSON.stringify({ kind })}\n`);
      }
      const finalized = await finalizeReleaseEvidence({
        attestationBundles,
        evidenceRoot,
        expectedCandidateSetDigest: generated.candidateSetDigest,
      });
      await mutate(evidenceRoot);

      await expect(
        assembleVerifiedDraft({
          attestation: {
            predicateTypes: [
              SLSA_PROVENANCE_PREDICATE_TYPE,
              SPDX_PREDICATE_TYPE,
              CANDIDATE_IDENTITY_PREDICATE_TYPE,
            ],
            signerWorkflow:
              "oldwinter/skills-desktop/.github/workflows/release-candidates.yml",
            sourceRef: "refs/heads/main",
          },
          candidateRoot,
          evidenceRoot,
          expected: releaseContext,
          expectedEvidenceArtifactDigest: finalized.evidenceArtifactDigest,
          expectedEvidenceSetDigest: finalized.evidenceSetDigest,
          outputRoot: join(root, "verified-draft"),
          packageLockPath,
          verifiedAt: "2026-08-22T08:05:00.000Z",
        }),
      ).rejects.toThrow(message);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts only a private draft whose GitHub asset digests match the verified payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-draft-"));
    try {
      const payloadRoot = join(root, "payload");
      await mkdir(payloadRoot);
      await writeFile(join(payloadRoot, "candidate.deb"), "candidate-bytes");
      await writeFile(join(payloadRoot, "SHA256SUMS"), "checksum-evidence\n");
      const payloadFiles = [];
      for (const fileName of ["SHA256SUMS", "candidate.deb"]) {
        const path = join(payloadRoot, fileName);
        const fileStat = await stat(path);
        payloadFiles.push({
          fileName,
          sha256: sha256(await readFile(path)),
          sizeBytes: fileStat.size,
        });
      }
      const payloadDigest = sha256(
        payloadFiles
          .map(({ fileName, sha256: digest }) => `${digest} *${fileName}\n`)
          .join(""),
      );
      const version = "0.1.0";
      const tag = previewReleaseTag({
        sourceCommit: releaseContext.sourceCommit,
        sourceRef: "refs/heads/main",
        version,
      });
      const expected = {
        candidateSetDigest: "a".repeat(64),
        evidenceSetDigest: "b".repeat(64),
        payloadDigest,
        repository: releaseContext.repository,
        sourceCommit: releaseContext.sourceCommit,
        sourceRef: "refs/heads/main",
        version,
        workflowRunUrl:
          "https://github.com/oldwinter/skills-desktop/actions/runs/123456",
      };
      const notes = createPreviewReleaseNotes(expected);
      expect(notes).toContain("\n\n");
      expect(notes).toContain("UNSIGNED DEVELOPER PREVIEW");
      expect(notes).toContain("not stable-eligible");
      expect(notes).toContain(
        `/blob/${releaseContext.sourceCommit}/docs/unsigned-developer-preview.md`,
      );
      const release = {
        assets: payloadFiles.map((file) => ({
          digest: `sha256:${file.sha256}`,
          name: file.fileName,
          size: file.sizeBytes,
          state: "uploaded",
        })),
        body: notes,
        draft: true,
        html_url:
          "https://github.com/oldwinter/skills-desktop/releases/tag/candidate",
        name: previewReleaseName({
          sourceCommit: releaseContext.sourceCommit,
          sourceRef: "refs/heads/main",
          version,
        }),
        prerelease: true,
        published_at: null,
        tag_name: tag,
        target_commitish: releaseContext.sourceCommit,
      };

      expect(
        await verifyGitHubDraftRelease({
          expected,
          payloadRoot,
          release,
        }),
      ).toEqual({
        assets: payloadFiles,
        state: "draft",
        tag,
        url: release.html_url,
      });
      await expect(
        verifyGitHubDraftRelease({
          expected,
          payloadRoot,
          release: { ...release, draft: false, published_at: "2026-08-22" },
        }),
      ).rejects.toThrow("GitHub candidate release is not a private draft.");
      await expect(
        verifyGitHubDraftRelease({
          expected,
          payloadRoot,
          release: {
            ...release,
            assets: [
              ...release.assets,
              {
                digest: `sha256:${"f".repeat(64)}`,
                name: "unexpected.exe",
                size: 1,
                state: "uploaded",
              },
            ],
          },
        }),
      ).rejects.toThrow(
        "GitHub draft assets are missing, duplicated, extra, or changed.",
      );
      for (const requiredEvidence of [
        expected.candidateSetDigest,
        expected.evidenceSetDigest,
        expected.sourceRef,
        expected.workflowRunUrl,
        "unsigned, not notarized",
        "macOS and Windows may block it",
      ]) {
        await expect(
          verifyGitHubDraftRelease({
            expected,
            payloadRoot,
            release: {
              ...release,
              body: release.body.replace(requiredEvidence, "removed"),
            },
          }),
        ).rejects.toThrow("GitHub draft release identity is invalid.");
      }

      const publishedAt = "2026-08-22T10:00:00Z";
      expect(
        await verifyGitHubPreviewRelease({
          expected,
          payloadRoot,
          release: {
            ...release,
            draft: false,
            published_at: publishedAt,
          },
        }),
      ).toEqual({
        assets: payloadFiles,
        publishedAt,
        state: "preview",
        tag,
        url: release.html_url,
      });
      await expect(
        verifyGitHubPreviewRelease({
          expected,
          payloadRoot,
          release,
        }),
      ).rejects.toThrow(
        "GitHub candidate release is not a public developer preview.",
      );

      const taggedExpected = {
        ...expected,
        sourceRef: "refs/tags/v0.1.0",
      };
      const taggedRelease = {
        ...release,
        body: createPreviewReleaseNotes(taggedExpected),
        name: previewReleaseName(taggedExpected),
        tag_name: "v0.1.0",
      };
      await expect(
        verifyGitHubDraftRelease({
          expected: taggedExpected,
          payloadRoot,
          release: taggedRelease,
        }),
      ).resolves.toMatchObject({ state: "draft", tag: "v0.1.0" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("binds an exact version tag to every package version", () => {
    const versions = {
      desktop: "0.1.0",
      lockfile: "0.1.0",
      root: "0.1.0",
      runtime: "0.1.0",
    };

    expect(
      assertTaggedPreviewVersions({
        sourceRef: "refs/tags/v0.1.0",
        versions,
      }),
    ).toEqual({ tag: "v0.1.0", version: "0.1.0" });
    expect(
      previewReleaseTag({
        sourceCommit: releaseContext.sourceCommit,
        sourceRef: "refs/tags/v0.1.0",
        version: "0.1.0",
      }),
    ).toBe("v0.1.0");
    expect(() =>
      assertTaggedPreviewVersions({
        sourceRef: "refs/tags/v0.2.0",
        versions,
      }),
    ).toThrow("Unsigned preview tag must match every package version.");
    expect(() =>
      assertTaggedPreviewVersions({
        sourceRef: "refs/tags/v0.1",
        versions,
      }),
    ).toThrow("Unsigned preview tag identity is invalid.");
    expect(() =>
      assertTaggedPreviewVersions({
        sourceRef: "refs/tags/v0.1.0-beta.1",
        versions,
      }),
    ).toThrow("Unsigned preview tag identity is invalid.");
  });

  it("accepts only verified attestation statements with the complete exact subject set", () => {
    const expectedPredicate = {
      candidateSetDigest: "a".repeat(64),
      schemaVersion: 1,
    };
    const subjects = [
      { fileName: "candidate.deb", sha256: "b".repeat(64) },
      { fileName: "candidate.rpm", sha256: "c".repeat(64) },
    ];
    const result = [
      {
        verificationResult: {
          statement: {
            predicate: expectedPredicate,
            predicateType: CANDIDATE_IDENTITY_PREDICATE_TYPE,
            subject: subjects.map((subject) => ({
              digest: { sha256: subject.sha256 },
              name: `candidate-inputs/package/${subject.fileName}`,
            })),
          },
        },
      },
    ];

    expect(
      assertVerifiedAttestationResult({
        expectedPredicate,
        predicateType: CANDIDATE_IDENTITY_PREDICATE_TYPE,
        result,
        subjects,
      }),
    ).toEqual({
      predicateType: CANDIDATE_IDENTITY_PREDICATE_TYPE,
      subjectCount: 2,
    });
    expect(() =>
      assertVerifiedAttestationResult({
        expectedPredicate,
        predicateType: CANDIDATE_IDENTITY_PREDICATE_TYPE,
        result: [
          {
            verificationResult: {
              statement: {
                ...result[0].verificationResult.statement,
                subject: result[0].verificationResult.statement.subject.slice(0, 1),
              },
            },
          },
        ],
        subjects,
      }),
    ).toThrow("Verified attestation subjects are incomplete or changed.");
    expect(() =>
      assertVerifiedAttestationResult({
        expectedPredicate: { ...expectedPredicate, schemaVersion: 2 },
        predicateType: CANDIDATE_IDENTITY_PREDICATE_TYPE,
        result,
        subjects,
      }),
    ).toThrow("Verified attestation predicate does not match release evidence.");
  });
});
