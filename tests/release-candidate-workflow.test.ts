import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const pinnedAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/;

describe("unsigned candidate workflow contract", () => {
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

  it("keeps package, evidence, verification, and private draft authority distinct", async () => {
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
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs)).toEqual([
      "package",
      "evidence",
      "verify",
      "draft-assembly",
    ]);

    const packageJob = workflow.jobs.package;
    expect(packageJob.if).toContain("github.ref == 'refs/heads/main'");
    expect(packageJob.permissions).toEqual({ contents: "read" });
    expect(packageJob.strategy.matrix.include).toEqual([
      { architecture: "arm64", platform: "darwin", runner: "macos-15" },
      { architecture: "x64", platform: "darwin", runner: "macos-15" },
      { architecture: "x64", platform: "win32", runner: "windows-2025" },
      { architecture: "x64", platform: "linux", runner: "ubuntu-24.04" },
    ]);
    const packageSteps = packageJob.steps;
    const checkout = packageSteps.find((step: { name?: string }) =>
      step.name?.startsWith("Check out"),
    );
    expect(checkout.with["persist-credentials"]).toBe(false);
    const generate = packageSteps.find(
      (step: { name?: string }) => step.name === "Generate unsigned candidate",
    );
    expect(generate.run).toContain("npm run candidate:build --");
    expect(generate.run).not.toMatch(/publish|release create|release upload/i);
    const identify = packageSteps.find(
      (step: { name?: string }) => step.name === "Identify candidate package",
    );
    expect(identify.id).toBe("identity");
    expect(identify.run).toContain("release-integrity-cli.mjs identify");

    const manifestUpload = packageSteps.find(
      (step: { name?: string }) => step.name === "Retain manifest evidence",
    );
    expect(manifestUpload.if).toContain("github.event_name != 'workflow_dispatch'");
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
    expect(packageUpload.with.name).toBe(
      "unsigned-package-${{ steps.identity.outputs.manifest-digest }}",
    );
    expect(packageUpload.with.path).toBe(
      "${{ steps.identity.outputs.candidate-directory }}/**",
    );
    expect(packageUpload.with["retention-days"]).toBe(1);

    const evidenceJob = workflow.jobs.evidence;
    expect(evidenceJob.needs).toBe("package");
    expect(evidenceJob.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(evidenceJob.if).toContain("github.ref == 'refs/heads/main'");
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
    expect(verifyJob.needs).toBe("evidence");
    expect(verifyJob.if).toContain("github.ref == 'refs/heads/main'");
    expect(verifyJob.permissions).toEqual({
      attestations: "read",
      contents: "read",
    });
    const verifySource = verifyJob.steps
      .map((step: { run?: string }) => step.run ?? "")
      .join("\n");
    expect(verifySource).toContain("gh attestation verify");
    expect(verifySource).toContain("--signer-workflow");
    expect(verifySource).toContain("--source-digest");
    expect(verifySource).toContain("--source-ref");
    expect(verifySource).toContain("--deny-self-hosted-runners");
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
    expect(draftJob.needs).toBe("verify");
    expect(draftJob.permissions).toEqual({ contents: "write" });
    expect(draftJob.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(draftJob.if).toContain("github.ref == 'refs/heads/main'");
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
    expect(draftSource).not.toMatch(/gh release edit|draft=false|make_latest=true/i);

    for (const job of Object.values(workflow.jobs) as Array<{
      steps: Array<{ uses?: string }>;
    }>) {
      for (const step of job.steps) {
        if (step.uses !== undefined) {
          expect(step.uses).toMatch(pinnedAction);
        }
      }
    }
    const laterJobSource = [evidenceJob, verifyJob, draftJob]
      .flatMap((job) => job.steps)
      .map((step: { run?: string }) => step.run ?? "")
      .join("\n");
    expect(laterJobSource).not.toMatch(
      /\bnpm\s+(ci|exec|run)\b|electron-forge|xvfb|candidate:build/i,
    );
    expect(source).not.toContain("secrets.");
    expect(source).not.toMatch(
      /environment:\s*(release-signing|production-release)/,
    );
    expect(source).not.toMatch(
      /\b(CSC_LINK|APPLE_API_KEY|WIN_CSC_LINK|MACOS_CERTIFICATE|WINDOWS_CERTIFICATE)\b/,
    );
  });

  it("has no public, stable, signing, or package-publisher surface", async () => {
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
      /\bgh\s+release\s+(edit|upload)\b/i,
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
