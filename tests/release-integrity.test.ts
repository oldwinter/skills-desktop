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
  inspectCandidateSubjects,
  previewReleaseName,
  previewReleaseTag,
  verifyDraftPayload,
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
        electronVersion: "44.0.0",
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
          dependencies: { zod: "4.5.4" },
          name: "@skills-desktop/desktop",
          version: "0.1.0",
        },
        "node_modules/electron": {
          dev: true,
          integrity:
            "sha512-jzh3++1za4mOgD5sfbN/Bw4zRXz92Q2Q3l3lh9wOXF1j4xLPXMEq9N5MLUEv3Y1+4aX9EBr2z6J0h8yZPZvknw==",
          license: "MIT",
          version: "44.0.0",
        },
        "node_modules/zod": {
          integrity:
            "sha512-/H7VKG+arKcQlS+lv4h1E1nq5tF4XhkQx1PpV6r7wJ8xO0aOhD1dFwTnQzXpnXvOQaTVwJj3E0T0JC0D5j9zNw==",
          license: "MIT",
          version: "4.5.4",
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
          expect.objectContaining({ name: "electron", versionInfo: "44.0.0" }),
          expect.objectContaining({ name: "zod", versionInfo: "4.5.4" }),
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

describe("release integrity candidate validation failure arms", () => {
  interface SingleCandidateOptions {
    readonly addressed?: boolean;
    readonly artifactBytes?: (fileName: string, bytes: string) => string;
    readonly dirName?: string;
    readonly extraEntries?: ReadonlyArray<
      readonly ["dir" | "file", string, string?]
    >;
    readonly lockfileSha256: string;
    readonly manifestMutator?: (manifest: unknown) => unknown;
    readonly platform?: "darwin" | "linux" | "win32";
    readonly architecture?: "arm64" | "x64";
    readonly version?: string;
  }

  async function writeSingleCandidate(
    parent: string,
    options: SingleCandidateOptions,
  ) {
    const platform = options.platform ?? "darwin";
    const architecture = options.architecture ?? "arm64";
    const version = options.version ?? "0.1.0";
    const artifacts = candidateArtifactPlan({
      architecture,
      platform,
      version,
    }).map((artifact) => {
      const declared = artifact.fileName;
      return {
        ...artifact,
        bytes: declared,
        sha256: sha256(declared),
        sizeBytes: Buffer.byteLength(declared),
      };
    });
    const manifest = createCandidateManifest({
      architecture,
      artifacts: artifacts.map(({ bytes: _bytes, ...artifact }) => artifact),
      buildInputs: {
        electronVersion: "44.0.0",
        forgeVersion: "7.11.2",
        lockfileSha256: options.lockfileSha256,
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
      platform,
      source: {
        commit: releaseContext.sourceCommit,
        repository: releaseContext.repository,
      },
      version,
      workflow: {
        event: releaseContext.workflowEvent,
        name: releaseContext.workflowName,
        runAttempt: releaseContext.workflowRunAttempt,
        runId: releaseContext.workflowRunId,
      },
    });
    const finalManifest = options.manifestMutator
      ? options.manifestMutator(structuredClone(manifest))
      : manifest;
    const manifestBytes = Buffer.from(serializeCandidateManifest(finalManifest));
    const manifestDigest = sha256(manifestBytes);
    const name =
      options.dirName ??
      (options.addressed
        ? `unsigned-package-${manifestDigest}`
        : `skills-desktop-${version}-${platform}-${architecture}`);
    const directory = join(parent, name);
    await mkdir(directory);
    await writeFile(join(directory, "candidate-manifest-v1.json"), manifestBytes);
    await writeFile(
      join(directory, "candidate-manifest-v1.sha256"),
      `${manifestDigest}  candidate-manifest-v1.json\n`,
    );
    for (const artifact of artifacts) {
      await writeFile(
        join(directory, artifact.fileName),
        options.artifactBytes?.(artifact.fileName, artifact.bytes) ??
          artifact.bytes,
      );
    }
    for (const [type, entry, content] of options.extraEntries ?? []) {
      if (type === "dir") {
        await mkdir(join(directory, entry), { recursive: true });
      } else {
        await writeFile(join(directory, entry), content ?? "");
      }
    }
    return { artifacts, directory, manifest, manifestDigest };
  }

  async function identifyReject(
    mutate: (manifest: Record<string, unknown>) => unknown,
    message: string,
    extra: Partial<SingleCandidateOptions> = {},
  ) {
    const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidates");
      await mkdir(candidateRoot);
      await writeSingleCandidate(candidateRoot, {
        ...extra,
        lockfileSha256,
        manifestMutator: (manifest) => {
          const cloned = structuredClone(manifest) as Record<string, unknown> & {
            buildInputs: { lockfileSha256: string };
          };
          cloned.buildInputs.lockfileSha256 = lockfileSha256;
          return mutate(cloned);
        },
      });
      await expect(
        identifyCandidatePackage({
          candidateRoot,
          expected: releaseContext,
          expectedArchitecture: "arm64",
          expectedPlatform: "darwin",
          packageLockPath,
        }),
      ).rejects.toThrow(message);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }

  it("rejects a candidate root that does not hold exactly one directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
    try {
      const { packageLockPath } = await writePackageLock(root);
      const empty = join(root, "empty");
      await mkdir(empty);
      await expect(
        identifyCandidatePackage({
          candidateRoot: empty,
          expected: releaseContext,
          expectedArchitecture: "arm64",
          expectedPlatform: "darwin",
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Package job must emit exactly one candidate package directory.",
      );

      const crowded = join(root, "crowded");
      await mkdir(join(crowded, "one"), { recursive: true });
      await mkdir(join(crowded, "two"));
      await expect(
        identifyCandidatePackage({
          candidateRoot: crowded,
          expected: releaseContext,
          expectedArchitecture: "arm64",
          expectedPlatform: "darwin",
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Package job must emit exactly one candidate package directory.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a package containing a non-regular-file entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidates");
      await mkdir(candidateRoot);
      await writeSingleCandidate(candidateRoot, {
        extraEntries: [["dir", "nested"]],
        lockfileSha256,
      });
      await expect(
        identifyCandidatePackage({
          candidateRoot,
          expected: releaseContext,
          expectedArchitecture: "arm64",
          expectedPlatform: "darwin",
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Release candidate packages may contain only regular files.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a package whose manifest checksum file disagrees", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidates");
      await mkdir(candidateRoot);
      const candidate = await writeSingleCandidate(candidateRoot, {
        lockfileSha256,
      });
      await writeFile(
        join(candidate.directory, "candidate-manifest-v1.sha256"),
        `${"0".repeat(64)}  candidate-manifest-v1.json\n`,
      );
      await expect(
        identifyCandidatePackage({
          candidateRoot,
          expected: releaseContext,
          expectedArchitecture: "arm64",
          expectedPlatform: "darwin",
          packageLockPath,
        }),
      ).rejects.toThrow("Release candidate manifest checksum is invalid.");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["42", "Release candidate manifest schema is invalid."],
    ["{", "Release candidate manifest is not valid JSON."],
  ])(
    "rejects a manifest whose bytes parse to %j or not at all",
    async (bytes, message) => {
      const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
      try {
        const { packageLockPath, sha256: lockfileSha256 } =
          await writePackageLock(root);
        const candidateRoot = join(root, "candidates");
        await mkdir(candidateRoot);
        const candidate = await writeSingleCandidate(candidateRoot, {
          lockfileSha256,
        });
        const manifestPath = join(
          candidate.directory,
          "candidate-manifest-v1.json",
        );
        await writeFile(manifestPath, bytes);
        const digest = sha256(bytes);
        await writeFile(
          join(candidate.directory, "candidate-manifest-v1.sha256"),
          `${digest}  candidate-manifest-v1.json\n`,
        );
        await expect(
          identifyCandidatePackage({
            candidateRoot,
            expected: releaseContext,
            expectedArchitecture: "arm64",
            expectedPlatform: "darwin",
            packageLockPath,
          }),
        ).rejects.toThrow(message);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    [
      "an extra top-level key",
      (manifest: Record<string, unknown>) => ({ ...manifest, extra: true }),
    ],
    [
      "an unknown platform",
      (manifest: Record<string, unknown>) => ({ ...manifest, platform: "plan9" }),
    ],
    [
      "an unexpected schema version",
      (manifest: Record<string, unknown>) => ({ ...manifest, schemaVersion: 2 }),
    ],
    [
      "a signed signing status",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        signingStatus: "signed",
      }),
    ],
    [
      "a non-preview candidate use",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        candidateUse: "stable",
      }),
    ],
    [
      "a malformed version",
      (manifest: Record<string, unknown>) => ({ ...manifest, version: "v1.2" }),
    ],
  ])(
    "rejects a manifest with %s",
    async (_name, mutator: (manifest: Record<string, unknown>) => unknown) => {
      await identifyReject(
        mutator,
        "Release candidate manifest schema is invalid.",
      );
    },
  );

  it("rejects a manifest for an unsupported platform/architecture pair", async () => {
    await identifyReject(
      (manifest) => ({ ...manifest, architecture: "arm64", platform: "linux" }),
      "Release candidate manifest target is unsupported.",
    );
  });

  it.each([
    [
      "an extra key",
      (source: Record<string, unknown>) => ({ ...source, extra: 1 }),
    ],
    [
      "a non-hex commit",
      (source: Record<string, unknown>) => ({
        ...source,
        commit: "z".repeat(40),
      }),
    ],
    [
      "a repository that is not owner/name",
      (source: Record<string, unknown>) => ({
        ...source,
        repository: "no-slash",
      }),
    ],
  ])(
    "rejects a manifest whose source identity has %s",
    async (_name, mutateSource: (source: Record<string, unknown>) => unknown) => {
      await identifyReject(
        (manifest) => ({
          ...manifest,
          source: mutateSource(manifest.source as Record<string, unknown>),
        }),
        "Release candidate source identity is invalid.",
      );
    },
  );

  it.each([
    [
      "a commit that differs from the workflow",
      { commit: "b".repeat(40), repository: releaseContext.repository },
      "Release candidate source identity does not match this workflow.",
    ],
    [
      "a repository that differs from the workflow",
      { commit: releaseContext.sourceCommit, repository: "other/repo" },
      "Release candidate source identity does not match this workflow.",
    ],
  ])(
    "rejects a manifest whose source identity has %s",
    async (_name, source, message) => {
      await identifyReject(
        (manifest) => ({ ...manifest, source }),
        message,
      );
    },
  );

  it.each([
    [
      "an extra key",
      (workflow: Record<string, unknown>) => ({ ...workflow, extra: 1 }),
      "Release candidate workflow identity is invalid.",
    ],
    [
      "a mismatched run id",
      (workflow: Record<string, unknown>) => ({ ...workflow, runId: "99999" }),
      "Release candidate workflow identity does not match this workflow.",
    ],
  ])(
    "rejects a manifest whose workflow identity has %s",
    async (
      _name,
      mutateWorkflow: (workflow: Record<string, unknown>) => unknown,
      message: string,
    ) => {
      await identifyReject(
        (manifest) => ({
          ...manifest,
          workflow: mutateWorkflow(manifest.workflow as Record<string, unknown>),
        }),
        message,
      );
    },
  );

  it.each([
    ["an extra key", { extra: "x" }],
    ["a malformed electron version", { electronVersion: "next" }],
    ["a malformed lockfile digest", { lockfileSha256: "zzz" }],
    [
      "a non-positive remote bootstrap protocol version",
      { remoteBootstrapProtocolVersion: 0 },
    ],
  ])(
    "rejects a manifest whose build inputs have %s",
    async (_name, patch: Record<string, unknown>) => {
      await identifyReject(
        (manifest) => ({
          ...manifest,
          buildInputs: {
            ...(manifest.buildInputs as Record<string, unknown>),
            ...patch,
          },
        }),
        "Release candidate build inputs are invalid.",
      );
    },
  );

  it.each([
    ["a non-array", () => "not-an-array"],
    [
      "an unknown entry",
      (outputs: Array<Record<string, unknown>>) => [
        ...outputs.slice(1),
        { entry: "mystery", sha256: "c".repeat(64) },
      ],
    ],
    [
      "a duplicated entry",
      (outputs: Array<Record<string, unknown>>) => [...outputs, outputs[0]],
    ],
    ["a missing entry", (outputs: Array<Record<string, unknown>>) => outputs.slice(1)],
    [
      "an entry with an extra key",
      (outputs: Array<Record<string, unknown>>) =>
        outputs.map((output) => ({ ...output, extra: 1 })),
    ],
  ])(
    "rejects a manifest whose build outputs have %s",
    async (_name, mutate: (outputs: Array<Record<string, unknown>>) => unknown) => {
      await identifyReject(
        (manifest) => ({
          ...manifest,
          buildOutputs: mutate(
            manifest.buildOutputs as Array<Record<string, unknown>>,
          ),
        }),
        "Release candidate build outputs are invalid.",
      );
    },
  );

  it.each([
    [
      "an artifact count mismatch",
      (artifacts: Array<Record<string, unknown>>) => artifacts.slice(1),
      "Release candidate artifact evidence is incomplete.",
    ],
    [
      "a file name that does not match the expected plan",
      (artifacts: Array<Record<string, unknown>>) => [
        { ...artifacts[0], fileName: "renamed.dmg" },
        artifacts[1],
      ],
      "Release candidate artifact evidence is invalid.",
    ],
    [
      "a zero byte size",
      (artifacts: Array<Record<string, unknown>>) => [
        { ...artifacts[0], sizeBytes: 0 },
        artifacts[1],
      ],
      "Release candidate artifact evidence is invalid.",
    ],
    [
      "a malformed digest",
      (artifacts: Array<Record<string, unknown>>) => [
        { ...artifacts[0], sha256: "zzz" },
        artifacts[1],
      ],
      "Release candidate artifact evidence is invalid.",
    ],
  ])(
    "rejects a manifest whose artifact evidence has %s",
    async (
      _name,
      mutate: (artifacts: Array<Record<string, unknown>>) => unknown,
      message: string,
    ) => {
      await identifyReject(
        (manifest) => ({
          ...manifest,
          artifacts: mutate(
            manifest.artifacts as Array<Record<string, unknown>>,
          ),
        }),
        message,
      );
    },
  );

  it("rejects a package containing a file the manifest does not declare", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidates");
      await mkdir(candidateRoot);
      await writeSingleCandidate(candidateRoot, {
        extraEntries: [["file", "surprise.txt", "unexpected"]],
        lockfileSha256,
      });
      await expect(
        identifyCandidatePackage({
          candidateRoot,
          expected: releaseContext,
          expectedArchitecture: "arm64",
          expectedPlatform: "darwin",
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Release candidate package contains an unexpected file set.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a package whose artifact bytes disagree with the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidates");
      await mkdir(candidateRoot);
      await writeSingleCandidate(candidateRoot, {
        artifactBytes: (fileName, bytes) =>
          "x".repeat(Buffer.byteLength(bytes)),
        lockfileSha256,
      });
      await expect(
        identifyCandidatePackage({
          candidateRoot,
          expected: releaseContext,
          expectedArchitecture: "arm64",
          expectedPlatform: "darwin",
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Release candidate artifact bytes do not match the manifest.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a package whose lockfile digest does not match the checkout", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidates");
      await mkdir(candidateRoot);
      await writeSingleCandidate(candidateRoot, { lockfileSha256 });
      await writeFile(packageLockPath, '{"changed":true}');
      await expect(
        identifyCandidatePackage({
          candidateRoot,
          expected: releaseContext,
          expectedArchitecture: "arm64",
          expectedPlatform: "darwin",
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Release candidate lockfile digest does not match this checkout.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a candidate whose matrix identity does not match the job", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidates");
      await mkdir(candidateRoot);
      await writeSingleCandidate(candidateRoot, { lockfileSha256 });
      await expect(
        identifyCandidatePackage({
          candidateRoot,
          expected: releaseContext,
          expectedArchitecture: "x64",
          expectedPlatform: "linux",
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Package job candidate target does not match its matrix identity.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a candidate directory whose name is not the release identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-identify-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidates");
      await mkdir(candidateRoot);
      await writeSingleCandidate(candidateRoot, {
        dirName: "skills-desktop-9.9.9-darwin-arm64",
        lockfileSha256,
      });
      await expect(
        identifyCandidatePackage({
          candidateRoot,
          expected: releaseContext,
          expectedArchitecture: "arm64",
          expectedPlatform: "darwin",
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Package job candidate directory identity is invalid.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a candidate set containing a non-directory entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-subjects-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = await writeCandidateSet(root, lockfileSha256);
      await writeFile(join(candidateRoot, "stray.txt"), "nope");
      await expect(
        inspectCandidateSubjects({
          candidateRoot,
          expected: releaseContext,
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Release candidate input contains an unexpected entry.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a candidate set missing a required target", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-subjects-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidate-inputs");
      await mkdir(candidateRoot);
      for (const target of targets.slice(1)) {
        await writeSingleCandidate(candidateRoot, {
          addressed: true,
          architecture: target.architecture,
          lockfileSha256,
          platform: target.platform,
        });
      }
      await expect(
        inspectCandidateSubjects({
          candidateRoot,
          expected: releaseContext,
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Release candidate target set is incomplete or duplicated.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a candidate set mixing more than one version", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-subjects-"));
    try {
      const { packageLockPath, sha256: lockfileSha256 } =
        await writePackageLock(root);
      const candidateRoot = join(root, "candidate-inputs");
      await mkdir(candidateRoot);
      for (const [index, target] of targets.entries()) {
        await writeSingleCandidate(candidateRoot, {
          addressed: true,
          architecture: target.architecture,
          lockfileSha256,
          platform: target.platform,
          version: index === 0 ? "0.1.0" : "0.1.1",
        });
      }
      await expect(
        inspectCandidateSubjects({
          candidateRoot,
          expected: releaseContext,
          packageLockPath,
        }),
      ).rejects.toThrow(
        "Release candidates must share one immutable version.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a malformed expected payload digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-payload-"));
    try {
      const payloadRoot = join(root, "payload");
      await mkdir(payloadRoot);
      await writeFile(join(payloadRoot, "a.dmg"), "bytes");
      await expect(
        verifyDraftPayload({
          expectedPayloadDigest: "not-a-digest",
          payloadRoot,
        }),
      ).rejects.toThrow("Verified draft payload digest is invalid.");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["empty", false],
    ["containing a subdirectory", true],
  ])(
    "rejects a draft payload directory that is %s",
    async (_name, withSubdir: boolean) => {
      const root = await mkdtemp(join(tmpdir(), "skills-release-payload-"));
      try {
        const payloadRoot = join(root, "payload");
        await mkdir(payloadRoot);
        if (withSubdir) await mkdir(join(payloadRoot, "nested"));
        await expect(
          verifyDraftPayload({
            expectedPayloadDigest: "0".repeat(64),
            payloadRoot,
          }),
        ).rejects.toThrow(
          "Verified draft payload contains an unexpected entry.",
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("rejects draft payload bytes that changed during exchange", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-payload-"));
    try {
      const payloadRoot = join(root, "payload");
      await mkdir(payloadRoot);
      await writeFile(join(payloadRoot, "a.dmg"), "bytes");
      await expect(
        verifyDraftPayload({
          expectedPayloadDigest: "0".repeat(64),
          payloadRoot,
        }),
      ).rejects.toThrow(
        "Verified draft payload bytes changed during job exchange.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["an empty versions map", {}],
    ["a malformed package version", { a: "not-semver" }],
    ["an unnamed package", { "": "0.1.0" }],
  ])("rejects preview tag versions with %s", (_name, versions) => {
    expect(() =>
      assertTaggedPreviewVersions({
        sourceRef: "refs/tags/v0.1.0",
        versions,
      }),
    ).toThrow("Unsigned preview package versions are invalid.");
  });

  it.each([
    ["a non-array result", { result: "nope" }],
    ["an ambiguous result", { result: [{}, {}] }],
  ])("rejects attestation verification with %s", (_name, patch) => {
    const statement = {
      predicateType: "https://example.test/predicate",
      subject: [{ digest: { sha256: "d".repeat(64) }, name: "a.dmg" }],
    };
    expect(() =>
      assertVerifiedAttestationResult({
        predicateType: statement.predicateType,
        result: [{ verificationResult: { statement } }],
        subjects: [{ fileName: "a.dmg", sha256: "d".repeat(64) }],
        ...patch,
      }),
    ).toThrow("Verified attestation result is missing or ambiguous.");
  });

  it.each([
    [
      "a missing statement",
      { result: [{ verificationResult: {} }] },
    ],
    [
      "a mismatched predicate type",
      {
        result: [
          {
            verificationResult: {
              statement: {
                predicateType: "other",
                subject: [],
              },
            },
          },
        ],
      },
    ],
    [
      "a malformed statement subject",
      {
        result: [
          {
            verificationResult: {
              statement: {
                predicateType: "https://example.test/predicate",
                subject: [{ name: 42 }],
              },
            },
          },
        ],
      },
      "Verified attestation subjects are incomplete or changed.",
    ],
    [
      "invalid expected subjects",
      { subjects: [{ fileName: "a.dmg" }] },
      "Expected attestation subjects are invalid.",
    ],
  ])(
    "rejects attestation verification with %s",
    (
      _name,
      patch: Record<string, unknown>,
      message = "Verified attestation result is invalid.",
    ) => {
      const statement = {
        predicateType: "https://example.test/predicate",
        subject: [{ digest: { sha256: "d".repeat(64) }, name: "a.dmg" }],
      };
      expect(() =>
        assertVerifiedAttestationResult({
          predicateType: statement.predicateType,
          result: [{ verificationResult: { statement } }],
          subjects: [{ fileName: "a.dmg", sha256: "d".repeat(64) }],
          ...patch,
        }),
      ).toThrow(message);
    },
  );

  const githubFiles = { "a.dmg": "first", "b.zip": "second" };
  const payloadDigestFor = (files: Record<string, string>) =>
    sha256(
      Object.entries(files)
        .map(([fileName, content]) => `${sha256(content)} *${fileName}\n`)
        .sort()
        .join(""),
    );

  function githubExpected(payloadDigest: string) {
    return {
      candidateSetDigest: "1".repeat(64),
      evidenceSetDigest: "2".repeat(64),
      payloadDigest,
      repository: releaseContext.repository,
      sourceCommit: releaseContext.sourceCommit,
      sourceRef: "refs/heads/main",
      version: "0.1.0",
      workflowRunUrl: `https://github.com/${releaseContext.repository}/actions/runs/777`,
    };
  }

  function githubRelease(
    expected: ReturnType<typeof githubExpected>,
    files: Record<string, string>,
    patch: Record<string, unknown> = {},
  ) {
    return {
      assets: Object.entries(files).map(([name, content]) => ({
        digest: `sha256:${sha256(content)}`,
        name,
        size: Buffer.byteLength(content),
        state: "uploaded",
      })),
      body: createPreviewReleaseNotes(expected),
      draft: true,
      html_url: `https://github.com/${releaseContext.repository}/releases/tag/candidate`,
      name: previewReleaseName(expected),
      prerelease: true,
      published_at: null,
      tag_name: previewReleaseTag(expected),
      target_commitish: releaseContext.sourceCommit,
      ...patch,
    };
  }

  it.each([
    [
      "a missing required key",
      (expected: Record<string, unknown>) => {
        const { repository: _repository, ...missing } = expected;
        return missing;
      },
    ],
    [
      "a workflow run URL outside the repository",
      (expected: Record<string, unknown>) => ({
        ...expected,
        workflowRunUrl: "https://github.com/other/repo/actions/runs/777",
      }),
    ],
  ])(
    "rejects a GitHub draft context with %s",
    async (_name, mutate: (expected: Record<string, unknown>) => unknown) => {
      const root = await mkdtemp(join(tmpdir(), "skills-release-github-"));
      try {
        const payloadRoot = join(root, "payload");
        await mkdir(payloadRoot);
        for (const [name, content] of Object.entries(githubFiles)) {
          await writeFile(join(payloadRoot, name), content);
        }
        const expected = githubExpected(payloadDigestFor(githubFiles));
        await expect(
          verifyGitHubDraftRelease({
            expected: mutate(expected),
            payloadRoot,
            release: {},
          }),
        ).rejects.toThrow("GitHub draft verification input is invalid.");
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    [
      "a duplicated asset name",
      (assets: Array<Record<string, unknown>>) => [...assets, { ...assets[0] }],
    ],
    [
      "a malformed asset entry",
      (assets: Array<Record<string, unknown>>) => [...assets, { name: 42 }],
    ],
    [
      "an asset whose size does not match the payload",
      (assets: Array<Record<string, unknown>>) => [
        { ...assets[0], size: 999_999 },
        assets[1],
      ],
    ],
    [
      "an asset that is not uploaded",
      (assets: Array<Record<string, unknown>>) => [
        { ...assets[0], state: "starter" },
        assets[1],
      ],
    ],
    [
      "an asset whose digest does not match the payload",
      (assets: Array<Record<string, unknown>>) => [
        { ...assets[0], digest: `sha256:${"0".repeat(64)}` },
        assets[1],
      ],
    ],
    [
      "an extra remote asset",
      (assets: Array<Record<string, unknown>>) => [
        ...assets,
        {
          digest: `sha256:${"0".repeat(64)}`,
          name: "extra.zip",
          size: 4,
          state: "uploaded",
        },
      ],
    ],
  ])(
    "rejects GitHub draft assets with %s",
    async (
      _name,
      mutate: (assets: Array<Record<string, unknown>>) => unknown[],
    ) => {
      const root = await mkdtemp(join(tmpdir(), "skills-release-github-"));
      try {
        const payloadRoot = join(root, "payload");
        await mkdir(payloadRoot);
        for (const [name, content] of Object.entries(githubFiles)) {
          await writeFile(join(payloadRoot, name), content);
        }
        const expected = githubExpected(payloadDigestFor(githubFiles));
        const release = githubRelease(expected, githubFiles);
        release.assets = mutate(
          release.assets,
        ) as typeof release.assets;
        await expect(
          verifyGitHubDraftRelease({ expected, payloadRoot, release }),
        ).rejects.toThrow(
          "GitHub draft assets are missing, duplicated, extra, or changed.",
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    [
      "a still-draft release",
      { draft: true, published_at: "2026-09-29T00:00:00Z" },
    ],
    ["a non-prerelease", { prerelease: false }],
    ["an unparseable publish date", { published_at: "not-a-date" }],
  ])("rejects a GitHub preview release that is %s", async (_name, patch) => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-github-"));
    try {
      const payloadRoot = join(root, "payload");
      await mkdir(payloadRoot);
      for (const [name, content] of Object.entries(githubFiles)) {
        await writeFile(join(payloadRoot, name), content);
      }
      const expected = githubExpected(payloadDigestFor(githubFiles));
      const release = githubRelease(expected, githubFiles, {
        draft: false,
        published_at: "2026-09-29T00:00:00Z",
        ...patch,
      });
      await expect(
        verifyGitHubPreviewRelease({ expected, payloadRoot, release }),
      ).rejects.toThrow(
        "GitHub candidate release is not a public developer preview.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("release integrity evidence pipeline failure arms", () => {
  async function generateEvidence(root: string) {
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
    return { candidateRoot, evidenceRoot, generated, packageLockPath };
  }

  async function writeBundles(root: string) {
    const bundleRoot = join(root, "bundles");
    await mkdir(bundleRoot);
    const bundles = {
      candidateIdentity: join(bundleRoot, "identity.json"),
      provenance: join(bundleRoot, "provenance.json"),
      sbom: join(bundleRoot, "sbom.json"),
    };
    for (const [kind, path] of Object.entries(bundles)) {
      await writeFile(path, `${JSON.stringify({ kind })}\n`);
    }
    return bundles;
  }

  const bundleSet = (bundles: Record<string, string>) => bundles;

  it("rejects an attestation bundle set with an unexpected key shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-finalize-"));
    try {
      const { evidenceRoot, generated } = await generateEvidence(root);
      await expect(
        finalizeReleaseEvidence({
          attestationBundles: { provenance: "x" },
          evidenceRoot,
          expectedCandidateSetDigest: generated.candidateSetDigest,
        }),
      ).rejects.toThrow("Release attestation bundle set is invalid.");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["is not valid JSON", () => "not json{"],
    ["is not a plain object", () => "[]"],
    [
      "has the wrong schema version",
      (predicate: Record<string, unknown>) => ({
        ...predicate,
        schemaVersion: 2,
      }),
    ],
    [
      "binds a different candidate set",
      (predicate: Record<string, unknown>) => ({
        ...predicate,
        candidateSetDigest: "0".repeat(64),
      }),
    ],
    [
      "has a malformed version",
      (predicate: Record<string, unknown>) => ({
        ...predicate,
        version: "v0",
      }),
    ],
  ])(
    "rejects provenance evidence that %s",
    async (_name, mutate: (predicate: Record<string, unknown>) => unknown) => {
      const root = await mkdtemp(join(tmpdir(), "skills-release-finalize-"));
      try {
        const { evidenceRoot, generated } = await generateEvidence(root);
        const predicatePath = join(
          evidenceRoot,
          "candidate-provenance-v1.json",
        );
        const predicate = JSON.parse(await readFile(predicatePath, "utf8"));
        const mutated = mutate(predicate);
        await writeFile(
          predicatePath,
          typeof mutated === "string" ? mutated : JSON.stringify(mutated),
        );
        await expect(
          finalizeReleaseEvidence({
            attestationBundles: bundleSet({
              candidateIdentity: "unused",
              provenance: "unused",
              sbom: "unused",
            }),
            evidenceRoot,
            expectedCandidateSetDigest: generated.candidateSetDigest,
          }),
        ).rejects.toThrow("Release candidate provenance evidence is invalid.");
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("rejects an unexpected pre-attestation evidence file", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-finalize-"));
    try {
      const { evidenceRoot, generated } = await generateEvidence(root);
      await writeFile(join(evidenceRoot, "stray.txt"), "unexpected");
      const bundles = await writeBundles(root);
      await expect(
        finalizeReleaseEvidence({
          attestationBundles: bundleSet(bundles),
          evidenceRoot,
          expectedCandidateSetDigest: generated.candidateSetDigest,
        }),
      ).rejects.toThrow(
        "Release evidence contains an unexpected pre-attestation file set.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    [
      "a non-string bundle path",
      (bundles: Record<string, string>) => ({ ...bundles, sbom: 42 }),
    ],
    [
      "a missing bundle file",
      (bundles: Record<string, string>) => ({
        ...bundles,
        sbom: join(bundles.sbom, "..", "missing.json"),
      }),
    ],
  ])(
    "rejects attestation bundles with %s",
    async (
      _name,
      mutate: (bundles: Record<string, string>) => Record<string, unknown>,
    ) => {
      const root = await mkdtemp(join(tmpdir(), "skills-release-finalize-"));
      try {
        const { evidenceRoot, generated } = await generateEvidence(root);
        const bundles = await writeBundles(root);
        await expect(
          finalizeReleaseEvidence({
            attestationBundles: bundleSet(mutate(bundles) as Record<string, string>),
            evidenceRoot,
            expectedCandidateSetDigest: generated.candidateSetDigest,
          }),
        ).rejects.toThrow("Release attestation bundle");
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    ["an empty bundle file", async (path: string) => writeFile(path, "")],
    [
      "a bundle that is not valid JSON",
      async (path: string) => writeFile(path, "{nope"),
    ],
    [
      "a bundle that is not a plain object",
      async (path: string) => writeFile(path, "[1]"),
    ],
  ])(
    "rejects %s",
    async (_name, corrupt: (path: string) => Promise<unknown>) => {
      const root = await mkdtemp(join(tmpdir(), "skills-release-finalize-"));
      try {
        const { evidenceRoot, generated } = await generateEvidence(root);
        const bundles = await writeBundles(root);
        await corrupt(bundles.sbom);
        await expect(
          finalizeReleaseEvidence({
            attestationBundles: bundleSet(bundles),
            evidenceRoot,
            expectedCandidateSetDigest: generated.candidateSetDigest,
          }),
        ).rejects.toThrow("Release attestation bundle is invalid.");
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("rejects evidence generation when the package lock shape is unsupported", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-evidence-"));
    try {
      const packageLockPath = join(root, "package-lock.json");
      const bytes = '{"lockfileVersion":2,"packages":{}}\n';
      await writeFile(packageLockPath, bytes);
      const candidateRoot = await writeCandidateSet(root, sha256(bytes));
      const outputRoot = join(root, "evidence");
      await expect(
        generateReleaseEvidence({
          candidateRoot,
          createdAt: "2026-08-22T08:00:00.000Z",
          expected: releaseContext,
          outputRoot,
          packageLockPath,
        }),
      ).rejects.toThrow("Release package lock is unsupported.");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  async function sealedEvidence(root: string) {
    const fixture = await generateEvidence(root);
    const bundles = await writeBundles(root);
    const finalized = await finalizeReleaseEvidence({
      attestationBundles: bundles,
      evidenceRoot: fixture.evidenceRoot,
      expectedCandidateSetDigest: fixture.generated.candidateSetDigest,
    });
    return { ...fixture, finalized };
  }

  const assemble = (
    fixture: Awaited<ReturnType<typeof sealedEvidence>>,
    root: string,
    attestationPatch: Record<string, unknown> = {},
  ) =>
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
        ...attestationPatch,
      },
      candidateRoot: fixture.candidateRoot,
      evidenceRoot: fixture.evidenceRoot,
      expected: releaseContext,
      expectedEvidenceArtifactDigest: fixture.finalized.evidenceArtifactDigest,
      expectedEvidenceSetDigest: fixture.finalized.evidenceSetDigest,
      outputRoot: join(root, "verified-draft"),
      packageLockPath: fixture.packageLockPath,
      verifiedAt: "2026-08-22T08:05:00.000Z",
    });

  it.each([
    [
      "a missing receipt key",
      { predicateTypes: undefined },
      "Release attestation verification receipt is invalid.",
    ],
    [
      "an incomplete predicate type set",
      { predicateTypes: [SLSA_PROVENANCE_PREDICATE_TYPE] },
      "Release attestation verification receipt is invalid.",
    ],
    [
      "a signer workflow outside the repository",
      { signerWorkflow: "other/repo/.github/workflows/release-candidates.yml" },
      "Release attestation verification receipt is invalid.",
    ],
    [
      "a malformed source ref",
      { sourceRef: "main" },
      "Release attestation verification receipt is invalid.",
    ],
  ])(
    "rejects the attestation receipt with %s",
    async (
      _name,
      patch: Record<string, unknown>,
      message: string,
    ) => {
      const root = await mkdtemp(join(tmpdir(), "skills-release-assemble-"));
      try {
        const fixture = await sealedEvidence(root);
        await expect(assemble(fixture, root, patch)).rejects.toThrow(message);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  const readIndex = async (evidenceRoot: string) =>
    JSON.parse(
      await readFile(join(evidenceRoot, "candidate-evidence-v1.json"), "utf8"),
    ) as Record<string, unknown>;

  const writeIndex = (evidenceRoot: string, index: unknown) =>
    writeFile(
      join(evidenceRoot, "candidate-evidence-v1.json"),
      typeof index === "string" ? index : JSON.stringify(index),
    );

  it("rejects a missing or unparsable evidence index", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-assemble-"));
    try {
      const fixture = await sealedEvidence(root);
      await rm(join(fixture.evidenceRoot, "candidate-evidence-v1.json"));
      await writeFile(
        join(fixture.evidenceRoot, "filler.txt"),
        "keeps the file count exact",
      );
      await expect(assemble(fixture, root)).rejects.toThrow(
        "Release evidence contains an unexpected file set.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    [
      "an unexpected schema version",
      (index: Record<string, unknown>) => ({ ...index, schemaVersion: 2 }),
      "Release evidence index is invalid.",
    ],
    [
      "a wrong version field",
      (index: Record<string, unknown>) => ({ ...index, version: "9.9.9" }),
      "Release evidence index is invalid.",
    ],
    [
      "a truncated file list",
      (index: Record<string, unknown>) => ({
        ...index,
        files: (index.files as unknown[]).slice(1),
      }),
      "Release evidence index is incomplete.",
    ],
    [
      "a file entry with an unexpected kind",
      (index: Record<string, unknown>) => {
        const files = [...(index.files as Array<Record<string, unknown>>)];
        files[0] = { ...files[0], kind: "mystery" };
        return { ...index, files };
      },
      "Release evidence index is invalid.",
    ],
    [
      "a file entry with a malformed digest",
      (index: Record<string, unknown>) => {
        const files = [...(index.files as Array<Record<string, unknown>>)];
        files[0] = { ...files[0], sha256: "zzz" };
        return { ...index, files };
      },
      "Release evidence index is invalid.",
    ],
    [
      "a duplicated file entry",
      (index: Record<string, unknown>) => {
        const files = [...(index.files as Array<Record<string, unknown>>)];
        files[0] = { ...files[1] };
        return { ...index, files };
      },
      "Release evidence index is invalid.",
    ],
  ])(
    "rejects an evidence index with %s",
    async (
      _name,
      mutate: (index: Record<string, unknown>) => unknown,
      message: string,
    ) => {
      const root = await mkdtemp(join(tmpdir(), "skills-release-assemble-"));
      try {
        const fixture = await sealedEvidence(root);
        const index = await readIndex(fixture.evidenceRoot);
        await writeIndex(fixture.evidenceRoot, mutate(index));
        await expect(assemble(fixture, root)).rejects.toThrow(message);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("rejects an evidence index whose candidate set digest differs", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-assemble-"));
    try {
      const fixture = await sealedEvidence(root);
      const index = await readIndex(fixture.evidenceRoot);
      await writeIndex(fixture.evidenceRoot, {
        ...index,
        candidateSetDigest: "0".repeat(64),
      });
      await expect(assemble(fixture, root)).rejects.toThrow(
        "Release evidence digest identity does not match verified inputs.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a directory inside the pre-attestation evidence root", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-finalize-"));
    try {
      const { evidenceRoot, generated } = await generateEvidence(root);
      await mkdir(join(evidenceRoot, "stray-directory"));
      const bundles = await writeBundles(root);
      await expect(
        finalizeReleaseEvidence({
          attestationBundles: bundleSet(bundles),
          evidenceRoot,
          expectedCandidateSetDigest: generated.candidateSetDigest,
        }),
      ).rejects.toThrow(
        "Release evidence contains an unexpected pre-attestation file set.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("deduplicates lock dependencies and tolerates entries without checksums", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-evidence-"));
    try {
      const packageLockPath = join(root, "package-lock.json");
      const bytes = `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "skills-desktop", version: "0.1.0" },
          "node_modules/reused": { version: "1.0.0" },
          "nested/node_modules/reused": { version: "1.0.0" },
          "node_modules/unnamed": {
            integrity: "sha256-not-sha512",
            version: "2.0.0",
          },
        },
      })}\n`;
      await writeFile(packageLockPath, bytes);
      const candidateRoot = await writeCandidateSet(root, sha256(bytes));
      const outputRoot = join(root, "evidence");

      const generated = await generateReleaseEvidence({
        candidateRoot,
        createdAt: "2026-08-22T08:00:00.000Z",
        expected: releaseContext,
        outputRoot,
        packageLockPath,
      });

      const sbom = JSON.parse(
        await readFile(
          join(outputRoot, "skills-desktop-0.1.0.spdx.json"),
          "utf8",
        ),
      ) as {
        packages: Array<{ name: string; checksums?: unknown[] }>;
      };
      const reused = sbom.packages.filter((pkg) => pkg.name === "reused");
      expect(reused).toHaveLength(1);
      const unnamed = sbom.packages.find((pkg) => pkg.name === "unnamed");
      expect(unnamed?.checksums).toBeUndefined();
      expect(generated.candidateSetDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects evidence bytes that disagree with the index", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-assemble-"));
    try {
      const fixture = await sealedEvidence(root);
      // Grow SHA256SUMS by one byte without updating the index: the recorded
      // digest no longer matches the file on disk.
      await writeFile(
        join(fixture.evidenceRoot, "SHA256SUMS"),
        (await readFile(join(fixture.evidenceRoot, "SHA256SUMS"), "utf8")) +
          "\n",
      );
      await expect(assemble(fixture, root)).rejects.toThrow(
        "Release evidence bytes do not match the evidence index.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects an evidence set digest that no longer matches the declared files", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-assemble-"));
    try {
      const fixture = await sealedEvidence(root);
      const index = await readIndex(fixture.evidenceRoot);
      const files = index.files as Array<Record<string, unknown>>;
      const target = files.find((file) => file.fileName === "SHA256SUMS")!;
      const original = await readFile(
        join(fixture.evidenceRoot, "SHA256SUMS"),
        "utf8",
      );
      const replacement = `${original}x`;
      target.sha256 = sha256(replacement);
      target.sizeBytes = Buffer.byteLength(replacement);
      await writeFile(join(fixture.evidenceRoot, "SHA256SUMS"), replacement);
      await writeIndex(fixture.evidenceRoot, index);
      await expect(assemble(fixture, root)).rejects.toThrow(
        "Release evidence set digest is invalid.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects an evidence artifact digest drifted by index bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-release-assemble-"));
    try {
      const fixture = await sealedEvidence(root);
      // Reformatting the index keeps every declared value identical but
      // changes its bytes, so the artifact digest no longer matches.
      const indexPath = join(
        fixture.evidenceRoot,
        "candidate-evidence-v1.json",
      );
      const index = await readIndex(fixture.evidenceRoot);
      await writeFile(indexPath, JSON.stringify(index, null, 2));
      await expect(assemble(fixture, root)).rejects.toThrow(
        "Release evidence artifact digest is invalid.",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
