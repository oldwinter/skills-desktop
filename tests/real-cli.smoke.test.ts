import { mkdtemp, rm } from "node:fs/promises";
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
    const { mkdir } = await import("node:fs/promises");
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
});
