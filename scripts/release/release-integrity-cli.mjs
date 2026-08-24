import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANDIDATE_IDENTITY_PREDICATE_TYPE,
  SPDX_PREDICATE_TYPE,
  SLSA_PROVENANCE_PREDICATE_TYPE,
  assembleVerifiedDraft,
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
} from "./release-integrity.mjs";

const commonContextOptions = [
  "--repository",
  "--source-commit",
  "--workflow-event",
  "--workflow-name",
  "--workflow-run-attempt",
  "--workflow-run-id",
];

export function parseReleaseIntegrityOptions(argv, allowedNames) {
  const allowed = new Set(allowedNames);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) {
      throw new Error(`Unknown release integrity argument: ${name}`);
    }
    if (
      value === undefined ||
      value.startsWith("--") ||
      value.includes("\0") ||
      value.includes("\r") ||
      value.includes("\n")
    ) {
      throw new Error(`Invalid release integrity argument: ${name}`);
    }
    if (values.has(name)) {
      throw new Error(`Duplicate release integrity argument: ${name}`);
    }
    values.set(name, value);
  }
  for (const name of allowed) {
    if (!values.has(name)) {
      throw new Error(`Missing release integrity argument: ${name}`);
    }
  }
  return Object.fromEntries(values);
}

export function releaseContext(options) {
  return {
    repository: options["--repository"],
    sourceCommit: options["--source-commit"],
    workflowEvent: options["--workflow-event"],
    workflowName: options["--workflow-name"],
    workflowRunAttempt: options["--workflow-run-attempt"],
    workflowRunId: options["--workflow-run-id"],
  };
}

export async function emitReleaseOutputs(
  outputs,
  {
    append = appendFile,
    outputPath = process.env.GITHUB_OUTPUT,
  } = {},
) {
  if (outputPath !== undefined && outputPath !== "") {
    const lines = [];
    for (const [name, value] of Object.entries(outputs)) {
      const text = String(value);
      if (text.includes("\r")) {
        throw new Error("GitHub output contains an unsupported carriage return.");
      }
      if (text.includes("\n")) {
        const delimiter = `SKILLS_DESKTOP_${name.replaceAll("-", "_").toUpperCase()}_EOF`;
        if (text.includes(delimiter)) {
          throw new Error("GitHub output delimiter collision.");
        }
        lines.push(`${name}<<${delimiter}\n${text}\n${delimiter}\n`);
      } else {
        lines.push(`${name}=${text}\n`);
      }
    }
    await append(outputPath, lines.join(""));
  }
}

export async function readReleaseJson(path, message) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(message);
  }
}

async function identify(argv) {
  const options = parseReleaseIntegrityOptions(argv, [
    "--architecture",
    "--candidate-root",
    "--package-lock",
    "--platform",
    ...commonContextOptions,
  ]);
  const result = await identifyCandidatePackage({
    candidateRoot: options["--candidate-root"],
    expected: releaseContext(options),
    expectedArchitecture: options["--architecture"],
    expectedPlatform: options["--platform"],
    packageLockPath: options["--package-lock"],
  });
  await emitReleaseOutputs({
    "candidate-directory": result.candidateDirectory,
    "manifest-digest": result.manifestDigest,
    version: result.version,
  });
  return result;
}

async function generate(argv) {
  const options = parseReleaseIntegrityOptions(argv, [
    "--candidate-root",
    "--created-at",
    "--output-root",
    "--package-lock",
    ...commonContextOptions,
  ]);
  const result = await generateReleaseEvidence({
    candidateRoot: options["--candidate-root"],
    createdAt: options["--created-at"],
    expected: releaseContext(options),
    outputRoot: options["--output-root"],
    packageLockPath: options["--package-lock"],
  });
  await emitReleaseOutputs({
    "candidate-set-digest": result.candidateSetDigest,
    "predicate-path": `${options["--output-root"]}/candidate-provenance-v1.json`,
    "sbom-path": `${options["--output-root"]}/skills-desktop-${result.version}.spdx.json`,
    "subject-paths": result.subjectPaths.join("\n"),
    version: result.version,
  });
  return result;
}

