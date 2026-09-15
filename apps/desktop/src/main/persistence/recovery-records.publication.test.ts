import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sealPublicationPlan } from "@skills-desktop/skills-runtime";

import type { PublicationGuardRecord } from "./publication-guard-records.js";
import {
  createJsonRecoveryRecords,
  createMemoryRecoveryRecords,
} from "./recovery-records.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(
    join(tmpdir(), "skills-desktop-publication-guard-"),
  );
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

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function guardFor(): PublicationGuardRecord {
  return {
    committedAt: "2026-09-15T10:00:00.000Z",
    lastReadback: null,
    lastReadbackAt: null,
    phase: "pushing",
    plan: sealPublicationPlan(
      {
        base: { commit: "a".repeat(40), kind: "commit" },
        branch: "main",
        candidateCommit: "b".repeat(40),
        createdAt: "2026-09-15T10:00:00.000Z",
        expiresAt: "2026-09-15T10:10:00.000Z",
        exporterVersion: 1,
        files: [
          {
            digest: `sha256:${"c".repeat(64)}`,
            path: ".well-known/agent-skills/index.json",
          },
        ],
        id: "publication-1",
        ref: "refs/heads/main",
        remote: {
          host: "github.com",
          kind: "https",
          url: "https://github.com/acme/skills.git",
        },
        schemaVersion: 1,
        skills: ["hello"],
        treeDigest: `sha256:${"d".repeat(64)}`,
      },
      sha256Hex,
    ),
  };
}

describe("RecoveryRecords Publication Guard store v1 contract (ADR 0020)", () => {
  it("holds at most one strict Guard in memory and clears it explicitly", async () => {
    const guard = guardFor();
    const records = createMemoryRecoveryRecords();
    expect((await records.restore()).publicationGuard).toBeNull();
    expect(
      await records.commit({ guard, type: "publication.guard.replace" }),
    ).toEqual({ ok: true, value: undefined });
    expect((await records.restore()).publicationGuard).toEqual(guard);
    expect(
      await records.commit({
        guard: { ...guard, phase: "uncertain", lastReadback: "uncertain" },
        type: "publication.guard.replace",
      }),
    ).toEqual({ ok: true, value: undefined });
    expect((await records.restore()).publicationGuard).toMatchObject({
      phase: "uncertain",
    });
    expect(
      await records.commit({
        guard: { ...guard, force: true } as unknown as PublicationGuardRecord,
        type: "publication.guard.replace",
      }),
    ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
    expect(
      await records.commit({
        guard: {
          ...guard,
          plan: { ...guard.plan, ref: "refs/tags/v1" },
        } as unknown as PublicationGuardRecord,
        type: "publication.guard.replace",
      }),
    ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
    expect(
      await records.commit({ guard: null, type: "publication.guard.replace" }),
    ).toEqual({ ok: true, value: undefined });
    expect((await records.restore()).publicationGuard).toBeNull();
  });

  it("keeps the Guard in an isolated versioned JSON document that survives restart", async () => {
    const guard = guardFor();
    const directory = await temporaryDirectory();
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "publication-write",
    });
    expect(
      await records.commit({ guard, type: "publication.guard.replace" }),
    ).toEqual({ ok: true, value: undefined });

    const persisted = await readFile(
      join(directory, "publication-guard.json"),
      "utf8",
    );
    expect(JSON.parse(persisted)).toEqual({
      guard,
      kind: "publication-guard",
      schemaVersion: 1,
    });
    // No credentials, argv, worktree, or inventory ever reach the Guard.
    expect(persisted).not.toMatch(/token|password|argv|worktree|inventory/i);

    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "publication-restart",
      }).restore(),
    ).resolves.toMatchObject({ failures: [], publicationGuard: guard });
  });

  it("quarantines a corrupt store and refuses a newer schema without overwriting it", async () => {
    const guard = guardFor();
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "publication-guard.json"), "not json");
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "publication-corrupt",
    });
    await expect(records.restore()).resolves.toMatchObject({
      failures: [{ code: "corrupt_store", store: "publicationGuard" }],
      publicationGuard: null,
    });
    await expect(
      readFile(
        join(
          directory,
          "publication-guard.quarantine-publication-corrupt.json",
        ),
        "utf8",
      ),
    ).resolves.toBe("not json");
    await expect(
      records.commit({ guard, type: "publication.guard.replace" }),
    ).resolves.toEqual({ ok: true, value: undefined });

    const newer = await temporaryDirectory();
    const newerDocument = JSON.stringify({
      guard: null,
      kind: "publication-guard",
      schemaVersion: 2,
    });
    await writeFile(join(newer, "publication-guard.json"), newerDocument);
    const newerRecords = createJsonRecoveryRecords({
      directory: newer,
      id: () => "publication-newer",
    });
    await expect(newerRecords.restore()).resolves.toMatchObject({
      failures: [{ code: "unsupported_schema", store: "publicationGuard" }],
      publicationGuard: null,
    });
    await expect(
      newerRecords.commit({ guard, type: "publication.guard.replace" }),
    ).resolves.toMatchObject({
      error: { code: "unsupported_schema" },
      ok: false,
    });
    await expect(
      readFile(join(newer, "publication-guard.json"), "utf8"),
    ).resolves.toBe(newerDocument);
  });
});
