import { appendFile, readFile, writeFile } from "node:fs/promises";

import {
  CANDIDATE_IDENTITY_PREDICATE_TYPE,
  SPDX_PREDICATE_TYPE,
  SLSA_PROVENANCE_PREDICATE_TYPE,
  assembleVerifiedDraft,
  assertVerifiedAttestationResult,
  createDraftReleaseNotes,
  draftReleaseName,
  draftReleaseTag,
  finalizeReleaseEvidence,
  generateReleaseEvidence,
  identifyCandidatePackage,
  inspectCandidateSubjects,
  verifyDraftPayload,
  verifyGitHubDraftRelease,
} from "./release-integrity.mjs";

const commonContextOptions = [
  "--repository",
  "--source-commit",
  "--workflow-event",
  "--workflow-name",
  "--workflow-run-attempt",
  "--workflow-run-id",
];

function parseOptions(argv, allowedNames) {
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

function releaseContext(options) {
  return {
    repository: options["--repository"],
    sourceCommit: options["--source-commit"],
    workflowEvent: options["--workflow-event"],
    workflowName: options["--workflow-name"],
    workflowRunAttempt: options["--workflow-run-attempt"],
    workflowRunId: options["--workflow-run-id"],
  };
}

async function emitOutputs(outputs) {
  const outputPath = process.env.GITHUB_OUTPUT;
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
    await appendFile(outputPath, lines.join(""));
  }
}

async function readJson(path, message) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(message);
  }
}

async function identify(argv) {
  const options = parseOptions(argv, [
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
  await emitOutputs({
    "candidate-directory": result.candidateDirectory,
    "manifest-digest": result.manifestDigest,
    version: result.version,
  });
  return result;
}

async function generate(argv) {
  const options = parseOptions(argv, [
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
  await emitOutputs({
    "candidate-set-digest": result.candidateSetDigest,
    "predicate-path": `${options["--output-root"]}/candidate-provenance-v1.json`,
    "sbom-path": `${options["--output-root"]}/skills-desktop-${result.version}.spdx.json`,
    "subject-paths": result.subjectPaths.join("\n"),
    version: result.version,
  });
  return result;
}

async function finalize(argv) {
  const options = parseOptions(argv, [
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
  await emitOutputs({
    "candidate-set-digest": result.candidateSetDigest,
    "evidence-artifact-digest": result.evidenceArtifactDigest,
    "evidence-set-digest": result.evidenceSetDigest,
    version: result.version,
  });
  return result;
}

async function subjects(argv) {
  const options = parseOptions(argv, [
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
  const options = parseOptions(argv, required);
  const subjectEvidence = await readJson(
    options["--subjects-json"],
    "Candidate subject evidence is invalid.",
  );
  const result = assertVerifiedAttestationResult({
    expectedPredicate:
      options["--expected-predicate"] === undefined
        ? undefined
        : await readJson(
            options["--expected-predicate"],
            "Expected attestation predicate is invalid.",
          ),
    predicateType: options["--predicate-type"],
    result: await readJson(
      options["--result-json"],
      "Verified attestation result JSON is invalid.",
    ),
    subjects: subjectEvidence.subjects,
  });
  return result;
}

async function assemble(argv) {
  const options = parseOptions(argv, [
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
  await emitOutputs({
    "candidate-set-digest": result.candidateSetDigest,
    "evidence-artifact-digest": result.evidenceArtifactDigest,
    "evidence-set-digest": result.evidenceSetDigest,
    "payload-digest": result.payloadDigest,
    version: result.version,
  });
  return result;
}

async function notes(argv) {
  const options = parseOptions(argv, [
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
    createDraftReleaseNotes({
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
    name: draftReleaseName(identity),
    tag: draftReleaseTag(identity),
  };
  await emitOutputs({
    "release-name": result.name,
    "release-tag": result.tag,
  });
  return result;
}

async function verifyRelease(argv) {
  const options = parseOptions(argv, [
    "--payload-digest",
    "--payload-root",
    "--release-list-json",
    "--repository",
    "--source-commit",
    "--version",
  ]);
  const expected = {
    payloadDigest: options["--payload-digest"],
    repository: options["--repository"],
    sourceCommit: options["--source-commit"],
    version: options["--version"],
  };
  const tag = draftReleaseTag(expected);
  const releases = await readJson(
    options["--release-list-json"],
    "GitHub release response is invalid.",
  );
  if (!Array.isArray(releases)) {
    throw new Error("GitHub release response is invalid.");
  }
  const matches = releases.filter((release) => release?.tag_name === tag);
  if (matches.length !== 1) {
    throw new Error("GitHub draft release is missing or duplicated.");
  }
  const result = await verifyGitHubDraftRelease({
    expected,
    payloadRoot: options["--payload-root"],
    release: matches[0],
  });
  await emitOutputs({
    "draft-state": result.state,
    "draft-tag": result.tag,
    "draft-url": result.url,
  });
  return result;
}

async function preflightDraft(argv) {
  const options = parseOptions(argv, ["--payload-digest", "--payload-root"]);
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
  ["verify-release", verifyRelease],
]);

const [commandName, ...argv] = process.argv.slice(2);
const command = commands.get(commandName);
if (command === undefined) {
  throw new Error(`Unknown release integrity command: ${commandName}`);
}
const result = await command(argv);
process.stdout.write(`${JSON.stringify(result)}\n`);
