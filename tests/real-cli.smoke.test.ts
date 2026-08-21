import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSpawnProcessRunner,
  createLocalSkillsProcess,
} from "../apps/desktop/src/main/adapters/local-skills-process.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("pinned real Skills CLI smoke", () => {
  it("observes an isolated empty project and global inventory through the production Adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-desktop-real-cli-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const skillsProcess = createLocalSkillsProcess({
      clock: () => new Date("2026-08-21T10:00:00.000Z"),
      environment: {
        HOME: root,
        NPM_CONFIG_CACHE: join(root, "npm-cache"),
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: root,
      },
      platform: process.platform,
      runner: createSpawnProcessRunner({ platform: process.platform }),
      workspace,
    });

    const result = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        cliVersion: "1.5.23",
        entries: [],
        observedAt: "2026-08-21T10:00:00.000Z",
        schemaVersion: 1,
      },
    });
  });

  it("installs the exact reviewed commit archive through the production Adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-desktop-pinned-cli-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await mkdir(join(root, ".codex"));
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "isolated-pinned-source-smoke", private: true }),
      "utf8",
    );
    const skillsProcess = createLocalSkillsProcess({
      binding: {
        generation: 1,
        harness: "Codex",
        targetId: "00000000-0000-4000-8000-000000000001",
      },
      clock: () => new Date("2026-08-22T06:00:00.000Z"),
      environment: {
        HOME: root,
        NPM_CONFIG_CACHE: join(root, "npm-cache"),
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: root,
      },
      platform: process.platform,
      runner: createSpawnProcessRunner({ platform: process.platform }),
      workspace,
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("initial Inventory failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: {
        names: ["find-skills"],
        scope: "project",
        source: {
          revision: "435076e78988e1e6ec40d00b0b1d76bdbbc5419a",
          source: "vercel-labs/skills",
          sourceType: "github",
        },
        type: "add",
      },
      inventory: observed.value,
      inventoryId: "isolated-inventory",
    });
    if (!prepared.ok) throw new Error("pinned preparation failed");

    const outcome = await skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.value.digest,
        preparedMutationId: prepared.value.id,
      },
      signal: new AbortController().signal,
    });

    expect(prepared.value.commandPlan.preview).toContain(
      "https://github.com/vercel-labs/skills/archive/435076e78988e1e6ec40d00b0b1d76bdbbc5419a.tar.gz",
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        effects: { status: "content-unverified" },
        inventory: {
          entries: expect.arrayContaining([
            expect.objectContaining({
              declaredSource: { source: null, sourceType: null },
              name: "find-skills",
              scope: "project",
            }),
          ]),
        },
        process: { disposition: "completed", termination: "known" },
      },
    });
    await expect(
      access(join(workspace, ".agents", "skills", "find-skills", "SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(access(join(root, ".agents"))).rejects.toThrow();
  });
});
