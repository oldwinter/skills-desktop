import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const pinnedAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/;

describe("packaged UI QA workflow contract", () => {
  it("runs the isolated Local-only harness on every V1 desktop platform", async () => {
    const source = await readFile(
      new URL("../.github/workflows/packaged-ui-qa.yml", import.meta.url),
      "utf8",
    );
    const workflow = parse(source);

    expect(workflow.name).toBe("Packaged UI QA");
    expect(Object.keys(workflow.on).sort()).toEqual([
      "push",
      "workflow_dispatch",
    ]);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(source).not.toContain("sshd");
    expect(source).not.toContain("smoke:ssh");
    expect(source).not.toContain("--no-sandbox");
    expect(source).not.toContain(
      "SKILLS_DESKTOP_QA_DISABLE_CHROMIUM_SANDBOX",
    );

    const job = workflow.jobs["packaged-ui-qa"];
    expect(job.if).toBe(
      "github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'",
    );
    expect(
      job.strategy.matrix.include.map(
        (entry: { architecture: string; platform: string }) =>
          `${entry.platform}-${entry.architecture}`,
      ),
    ).toEqual(["linux-x64", "darwin-arm64", "darwin-x64", "win32-x64"]);
    expect(
      job.strategy.matrix.include.find(
        (entry: { architecture: string; platform: string }) =>
          entry.platform === "linux" && entry.architecture === "x64",
      ).runner,
    ).toBe('"ubuntu-24.04"');
    expect(
      job.strategy.matrix.include.find(
        (entry: { architecture: string; platform: string }) =>
          entry.platform === "darwin" && entry.architecture === "x64",
      ).runner,
    ).toBe('"macos-15-intel"');

    const uses = job.steps
      .map((step: { uses?: string }) => step.uses)
      .filter(
        (value: string | undefined): value is string => value !== undefined,
      );
    expect(uses.every((value: string) => pinnedAction.test(value))).toBe(true);
    const uploadSteps = job.steps.filter(
      (step: { uses?: string }) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/upload-artifact@"),
    );
    expect(uploadSteps).toHaveLength(1);
    expect(uploadSteps[0]).toMatchObject({
      if: "failure()",
      with: {
        "if-no-files-found": "ignore",
        path: "${{ runner.temp }}/packaged-ui-qa/failure.json",
      },
    });
    const packageStep = job.steps.find(
      (step: { name?: string }) => step.name?.startsWith("Package unsigned"),
    );
    expect(packageStep?.run).toContain("--platform=${{ matrix.platform }}");
    expect(packageStep?.run).toContain("--arch=${{ matrix.architecture }}");
    expect(source).toContain("tests/packaged-ui-qa/run.mjs");
    expect(source).toContain("SKILLS_DESKTOP_PACKAGED_EXECUTABLE");
    expect(source).toContain("SKILLS_DESKTOP_QA_ARTIFACTS");
    expect(source).toContain("SKILLS_DESKTOP_QA_ARCH");
    expect(source).toContain("sudo apparmor_parser --skip-cache --replace");
    expect(source).toContain("sudo apparmor_parser --skip-cache --remove");
    expect(source).toContain("trap 'cleanup \"$?\"' EXIT");
    expect(source).toContain("userns,");
    expect(source).toContain(
      "${{ runner.temp }}/packaged-ui-qa/failure.json",
    );
    expect(source).toContain("Contents/MacOS/skills-desktop");
    const qaStep = job.steps.find(
      (step: { env?: Record<string, string>; run?: string }) =>
        typeof step.run === "string" &&
        step.run.includes("tests/packaged-ui-qa/run.mjs"),
    );
    expect(qaStep?.env).toMatchObject({
      SKILLS_DESKTOP_QA_ARCH: "${{ matrix.architecture }}",
      SKILLS_DESKTOP_QA_ARTIFACTS: "${{ runner.temp }}/packaged-ui-qa",
    });
  });
});
