import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const pinnedAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/;

describe("unsigned candidate workflow contract", () => {
  it("checks out the root lockfile with platform-independent bytes", async () => {
    const attributes = await readFile(
      new URL("../.gitattributes", import.meta.url),
      "utf8",
    );

    expect(attributes.split(/\r?\n/)).toContain("package-lock.json text eol=lf");
  });

  it("loads the release integrity CLI with Node's native ESM loader", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../scripts/release/release-integrity-cli.mjs",
            import.meta.url,
          ),
        ),
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Unknown release integrity command: undefined",
    );
    expect(result.stderr).not.toContain("SyntaxError");
  });

  it("keeps unsigned installation guidance bounded to verified local overrides", async () => {
    const guide = await readFile(
      new URL("../docs/unsigned-developer-preview.md", import.meta.url),
      "utf8",
    );

    expect(guide).toContain("gh attestation verify");
    expect(guide).toContain("--source-digest");
    expect(guide).toContain("codesign --force --deep --sign -");
    expect(guide).toContain("Open Anyway");
    expect(guide).toContain(
      "A public self-signed certificate is not trusted by Windows by default.",
    );
    expect(guide).toContain("normal package tool");
    expect(guide).not.toMatch(
      /\bxattr\b|spctl\s+--master-disable|certutil.+-addstore|Import-Certificate/i,
    );
  });

  it("keeps build, verification, staging, and explicit preview publication distinct", async () => {
    const source = await readFile(
      new URL("../.github/workflows/release-candidates.yml", import.meta.url),
      "utf8",
    );
    const workflow = parse(source);

    expect(workflow.name).toBe("Unsigned Release Candidates");
    expect(Object.keys(workflow.on).sort()).toEqual([
      "pull_request",
      "push",
      "workflow_dispatch",
    ]);
    expect(workflow.on.push).toEqual({
      branches: ["main"],
      tags: ["v*.*.*"],
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.on.workflow_dispatch.inputs.publish_preview).toEqual({
      default: false,
      description:
        "Publish the verified draft as an unsigned developer preview",
      required: true,
      type: "boolean",
    });
    expect(Object.keys(workflow.jobs)).toEqual([
      "quality-gates",
      "packaged-ui-qa",
      "package",
      "evidence",
      "verify",
      "draft-assembly",
      "publish-preview",
    ]);

    const qualityJob = workflow.jobs["quality-gates"];
    expect(qualityJob.uses).toBe("./.github/workflows/verify.yml");
    expect(qualityJob.permissions).toEqual({ contents: "read" });
    expect(qualityJob.if).toContain("github.ref_type == 'tag'");
    const packagedQaJob = workflow.jobs["packaged-ui-qa"];
    expect(packagedQaJob.uses).toBe("./.github/workflows/packaged-ui-qa.yml");
    expect(packagedQaJob.permissions).toEqual({ contents: "read" });
    expect(packagedQaJob.if).toContain("github.ref_type == 'tag'");

    const packageJob = workflow.jobs.package;
    expect(packageJob.if).toContain("github.ref == 'refs/heads/main'");
    expect(packageJob.permissions).toEqual({ contents: "read" });
    expect(packageJob["runs-on"]).toBe("${{ fromJSON(matrix.runner) }}");
    expect(packageJob.strategy.matrix.include).toEqual([
      { architecture: "arm64", platform: "darwin", runner: '"macos-15"' },
      { architecture: "x64", platform: "darwin", runner: '"macos-15"' },
      { architecture: "x64", platform: "win32", runner: '"windows-2025"' },
      {
        architecture: "x64",
        platform: "linux",
        runner: '"ubuntu-24.04"',
      },
    ]);
    const packageSteps = packageJob.steps;
    const checkout = packageSteps.find((step: { name?: string }) =>
      step.name?.startsWith("Check out"),
    );
    expect(checkout.with["fetch-depth"]).toBe(0);
    expect(checkout.with["persist-credentials"]).toBe(false);
    const validateTag = packageSteps.find(
      (step: { name?: string }) => step.name === "Validate exact version tag",
    );
    expect(validateTag.if).toBe("github.ref_type == 'tag'");
    expect(validateTag.run).toContain("release-integrity-cli.mjs validate-tag");
    expect(validateTag.run).toContain('--source-ref "${{ github.ref }}"');
    const verifyTagCommit = packageSteps.find(
      (step: { name?: string }) =>
        step.name === "Verify tagged commit belongs to main",
    );
    expect(verifyTagCommit.if).toBe("github.ref_type == 'tag'");
    expect(verifyTagCommit.run).toContain("git merge-base --is-ancestor");
    const install = packageSteps.find(
      (step: { name?: string }) => step.name === "Install locked dependencies",
    );
    expect(packageSteps.indexOf(validateTag)).toBeLessThan(
      packageSteps.indexOf(install),
    );
    expect(packageSteps.indexOf(verifyTagCommit)).toBeLessThan(
      packageSteps.indexOf(install),
    );
    const linuxPrerequisites = packageSteps.find(
      (step: { name?: string }) =>
        step.name === "Install official Linux maker prerequisites",
    );
    expect(linuxPrerequisites.if).toBe("matrix.platform == 'linux'");
    expect(linuxPrerequisites.run).toBe(
      "sudo apt-get install --no-install-recommends --yes fakeroot rpm",
    );
    const generate = packageSteps.find(
      (step: { name?: string }) => step.name === "Generate unsigned candidate",
    );
    expect(generate.run).toContain("npm run candidate:build --");
    expect(generate.run).not.toMatch(/publish|release create|release upload/i);
    expect(packageSteps.indexOf(linuxPrerequisites)).toBeLessThan(
      packageSteps.indexOf(generate),
    );
    const identify = packageSteps.find(
      (step: { name?: string }) => step.name === "Identify candidate package",
    );
    expect(identify.id).toBe("identity");
    expect(identify.run).toContain("release-integrity-cli.mjs identify");

    const manifestUpload = packageSteps.find(
      (step: { name?: string }) => step.name === "Retain manifest evidence",
    );
    expect(manifestUpload.if).toContain("github.event_name != 'workflow_dispatch'");
    expect(manifestUpload.if).toContain("github.ref_type != 'tag'");
    expect(manifestUpload.with.name).toBe(
      "unsigned-package-manifest-${{ steps.identity.outputs.manifest-digest }}",
    );
    expect(manifestUpload.with.path).toContain("candidate-manifest-v1.*");
    expect(manifestUpload.with.path).not.toMatch(
      /\.(dmg|zip|exe|nupkg|deb|rpm)$/i,
    );
    const packageUpload = packageSteps.find(
      (step: { name?: string }) =>
        step.name === "Exchange digest-addressed candidate",
    );
    expect(packageUpload.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(packageUpload.if).toContain("github.ref_type == 'tag'");
    expect(packageUpload.with.name).toBe(
      "unsigned-package-${{ steps.identity.outputs.manifest-digest }}",
    );
    expect(packageUpload.with.path).toBe(
      "${{ steps.identity.outputs.candidate-directory }}/**",
    );
    expect(packageUpload.with["retention-days"]).toBe(1);

    const evidenceJob = workflow.jobs.evidence;
    expect(evidenceJob["runs-on"]).toBe("ubuntu-24.04");
    expect(evidenceJob.needs).toBe("package");
    expect(evidenceJob.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(evidenceJob.if).toContain("github.ref == 'refs/heads/main'");
    expect(evidenceJob.if).toContain("github.ref_type == 'tag'");
    expect(evidenceJob.permissions).toEqual({
      "artifact-metadata": "write",
      attestations: "write",
      contents: "read",
      "id-token": "write",
    });
    const evidenceSteps = evidenceJob.steps;
    const downloadPackages = evidenceSteps.find(
      (step: { name?: string }) =>
        step.name === "Download digest-addressed candidates",
    );
    expect(downloadPackages.with.pattern).toBe("unsigned-package-*");
    expect(downloadPackages.with["merge-multiple"]).toBe(false);
    const generateEvidence = evidenceSteps.find(
      (step: { name?: string }) =>
        step.name === "Generate checksums, SPDX SBOM, and identity predicate",
    );
    expect(generateEvidence.id).toBe("generate");
    expect(generateEvidence.run).toContain("release-integrity-cli.mjs generate");
    const attestSteps = evidenceSteps.filter((step: { uses?: string }) =>
      step.uses?.startsWith("actions/attest@"),
    );
    expect(attestSteps).toHaveLength(3);
    expect(attestSteps.map((step: { id?: string }) => step.id).sort()).toEqual([
      "attest-candidate-identity",
      "attest-provenance",
      "attest-sbom",
    ]);
    for (const step of attestSteps) {
      expect(step.with["subject-path"]).toBe(
        "${{ steps.generate.outputs.subject-paths }}",
      );
    }
    expect(
      attestSteps.find(
        (step: { id?: string }) => step.id === "attest-sbom",
      ).with["sbom-path"],
    ).toBe("${{ steps.generate.outputs.sbom-path }}");
    expect(
      attestSteps.find(
        (step: { id?: string }) => step.id === "attest-candidate-identity",
      ).with,
    ).toMatchObject({
      "predicate-path": "${{ steps.generate.outputs.predicate-path }}",
      "predicate-type":
        "https://github.com/oldwinter/skills-desktop/attestations/unsigned-candidate/v1",
    });
    const finalize = evidenceSteps.find(
      (step: { name?: string }) => step.name === "Seal release evidence",
    );
    expect(finalize.id).toBe("finalize");
    const evidenceUpload = evidenceSteps.find(
      (step: { name?: string }) =>
        step.name === "Exchange digest-addressed evidence",
    );
    expect(evidenceUpload.with.name).toBe(
      "unsigned-evidence-${{ steps.finalize.outputs.evidence-artifact-digest }}",
    );

    const verifyJob = workflow.jobs.verify;
    expect(verifyJob["runs-on"]).toBe("ubuntu-24.04");
    expect(verifyJob.needs).toBe("evidence");
    expect(verifyJob.if).toContain("github.ref == 'refs/heads/main'");
    expect(verifyJob.if).toContain("github.ref_type == 'tag'");
    expect(verifyJob.permissions).toEqual({
      attestations: "read",
      contents: "read",
    });
    const attestationVerificationSteps = verifyJob.steps.filter(
      (step: { run?: string }) => step.run?.includes("gh attestation verify"),
    );
    expect(attestationVerificationSteps).toHaveLength(2);
    for (const step of attestationVerificationSteps) {
      expect(step.run).toContain("--signer-workflow");
      expect(step.run).toContain("--source-digest");
      expect(step.run).toContain("--source-ref");
      expect(step.run).toContain("--deny-self-hosted-runners");
    }
    const verifySource = verifyJob.steps
      .map((step: { run?: string }) => step.run ?? "")
      .join("\n");
    expect(verifySource).toContain("gh attestation verify");
    expect(verifySource).toContain("release-integrity-cli.mjs verify-attestation");
    expect(verifySource).toContain("release-integrity-cli.mjs assemble");
    const verifiedUpload = verifyJob.steps.find(
      (step: { name?: string }) =>
        step.name === "Exchange verified draft payload",
    );
    expect(verifiedUpload.with.name).toBe(
      "verified-draft-${{ steps.assemble.outputs.payload-digest }}",
    );

    const draftJob = workflow.jobs["draft-assembly"];
    expect(draftJob["runs-on"]).toBe("ubuntu-24.04");
    expect(draftJob.needs).toBe("verify");
    expect(draftJob.permissions).toEqual({ contents: "write" });
    expect(draftJob.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(draftJob.if).toContain("github.ref == 'refs/heads/main'");
    expect(draftJob.if).toContain("github.ref_type == 'tag'");
    const draftSource = draftJob.steps
      .map((step: { run?: string }) => step.run ?? "")
      .join("\n");
    expect(draftSource).toContain("gh release create");
    expect(draftSource).toContain("--draft");
    expect(draftSource).toContain("--prerelease");
    expect(draftSource).toContain("--latest=false");
    expect(draftSource).toContain("--notes-file");
    expect(draftSource).not.toMatch(/--notes\s+["']/);
    expect(draftSource).toContain("release-integrity-cli.mjs verify-release");
    expect(draftSource).toContain('--source-ref "${{ github.ref }}"');
    expect(draftSource).not.toMatch(/gh release edit|draft=false|make_latest=true/i);
    const tagDraft = draftJob.steps.find(
      (step: { name?: string }) =>
        step.name === "Create tag-bound unpublished preview draft",
    );
    expect(tagDraft.if).toContain("github.ref_type == 'tag'");
    expect(tagDraft.run).toContain("--verify-tag");
    expect(tagDraft.run).toContain('--target "${{ github.sha }}"');

    const publishJob = workflow.jobs["publish-preview"];
    expect(publishJob["runs-on"]).toBe("ubuntu-24.04");
    expect(publishJob.needs).toEqual([
      "verify",
      "draft-assembly",
      "quality-gates",
      "packaged-ui-qa",
    ]);
    expect(publishJob.permissions).toEqual({ contents: "write" });
    const publishCondition = publishJob.if.replace(/\s+/g, " ").trim();
    expect(publishCondition).toContain(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.publish_preview == true",
    );
    expect(publishCondition).toContain(
      "github.event_name == 'push' && github.ref_type == 'tag'",
    );
    const publishSource = publishJob.steps
      .map((step: { run?: string }) => step.run ?? "")
      .join("\n");
    expect(publishSource).toContain("release-integrity-cli.mjs verify-release");
    expect(publishSource).toContain("gh release edit");
    expect(publishSource).toContain("--draft=false");
    expect(publishSource).toContain("--prerelease");
    expect(publishSource).toContain("--latest=false");
    expect(publishSource).toContain(
      "release-integrity-cli.mjs verify-preview-release",
    );
    expect(publishSource).toContain('--source-ref "${{ github.ref }}"');
    const publishStepNames = publishJob.steps.map(
      (step: { name?: string }) => step.name,
    );
    expect(
      publishStepNames.indexOf("Verify staged GitHub draft assets"),
    ).toBeLessThan(
      publishStepNames.indexOf("Publish staged preview without changing assets"),
    );
    expect(publishSource).not.toMatch(
      /\bnpm\s+(ci|exec|run)\b|electron-forge|xvfb|candidate:build/i,
    );

    for (const job of Object.values(workflow.jobs).filter(
      (candidate: { steps?: unknown }) => candidate.steps !== undefined,
    ) as Array<{
      steps: Array<{
        uses?: string;
        with?: Record<string, unknown>;
      }>;
    }>) {
      for (const step of job.steps) {
        if (step.uses !== undefined) {
          expect(step.uses).toMatch(pinnedAction);
        }
      }
      const checkoutStep = job.steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(checkoutStep?.with?.["persist-credentials"]).toBe(false);
    }
    for (const job of [evidenceJob, verifyJob, draftJob, publishJob]) {
      const setupNode = job.steps.find((step: { uses?: string }) =>
        step.uses?.startsWith("actions/setup-node@"),
      );
      expect(setupNode?.with?.["node-version"]).toBe(24);
    }
    const laterJobSource = [evidenceJob, verifyJob, draftJob, publishJob]
      .flatMap((job) => job.steps)
      .map((step: { run?: string }) => step.run ?? "")
      .join("\n");
    expect(laterJobSource).not.toMatch(
      /\bnpm\s+(ci|exec|run)\b|electron-forge|xvfb|candidate:build/i,
    );
    expect(source).not.toContain("secrets.");
    expect(source).not.toMatch(/runs-on:\s*\[[^\n]*self-hosted/i);
    expect(source).not.toMatch(
      /environment:\s*(release-signing|production-release)/,
    );
    expect(source).not.toMatch(
      /\b(CSC_LINK|APPLE_API_KEY|WIN_CSC_LINK|MACOS_CERTIFICATE|WINDOWS_CERTIFICATE)\b/,
    );
  });

  it("exposes the full Verify and packaged UI QA gates to tag publication", async () => {
    const [verifySource, packagedQaSource] = await Promise.all([
      readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8"),
      readFile(
        new URL("../.github/workflows/packaged-ui-qa.yml", import.meta.url),
        "utf8",
      ),
    ]);
    const verifyWorkflow = parse(verifySource);
    const packagedQaWorkflow = parse(packagedQaSource);

    expect(verifyWorkflow.on.workflow_call).toBeNull();
    expect(packagedQaWorkflow.on.workflow_call).toBeNull();
    expect(packagedQaWorkflow.jobs["packaged-ui-qa"].if).toContain(
      "github.event_name == 'workflow_call'",
    );
    expect(packagedQaWorkflow.jobs["packaged-ui-qa"].if).toContain(
      "github.ref_type == 'tag'",
    );
  });

  it("keeps signing, stable publication, and package publishers unavailable", async () => {
    const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
    const allWorkflowSources = await Promise.all(
      (await readdir(workflowDirectory)).map((fileName) =>
        readFile(new URL(fileName, workflowDirectory), "utf8"),
      ),
    );
    const rootPackage = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const forbidden = [
      /\belectron-forge\s+publish\b/i,
      /\bnpm\s+publish\b/i,
      /softprops\/action-gh-release/i,
      /\bgh\s+release\s+upload\b/i,
      /\b(stable-feed|production-release|release-signing)\b/i,
    ];
    for (const candidate of [
      ...allWorkflowSources,
      ...Object.values(rootPackage.scripts),
    ]) {
      expect(forbidden.some((pattern) => pattern.test(String(candidate)))).toBe(
        false,
      );
    }
  });
});