async function finalize(argv) {
  const options = parseReleaseIntegrityOptions(argv, [
    "--candidate-identity-bundle",
    "--candidate-set-digest",
    "--evidence-root",
    "--provenance-bundle",
    "--sbom-bundle",
  ]);
  const result = await finalizeReleaseEvidence({
    attestationBundles: {
      candidateIdentity: options["--candidate-identity-bundle"],
      provenance: options["--provenance-bundle"],
      sbom: options["--sbom-bundle"],
    },
    evidenceRoot: options["--evidence-root"],
    expectedCandidateSetDigest: options["--candidate-set-digest"],
  });
  await emitReleaseOutputs({
    "candidate-set-digest": result.candidateSetDigest,
    "evidence-artifact-digest": result.evidenceArtifactDigest,
    "evidence-set-digest": result.evidenceSetDigest,
    version: result.version,
  });
  return result;
}

async function subjects(argv) {
  const options = parseReleaseIntegrityOptions(argv, [
    "--candidate-root",
    "--output-path",
    "--package-lock",
    ...commonContextOptions,
  ]);
  const result = await inspectCandidateSubjects({
    candidateRoot: options["--candidate-root"],
    expected: releaseContext(options),
    packageLockPath: options["--package-lock"],
  });
  await writeFile(
    options["--output-path"],
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: "wx" },
  );
  return {
    candidateSetDigest: result.candidateSetDigest,
    subjectCount: result.subjects.length,
    version: result.version,
  };
}

async function verifyAttestation(argv) {
  const allowed = [
    "--expected-predicate",
    "--predicate-type",
    "--result-json",
    "--subjects-json",
  ];
  const providedNames = new Set(argv.filter((_value, index) => index % 2 === 0));
  const required = providedNames.has("--expected-predicate")
    ? allowed
    : allowed.filter((name) => name !== "--expected-predicate");
  const options = parseReleaseIntegrityOptions(argv, required);
  const subjectEvidence = await readReleaseJson(
    options["--subjects-json"],
    "Candidate subject evidence is invalid.",
  );
  const result = assertVerifiedAttestationResult({
    expectedPredicate:
      options["--expected-predicate"] === undefined
        ? undefined
        : await readReleaseJson(
            options["--expected-predicate"],
            "Expected attestation predicate is invalid.",
          ),
    predicateType: options["--predicate-type"],
    result: await readReleaseJson(
      options["--result-json"],
      "Verified attestation result JSON is invalid.",
    ),
    subjects: subjectEvidence.subjects,
  });
  return result;
}

async function assemble(argv) {
  const options = parseReleaseIntegrityOptions(argv, [
    "--candidate-root",
    "--evidence-artifact-digest",
    "--evidence-root",
    "--evidence-set-digest",
    "--output-root",
    "--package-lock",
    "--signer-workflow",
    "--source-ref",
    "--verified-at",
    ...commonContextOptions,
  ]);
  const result = await assembleVerifiedDraft({
    attestation: {
      predicateTypes: [
        SLSA_PROVENANCE_PREDICATE_TYPE,
        SPDX_PREDICATE_TYPE,
        CANDIDATE_IDENTITY_PREDICATE_TYPE,
      ],
      signerWorkflow: options["--signer-workflow"],
      sourceRef: options["--source-ref"],
    },
    candidateRoot: options["--candidate-root"],
    evidenceRoot: options["--evidence-root"],
    expected: releaseContext(options),
    expectedEvidenceArtifactDigest: options["--evidence-artifact-digest"],
    expectedEvidenceSetDigest: options["--evidence-set-digest"],
    outputRoot: options["--output-root"],
    packageLockPath: options["--package-lock"],
    verifiedAt: options["--verified-at"],
  });
  await emitReleaseOutputs({
    "candidate-set-digest": result.candidateSetDigest,
    "evidence-artifact-digest": result.evidenceArtifactDigest,
    "evidence-set-digest": result.evidenceSetDigest,
    "payload-digest": result.payloadDigest,
    version: result.version,
  });
  return result;
}

