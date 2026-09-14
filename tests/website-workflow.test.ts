import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const pinnedAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/;

interface Step {
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

describe("website workflow contract", () => {
  it("builds the landing page on every change and publishes only from main", async () => {
    const source = await readFile(
      new URL("../.github/workflows/website.yml", import.meta.url),
      "utf8",
    );
    const workflow = parse(source);

    expect(workflow.name).toBe("Website");
    expect(Object.keys(workflow.on).sort()).toEqual([
      "pull_request",
      "push",
      "workflow_dispatch",
    ]);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.push.paths).toContain("apps/website/**");
    expect(workflow.on.pull_request.paths).toEqual(workflow.on.push.paths);
    expect(workflow.permissions).toEqual({ contents: "read" });

    const build = workflow.jobs.build;
    expect(build["runs-on"]).toBe("ubuntu-24.04");
    const buildSteps = build.steps as Step[];
    for (const step of buildSteps) {
      if (step.uses !== undefined) expect(step.uses).toMatch(pinnedAction);
    }
    const buildCommand = buildSteps.find((step) => step.run?.includes("npm run build"))?.run;
    expect(buildCommand).toContain('WEBSITE_BASE_PATH="/${GITHUB_REPOSITORY#*/}/"');
    expect(buildCommand).toContain("--workspace @skills-desktop/website");
    expect(
      buildSteps.find((step) => step.uses?.startsWith("actions/upload-pages-artifact@"))?.with,
    ).toEqual({ path: "apps/website/dist" });

    const deploy = workflow.jobs.deploy;
    expect(deploy.if).toBe("github.event_name != 'pull_request'");
    expect(deploy.needs).toBe("build");
    expect(deploy.permissions).toEqual({ pages: "write", "id-token": "write" });
    expect(deploy.environment.name).toBe("github-pages");
    for (const step of deploy.steps as Step[]) {
      expect(step.uses).toMatch(pinnedAction);
    }
  });
});
