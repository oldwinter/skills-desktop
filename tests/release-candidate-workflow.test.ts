import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("unsigned candidate workflow contract", () => {
  it("uses credential-free native jobs and retains manifests but not unsigned bytes", async () => {
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
    expect(workflow.jobs.candidate.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.candidate.strategy.matrix.include).toEqual([
      { architecture: "arm64", platform: "darwin", runner: "macos-15" },
      { architecture: "x64", platform: "darwin", runner: "macos-15" },
      { architecture: "x64", platform: "win32", runner: "windows-2025" },
      { architecture: "x64", platform: "linux", runner: "ubuntu-24.04" },
    ]);

    const steps = workflow.jobs.candidate.steps;
    const checkout = steps.find((step: { name?: string }) =>
      step.name?.startsWith("Check out"),
    );
    expect(checkout.uses).toMatch(/^actions\/checkout@[a-f0-9]{40}$/);
    expect(checkout.with["persist-credentials"]).toBe(false);
    const setupNode = steps.find(
      (step: { name?: string }) => step.name === "Set up Node.js",
    );
    expect(setupNode.uses).toMatch(/^actions\/setup-node@[a-f0-9]{40}$/);
    expect(setupNode.with["node-version"]).toBe(24);

    const generate = steps.find(
      (step: { name?: string }) => step.name === "Generate unsigned candidate",
    );
    expect(generate.run).toContain("npm run candidate:build --");
    expect(generate.run).not.toMatch(/publish|release create|release upload/i);
    const evidence = steps.find(
      (step: { name?: string }) => step.name === "Retain manifest evidence",
    );
    expect(evidence.uses).toMatch(
      /^actions\/upload-artifact@[a-f0-9]{40}$/,
    );
    expect(evidence.with.path).toBe(
      "release-candidates/**/candidate-manifest-v1.*",
    );
    expect(evidence.with.path).not.toMatch(/\.(dmg|zip|exe|nupkg|deb|rpm)$/i);

    expect(source).not.toContain("secrets.");
    expect(source).not.toMatch(/id-token:\s*write/);
    expect(source).not.toMatch(/environment:\s*(release-signing|production-release)/);
    expect(source).not.toMatch(/\b(CSC_LINK|APPLE_API_KEY|WIN_CSC_LINK|GH_TOKEN)\b/);
  });
});