async function notes(argv) {
  const options = parseReleaseIntegrityOptions(argv, [
    "--candidate-set-digest",
    "--evidence-set-digest",
    "--output-path",
    "--payload-digest",
    "--repository",
    "--source-commit",
    "--version",
    "--workflow-run-url",
  ]);
  const identity = {
    sourceCommit: options["--source-commit"],
    version: options["--version"],
  };
  await writeFile(
    options["--output-path"],
    createPreviewReleaseNotes({
      candidateSetDigest: options["--candidate-set-digest"],
      evidenceSetDigest: options["--evidence-set-digest"],
      payloadDigest: options["--payload-digest"],
      repository: options["--repository"],
      ...identity,
      workflowRunUrl: options["--workflow-run-url"],
    }),
    { flag: "wx" },
  );
  const result = {
    name: previewReleaseName(identity),
    tag: previewReleaseTag(identity),
  };
  await emitReleaseOutputs({
    "release-name": result.name,
    "release-tag": result.tag,
  });
  return result;
}

async function verifyGitHubReleaseCommand(
  argv,
  { missingMessage, outputPrefix, verify },
) {
  const options = parseReleaseIntegrityOptions(argv, [
    "--candidate-set-digest",
    "--evidence-set-digest",
    "--payload-digest",
    "--payload-root",
    "--release-list-json",
    "--repository",
    "--source-commit",
    "--version",
    "--workflow-run-url",
  ]);
  const expected = {
    candidateSetDigest: options["--candidate-set-digest"],
    evidenceSetDigest: options["--evidence-set-digest"],
    payloadDigest: options["--payload-digest"],
    repository: options["--repository"],
    sourceCommit: options["--source-commit"],
    version: options["--version"],
    workflowRunUrl: options["--workflow-run-url"],
  };
  const tag = previewReleaseTag(expected);
  const releases = await readReleaseJson(
    options["--release-list-json"],
    "GitHub release response is invalid.",
  );
  if (!Array.isArray(releases)) {
    throw new Error("GitHub release response is invalid.");
  }
  const matches = releases.filter((release) => release?.tag_name === tag);
  if (matches.length !== 1) {
    throw new Error(missingMessage);
  }
  const result = await verify({
    expected,
    payloadRoot: options["--payload-root"],
    release: matches[0],
  });
  await emitReleaseOutputs({
    [`${outputPrefix}-state`]: result.state,
    [`${outputPrefix}-tag`]: result.tag,
    [`${outputPrefix}-url`]: result.url,
  });
  return result;
}

async function verifyRelease(argv) {
  return verifyGitHubReleaseCommand(argv, {
    missingMessage: "GitHub draft release is missing or duplicated.",
    outputPrefix: "draft",
    verify: verifyGitHubDraftRelease,
  });
}

async function verifyPreviewRelease(argv) {
  return verifyGitHubReleaseCommand(argv, {
    missingMessage: "GitHub preview release is missing or duplicated.",
    outputPrefix: "preview",
    verify: verifyGitHubPreviewRelease,
  });
}

async function preflightDraft(argv) {
  const options = parseReleaseIntegrityOptions(argv, [
    "--payload-digest",
    "--payload-root",
  ]);
  const result = await verifyDraftPayload({
    expectedPayloadDigest: options["--payload-digest"],
    payloadRoot: options["--payload-root"],
  });
  return {
    assetCount: result.assets.length,
    payloadDigest: result.payloadDigest,
  };
}

const commands = new Map([
  ["assemble", assemble],
  ["finalize", finalize],
  ["generate", generate],
  ["identify", identify],
  ["notes", notes],
  ["preflight-draft", preflightDraft],
  ["subjects", subjects],
  ["verify-attestation", verifyAttestation],
  ["verify-preview-release", verifyPreviewRelease],
  ["verify-release", verifyRelease],
]);

export async function runReleaseIntegrityCommand(
  [commandName, ...argv],
  {
    commandHandlers = commands,
    writeOutput = (value) => process.stdout.write(value),
  } = {},
) {
  const command = commandHandlers.get(commandName);
  if (command === undefined) {
    throw new Error(`Unknown release integrity command: ${commandName}`);
  }
  const result = await command(argv);
  writeOutput(`${JSON.stringify(result)}\n`);
  return result;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runReleaseIntegrityCommand(process.argv.slice(2));
}
