import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const pinnedAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/;

describe("verify workflow contract", () => {
  it("runs privileged Linux verification on fixed hosted Ubuntu", async () => {
    const source = await readFile(
      new URL("../.github/workflows/verify.yml", import.meta.url),
      "utf8",
    );
    const workflow = parse(source);
    const packagedSmokeSource = await readFile(
      new URL("./packaged-electron.smoke.mjs", import.meta.url),
      "utf8",
    );

    expect(workflow.name).toBe("Verify");
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push"]);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.permissions).toEqual({ contents: "read" });

    const linuxJob = workflow.jobs["linux-contracts-and-package"];
    expect(linuxJob["runs-on"]).toBe("ubuntu-24.04");
    expect(linuxJob.steps.map((step: { run?: string }) => step.run)).toContain(
      "npm run verify",
    );
    const packagedSmoke = linuxJob.steps.find(
      (step: { name?: string }) => step.name === "Run packaged Electron smoke",
    );
    expect(packagedSmoke.run).toContain("npm run package:linux");
    expect(packagedSmoke.run).toContain(
      "sudo apparmor_parser --skip-cache --replace",
    );
    expect(packagedSmoke.run).toContain(
      "sudo apparmor_parser --skip-cache --remove",
    );
    expect(packagedSmoke.run).toContain("trap 'cleanup \"$?\"' EXIT");
    expect(packagedSmoke.run).toContain("userns,");
    expect(packagedSmoke.run).not.toContain("--no-sandbox");
    expect(source).not.toContain("openssh-server");
    expect(source).not.toContain("/run/sshd");
    expect(source).not.toContain("self-hosted");
    expect(packagedSmokeSource).not.toContain("startDisposableSshd");
    expect(packagedSmokeSource).not.toContain("/usr/sbin/sshd");

    const platformJob = workflow.jobs["platform-contracts"];
    expect(platformJob.strategy.matrix.os).toEqual([
      "macos-15",
      "windows-2025",
    ]);

    for (const job of Object.values(workflow.jobs) as Array<{
      steps: Array<{ uses?: string; with?: Record<string, unknown> }>;
    }>) {
      const uses = job.steps
        .map((step) => step.uses)
        .filter((value): value is string => value !== undefined);
      expect(uses.every((value) => pinnedAction.test(value))).toBe(true);
      const checkout = job.steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(checkout?.with?.["persist-credentials"]).toBe(false);
    }
  });
});
