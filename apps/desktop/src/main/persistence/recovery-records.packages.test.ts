import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createNodeSkillpackCodec } from "../application/imported-packages.js";
import { serializeSkillpack } from "@skills-desktop/skills-runtime";

import type { ImportedPackageRecord } from "./imported-package-records.js";
import {
  createJsonRecoveryRecords,
  createMemoryRecoveryRecords,
} from "./recovery-records.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "skills-desktop-packages-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

function recordFor(): ImportedPackageRecord {
  const serialized = serializeSkillpack(
    {
      compatibility: { dialectId: "skills-1.5.23", harnessIds: ["codex"] },
      description: "Team review recipe.",
      id: "team.review",
      release: 2,
      skills: ["find-skills"],
      source: { owner: "vercel-labs", repository: "skills", type: "github" },
      title: "Team review",
    },
    createNodeSkillpackCodec(),
  );
  if (!serialized.ok) throw new Error(serialized.error.message);
  return {
    conflicts: [
      {
        documentDigest: `sha256:${"b".repeat(64)}`,
        recordedAt: "2026-08-22T06:00:00.000Z",
        release: 2,
      },
    ],
    delta: {
      fromRelease: 1,
      kind: "upgrade",
      recordedAt: "2026-08-22T06:00:00.000Z",
      toRelease: 2,
    },
    document: serialized.value.document,
    importedAt: "2026-08-22T06:00:00.000Z",
  };
}

describe("RecoveryRecords Package store v1 contract (ADR 0017)", () => {
  it("restores only strict package records in memory", async () => {
    const record = recordFor();
    const records = createMemoryRecoveryRecords();
    expect(await (await records.restore()).importedPackages).toEqual([]);
    expect(
      await records.commit({ packages: [record], type: "packages.replace" }),
    ).toEqual({ ok: true, value: undefined });
    expect((await records.restore()).importedPackages).toEqual([record]);

    expect(
      await records.commit({
        packages: [
          { ...record, installed: true } as unknown as ImportedPackageRecord,
        ],
        type: "packages.replace",
      }),
    ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
    expect(
      await records.commit({
        packages: [record, record],
        type: "packages.replace",
      }),
    ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
  });

  it("keeps packages in an isolated versioned JSON document replaced atomically", async () => {
    const record = recordFor();
    const directory = await temporaryDirectory();
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "package-write",
    });
    expect(
      await records.commit({ packages: [record], type: "packages.replace" }),
    ).toEqual({ ok: true, value: undefined });

    const persisted = await readFile(
      join(directory, "imported-packages.json"),
      "utf8",
    );
    expect(JSON.parse(persisted)).toEqual({
      kind: "imported-packages",
      packages: [record],
      schemaVersion: 1,
    });
    expect(persisted).not.toMatch(/inventory|installed|argv|guard|receipt/i);

    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "package-restart",
      }).restore(),
    ).resolves.toMatchObject({ failures: [], importedPackages: [record] });
  });

  it("quarantines a corrupt store and refuses a newer schema without overwriting it", async () => {
    const record = recordFor();
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "imported-packages.json"), "not json");
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "package-corrupt",
    });
    await expect(records.restore()).resolves.toMatchObject({
      failures: [{ code: "corrupt_store", store: "importedPackages" }],
      importedPackages: [],
    });
    await expect(
      readFile(
        join(directory, "imported-packages.quarantine-package-corrupt.json"),
        "utf8",
      ),
    ).resolves.toBe("not json");
    await expect(
      records.commit({ packages: [record], type: "packages.replace" }),
    ).resolves.toEqual({ ok: true, value: undefined });

    const newer = await temporaryDirectory();
    const newerDocument = JSON.stringify({
      kind: "imported-packages",
      packages: [],
      schemaVersion: 2,
    });
    await writeFile(join(newer, "imported-packages.json"), newerDocument);
    const newerRecords = createJsonRecoveryRecords({
      directory: newer,
      id: () => "package-newer",
    });
    await expect(newerRecords.restore()).resolves.toMatchObject({
      failures: [{ code: "unsupported_schema", store: "importedPackages" }],
      importedPackages: [],
    });
    await expect(
      newerRecords.commit({ packages: [record], type: "packages.replace" }),
    ).resolves.toMatchObject({
      error: { code: "unsupported_schema" },
      ok: false,
    });
    await expect(
      readFile(join(newer, "imported-packages.json"), "utf8"),
    ).resolves.toBe(newerDocument);
  });
});
