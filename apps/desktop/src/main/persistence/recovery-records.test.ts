import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Inventory } from "@skills-desktop/skills-runtime";

import {
  createJsonRecoveryRecords,
  createMemoryRecoveryRecords,
  createNodeRecoveryFileSystem,
  type RecoveryFileSystem,
  type RecoveryRecords,
} from "./recovery-records.js";

const temporaryDirectories: string[] = [];
const targetV4Binding = {
  dialectId: "skills-1.5.23" as const,
  executionBindingDigest: null,
  harnessIds: ["codex"],
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de" as const,
  registryVersion: 1 as const,
};
const guardV3Binding = {
  bindingDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
  dialectId: "skills-1.5.23" as const,
  harnessSetDigest:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de" as const,
};

const inventory: Inventory = {
  cliVersion: "1.5.23",
  entries: [
    {
      agents: ["Codex"],
      contentFingerprint: { status: "unknown" },
      declaredSource: { source: "example/skills", sourceType: "github" },
      extensions: { privateUpstreamField: "must-not-persist" },
      name: "tdd",
      path: "/secret/workspace/.agents/skills/tdd",
      revision: { status: "unknown" },
      scope: "project",
      sourceUrl: "https://token@example.test/private.git",
    },
  ],
  observedAt: "2026-08-21T10:00:00.000Z",
  schemaVersion: 1,
};

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "skills-desktop-recovery-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function recoveryContract(
  create: () => Promise<RecoveryRecords> | RecoveryRecords,
) {
  const records = await create();
  const committed = await records.commit({
    generation: 3,
    inventory,
    targetId: "00000000-0000-4000-8000-000000000001",
    type: "inventory.replace",
  });

  expect(committed).toEqual({ ok: true, value: undefined });
  const restored = await records.restore();
  expect(restored.inventorySnapshots).toEqual([
    {
      cliVersion: "1.5.23",
      entries: [
        {
          agents: ["Codex"],
          contentFingerprint: { status: "unknown" },
          declaredSource: { source: "example/skills", sourceType: "github" },
          name: "tdd",
          revision: { status: "unknown" },
          scope: "project",
        },
      ],
      generation: 3,
      observedAt: "2026-08-21T10:00:00.000Z",
      targetId: "00000000-0000-4000-8000-000000000001",
    },
  ]);
  expect(restored.failures).toEqual([]);
}

function faultingFileSystem(
  fault: "directory-sync" | "replace" | "temporary-sync",
): RecoveryFileSystem {
  const delegate = createNodeRecoveryFileSystem();
  return {
    ...delegate,
    async open(path, flags, mode) {
      const handle = await delegate.open(path, flags, mode);
      return {
        close: () => handle.close(),
        sync() {
          if (fault === "temporary-sync" && flags === "wx") {
            return Promise.reject(new Error("temporary sync fault"));
          }
          if (fault === "directory-sync" && flags === "r") {
            return Promise.reject(new Error("directory sync fault"));
          }
          return handle.sync();
        },
        writeFile: (data, options) => handle.writeFile(data, options),
      };
    },
    rename(source, destination) {
      if (fault === "replace" && destination.endsWith(".json")) {
        return Promise.reject(new Error("replacement fault"));
      }
      return delegate.rename(source, destination);
    },
  };
}

function migrationFaultingFileSystem(
  fault: "backup" | "write",
): RecoveryFileSystem {
  const delegate = createNodeRecoveryFileSystem();
  return {
    ...delegate,
    copyFile(source, destination, mode) {
      if (fault === "backup" && destination.endsWith(".v1.backup")) {
        return Promise.reject(new Error("migration backup fault"));
      }
      return delegate.copyFile(source, destination, mode);
    },
    rename(source, destination) {
      if (fault === "write" && destination.endsWith("inventory-snapshots.json")) {
        return Promise.reject(new Error("migration write fault"));
      }
      return delegate.rename(source, destination);
    },
  };
}

function backupSyncFaultingFileSystem(
  directory: string,
  fault: "backup" | "directory",
): RecoveryFileSystem {
  const delegate = createNodeRecoveryFileSystem();
  return {
    ...delegate,
    async open(path, flags, mode) {
      const handle = await delegate.open(path, flags, mode);
      return {
        close: () => handle.close(),
        sync() {
          if (
            flags === "r" &&
            ((fault === "backup" && path.endsWith(".backup")) ||
              (fault === "directory" && path === directory))
          ) {
            return Promise.reject(new Error("backup sync fault"));
          }
          return handle.sync();
        },
        writeFile: (data, options) => handle.writeFile(data, options),
      };
    },
  };
}

function recordingOpenFileSystem() {
  const delegate = createNodeRecoveryFileSystem();
  const opens: Array<{ readonly flags: "r" | "r+" | "wx"; readonly path: string }> = [];
  const fileSystem: RecoveryFileSystem = {
    ...delegate,
    async open(path, flags, mode) {
      opens.push({ flags, path });
      return delegate.open(path, flags, mode);
    },
  };
  return { fileSystem, opens };
}

describe("RecoveryRecords Inventory Snapshot contract", () => {
  it("allowlists evidence in memory", async () => {
    await recoveryContract(() => createMemoryRecoveryRecords());
  });

  it("atomically restores only allowlisted evidence from JSON", async () => {
    const directory = await temporaryDirectory();
    await recoveryContract(() =>
      createJsonRecoveryRecords({
        directory,
        id: () => "write-1",
      }),
    );

    const persisted = await readFile(
      join(directory, "inventory-snapshots.json"),
      "utf8",
    );
    expect(persisted).not.toContain("secret/workspace");
    expect(persisted).not.toContain("token@example");
    expect(persisted).not.toContain("privateUpstreamField");
  });

  it("uses the atomic replacement contract on Windows without POSIX directory sync", async () => {
    const directory = await temporaryDirectory();
    await recoveryContract(() =>
      createJsonRecoveryRecords({
        directory,
        id: () => "windows-write",
        platform: "win32",
      }),
    );
  });

  it("migrates a v1 Snapshot document deterministically", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, "inventory-snapshots.json"),
      JSON.stringify({
        kind: "inventory-snapshots",
        schemaVersion: 1,
        records: [
          {
            capturedAt: "2026-08-20T08:00:00.000Z",
            cliVersion: "1.5.23",
            generation: 2,
            skills: [
              {
                agents: ["Codex"],
                name: "legacy",
                scope: "global",
                source: null,
                sourceType: null,
              },
            ],
            target: "00000000-0000-4000-8000-000000000001",
          },
        ],
      }),
    );
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "migration",
    });

    const restored = await records.restore();

    expect(restored.inventorySnapshots[0]).toMatchObject({
      observedAt: "2026-08-20T08:00:00.000Z",
      targetId: "00000000-0000-4000-8000-000000000001",
    });
    expect(
      JSON.parse(
        await readFile(join(directory, "inventory-snapshots.json"), "utf8"),
      ),
    ).toMatchObject({
      kind: "inventory-snapshots",
      schemaVersion: 3,
    });
    expect(
      await readFile(
        join(directory, "inventory-snapshots.json.v1.backup"),
        "utf8",
      ),
    ).toContain('"schemaVersion":1');
  });

  it("uses a writable non-truncating backup handle on Windows migration", async () => {
    const directory = await temporaryDirectory();
    const snapshotPath = join(directory, "inventory-snapshots.json");
    const backupPath = `${snapshotPath}.v1.backup`;
    await writeFile(
      snapshotPath,
      JSON.stringify({
        kind: "inventory-snapshots",
        schemaVersion: 1,
        records: [
          {
            capturedAt: "2026-08-20T08:00:00.000Z",
            cliVersion: "1.5.23",
            generation: 2,
            skills: [],
            target: "00000000-0000-4000-8000-000000000001",
          },
        ],
      }),
      "utf8",
    );
    const { fileSystem, opens } = recordingOpenFileSystem();

    const restored = await createJsonRecoveryRecords({
      directory,
      fileSystem,
      id: () => "windows-migration",
      platform: "win32",
    }).restore();

    expect(restored.failures).toEqual([]);
    expect(restored.inventorySnapshots).toHaveLength(1);
    expect(opens.filter(({ path }) => path === backupPath)).toEqual([
      { flags: "r+", path: backupPath },
    ]);
    expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toMatchObject({
      schemaVersion: 3,
    });
  });

  it.each(["backup", "write"] as const)(
    "keeps a v1 Snapshot migration fault recoverable after a %s failure",
    async (fault) => {
      const directory = await temporaryDirectory();
      const snapshotPath = join(directory, "inventory-snapshots.json");
      const legacyDocument = {
        kind: "inventory-snapshots",
        schemaVersion: 1,
        records: [
          {
            capturedAt: "2026-08-20T08:00:00.000Z",
            cliVersion: "1.5.23",
            generation: 2,
            skills: [],
            target: "00000000-0000-4000-8000-000000000001",
          },
        ],
      };
      await writeFile(snapshotPath, JSON.stringify(legacyDocument), "utf8");

      const failed = createJsonRecoveryRecords({
        directory,
        fileSystem: migrationFaultingFileSystem(fault),
        id: () => `migration-${fault}`,
      });
      await expect(failed.restore()).resolves.toMatchObject({
        failures: [{ code: "migration_failed", store: "inventorySnapshots" }],
        inventorySnapshots: [
          { observedAt: "2026-08-20T08:00:00.000Z" },
        ],
      });
      await expect(readFile(snapshotPath, "utf8")).resolves.toBe(
        JSON.stringify(legacyDocument),
      );

      const restarted = createJsonRecoveryRecords({
        directory,
        id: () => `migration-${fault}-restart`,
      });
      await expect(restarted.restore()).resolves.toMatchObject({
        failures: [],
        inventorySnapshots: [
          {
            observedAt: "2026-08-20T08:00:00.000Z",
            targetId: "00000000-0000-4000-8000-000000000001",
          },
        ],
      });
      expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toMatchObject({
        schemaVersion: 3,
      });
    },
  );

  it("does not replace a legacy Snapshot when a pre-existing backup conflicts", async () => {
    const directory = await temporaryDirectory();
    const snapshotPath = join(directory, "inventory-snapshots.json");
    const backupPath = `${snapshotPath}.v1.backup`;
    const legacyDocument = {
      kind: "inventory-snapshots",
      schemaVersion: 1,
      records: [
        {
          capturedAt: "2026-08-20T08:00:00.000Z",
          cliVersion: "1.5.23",
          generation: 2,
          skills: [],
          target: "00000000-0000-4000-8000-000000000001",
        },
      ],
    };
    const legacyRaw = JSON.stringify(legacyDocument);
    await writeFile(snapshotPath, legacyRaw, "utf8");
    await writeFile(backupPath, "conflicting backup", "utf8");

    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "snapshot-conflicting-backup",
      }).restore(),
    ).resolves.toMatchObject({
      failures: [{ code: "migration_failed", store: "inventorySnapshots" }],
      inventorySnapshots: [{ observedAt: "2026-08-20T08:00:00.000Z" }],
    });
    await expect(readFile(snapshotPath, "utf8")).resolves.toBe(legacyRaw);
    await expect(readFile(backupPath, "utf8")).resolves.toBe(
      "conflicting backup",
    );
  });

  it("accepts an exact pre-existing Snapshot backup and retries migration idempotently", async () => {
    const directory = await temporaryDirectory();
    const snapshotPath = join(directory, "inventory-snapshots.json");
    const backupPath = `${snapshotPath}.v1.backup`;
    const legacyDocument = {
      kind: "inventory-snapshots",
      schemaVersion: 1,
      records: [
        {
          capturedAt: "2026-08-20T08:00:00.000Z",
          cliVersion: "1.5.23",
          generation: 2,
          skills: [],
          target: "00000000-0000-4000-8000-000000000001",
        },
      ],
    };
    const legacyRaw = JSON.stringify(legacyDocument);
    await writeFile(snapshotPath, legacyRaw, "utf8");
    await writeFile(backupPath, legacyRaw, "utf8");

    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "snapshot-matching-backup",
      }).restore(),
    ).resolves.toMatchObject({
      failures: [],
      inventorySnapshots: [
        { targetId: "00000000-0000-4000-8000-000000000001" },
      ],
    });
    expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toMatchObject({
      schemaVersion: 3,
    });
    await expect(readFile(backupPath, "utf8")).resolves.toBe(legacyRaw);
  });

  it.each(["backup", "directory"] as const)(
    "blocks Snapshot replacement when its %s cannot be synchronized",
    async (fault) => {
      const directory = await temporaryDirectory();
      const snapshotPath = join(directory, "inventory-snapshots.json");
      const legacyDocument = {
        kind: "inventory-snapshots",
        schemaVersion: 1,
        records: [
          {
            capturedAt: "2026-08-20T08:00:00.000Z",
            cliVersion: "1.5.23",
            generation: 2,
            skills: [],
            target: "00000000-0000-4000-8000-000000000001",
          },
        ],
      };
      const legacyRaw = JSON.stringify(legacyDocument);
      await writeFile(snapshotPath, legacyRaw, "utf8");

      await expect(
        createJsonRecoveryRecords({
          directory,
          fileSystem: backupSyncFaultingFileSystem(directory, fault),
          id: () => `snapshot-backup-sync-${fault}`,
          platform: "linux",
        }).restore(),
      ).resolves.toMatchObject({
        failures: [{ code: "migration_failed", store: "inventorySnapshots" }],
        inventorySnapshots: [{ observedAt: "2026-08-20T08:00:00.000Z" }],
      });
      await expect(readFile(snapshotPath, "utf8")).resolves.toBe(legacyRaw);
    },
  );

  it("rejects duplicate Snapshot identities in current and legacy documents", async () => {
    const cases = [
      {
        document: {
          kind: "inventory-snapshots",
          legacySnapshots: [],
          schemaVersion: 3,
          snapshots: [
            {
              cliVersion: "1.5.23",
              entries: [],
              generation: 1,
              observedAt: "2026-08-20T08:00:00.000Z",
              targetId: "00000000-0000-4000-8000-000000000001",
            },
            {
              cliVersion: "1.5.23",
              entries: [],
              generation: 2,
              observedAt: "2026-08-21T08:00:00.000Z",
              targetId: "00000000-0000-4000-8000-000000000001",
            },
          ],
        },
        id: "duplicate-current-snapshots",
      },
      {
        document: {
          kind: "inventory-snapshots",
          schemaVersion: 1,
          records: [
            {
              capturedAt: "2026-08-20T08:00:00.000Z",
              cliVersion: "1.5.23",
              generation: 1,
              skills: [],
              target: "legacy-target",
            },
            {
              capturedAt: "2026-08-21T08:00:00.000Z",
              cliVersion: "1.5.23",
              generation: 2,
              skills: [],
              target: "legacy-target",
            },
          ],
        },
        id: "duplicate-legacy-snapshots",
      },
    ] as const;

    for (const { document, id } of cases) {
      const directory = await temporaryDirectory();
      await writeFile(
        join(directory, "inventory-snapshots.json"),
        JSON.stringify(document),
        "utf8",
      );

      await expect(
        createJsonRecoveryRecords({ directory, id: () => id }).restore(),
      ).resolves.toMatchObject({
        failures: [{ code: "corrupt_store", store: "inventorySnapshots" }],
        inventorySnapshots: [],
      });
      expect(await readdir(directory)).toContain(
        `inventory-snapshots.quarantine-${id}.json`,
      );
    }
  });

  it("remaps fixed-point string Target evidence into current UUID records", async () => {
    const directory = await temporaryDirectory();
    const legacyTargetId = "local-codex-0123456789abcdef01234567";
    const retainedLegacyTargetId = "local-codex-fedcba9876543210fedcba98";
    const currentTargetId = "00000000-0000-4000-8000-000000000019";
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "inventory-snapshots.json"),
      JSON.stringify({
        kind: "inventory-snapshots",
        schemaVersion: 2,
        snapshots: [
          {
            cliVersion: "1.5.23",
            entries: [],
            generation: 1,
            observedAt: "2026-08-20T08:00:00.000Z",
            targetId: legacyTargetId,
          },
          {
            cliVersion: "1.5.23",
            entries: [],
            generation: 1,
            observedAt: "2026-08-19T08:00:00.000Z",
            targetId: retainedLegacyTargetId,
          },
          {
            cliVersion: "1.5.23",
            entries: [],
            generation: 2,
            observedAt: "2026-08-21T08:00:00.000Z",
            targetId: currentTargetId,
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(directory, "mutation-guards.json"),
      JSON.stringify({
        guards: [
          {
            deadline: "2026-08-20T08:10:00.000Z",
            effects: "possible",
            generation: 1,
            operationId: "legacy-operation",
            phase: "reconciliation-required",
            targetId: legacyTargetId,
          },
          {
            deadline: "2026-08-19T08:10:00.000Z",
            effects: "possible",
            generation: 1,
            operationId: "retained-legacy-operation",
            phase: "reconciliation-required",
            targetId: retainedLegacyTargetId,
          },
          {
            deadline: "2026-08-21T08:10:00.000Z",
            effects: "possible",
            generation: 2,
            operationId: "current-operation",
            phase: "reconciliation-required",
            targetId: currentTargetId,
          },
        ],
        kind: "mutation-guards",
        schemaVersion: 1,
      }),
      "utf8",
    );
    await writeFile(
      join(directory, "target-definitions.json"),
      JSON.stringify({
        kind: "target-definitions",
        schemaVersion: 3,
        targets: [
          {
            connectionReference: null,
            executionBindingDigest: null,
            generation: 2,
            harness: "Codex",
            id: currentTargetId,
            kind: "local",
            label: "Current local",
            workspace: "/work/current",
          },
        ],
      }),
      "utf8",
    );
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "fixed-point-remap",
    });

    await expect(records.restore()).resolves.toMatchObject({
      failures: [],
      inventorySnapshots: [
        { targetId: legacyTargetId },
        { targetId: retainedLegacyTargetId },
        { targetId: currentTargetId },
      ],
      mutationGuards: [
        { targetId: currentTargetId },
        { targetId: legacyTargetId },
        { targetId: retainedLegacyTargetId },
      ],
    });
    await expect(
      records.commit({
        fromTargetId: legacyTargetId,
        toTargetId: currentTargetId,
        type: "target.remap",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(records.restore()).resolves.toMatchObject({
      failures: [],
      inventorySnapshots: [
        {
          generation: 2,
          observedAt: "2026-08-21T08:00:00.000Z",
          targetId: currentTargetId,
        },
        { targetId: retainedLegacyTargetId },
      ],
      mutationGuards: [
        {
          generation: 2,
          operationId: "current-operation",
          targetId: currentTargetId,
        },
        { targetId: retainedLegacyTargetId },
      ],
    });
    expect(
      JSON.parse(
        await readFile(join(directory, "inventory-snapshots.json"), "utf8"),
      ),
    ).toMatchObject({
      legacySnapshots: [{ targetId: retainedLegacyTargetId }],
      schemaVersion: 3,
      snapshots: [{ targetId: currentTargetId }],
    });
    expect(
      JSON.parse(
        await readFile(join(directory, "mutation-guards.json"), "utf8"),
      ),
    ).toMatchObject({
      guards: [{ targetId: currentTargetId }],
      legacyGuards: [{ targetId: retainedLegacyTargetId }],
      schemaVersion: 3,
    });
    await expect(
      readFile(join(directory, "inventory-snapshots.json.v2.backup"), "utf8"),
    ).resolves.toContain(legacyTargetId);
    await expect(
      readFile(join(directory, "mutation-guards.json.v1.backup"), "utf8"),
    ).resolves.toContain(legacyTargetId);
  });

  it("keeps current UUID evidence on an in-memory remap collision", async () => {
    const legacyTargetId = "local-codex-0123456789abcdef01234567";
    const currentTargetId = "00000000-0000-4000-8000-000000000020";
    const records = createMemoryRecoveryRecords(
      [
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: 2,
          observedAt: "2026-08-21T08:00:00.000Z",
          targetId: currentTargetId,
        },
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: 1,
          observedAt: "2026-08-20T08:00:00.000Z",
          targetId: legacyTargetId,
        },
      ],
      [
        {
          ...guardV3Binding,
          deadline: "2026-08-21T08:10:00.000Z",
          effects: "possible",
          generation: 2,
          operationId: "current-operation",
          phase: "reconciliation-required",
          targetId: currentTargetId,
        },
        {
          ...guardV3Binding,
          deadline: "2026-08-20T08:10:00.000Z",
          effects: "possible",
          generation: 1,
          operationId: "legacy-operation",
          phase: "reconciliation-required",
          targetId: legacyTargetId,
        },
      ],
    );

    await expect(
      records.commit({
        fromTargetId: legacyTargetId,
        toTargetId: currentTargetId,
        type: "target.remap",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(records.restore()).resolves.toMatchObject({
      inventorySnapshots: [
        {
          generation: 2,
          observedAt: "2026-08-21T08:00:00.000Z",
          targetId: currentTargetId,
        },
      ],
      mutationGuards: [
        {
          generation: 2,
          operationId: "current-operation",
          targetId: currentTargetId,
        },
      ],
    });
  });

  it("keeps delayed remap primaries unchanged for a conflicting backup and retries with a matching backup", async () => {
    const directory = await temporaryDirectory();
    const legacyTargetId = "local-codex-0123456789abcdef01234567";
    const currentTargetId = "00000000-0000-4000-8000-000000000020";
    const snapshotPath = join(directory, "inventory-snapshots.json");
    const guardPath = join(directory, "mutation-guards.json");
    const snapshotDocument = {
      kind: "inventory-snapshots",
      schemaVersion: 2,
      snapshots: [
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: 1,
          observedAt: "2026-08-20T08:00:00.000Z",
          targetId: legacyTargetId,
        },
      ],
    };
    const guardDocument = {
      guards: [
        {
          deadline: "2026-08-20T08:10:00.000Z",
          effects: "possible",
          generation: 1,
          operationId: "legacy-operation",
          phase: "reconciliation-required",
          targetId: legacyTargetId,
        },
      ],
      kind: "mutation-guards",
      schemaVersion: 1,
    };
    const snapshotRaw = JSON.stringify(snapshotDocument);
    const guardRaw = JSON.stringify(guardDocument);
    await writeFile(snapshotPath, snapshotRaw, "utf8");
    await writeFile(guardPath, guardRaw, "utf8");
    await writeFile(
      join(directory, "target-definitions.json"),
      JSON.stringify({
        kind: "target-definitions",
        schemaVersion: 3,
        targets: [
          {
            connectionReference: null,
            executionBindingDigest: null,
            generation: 1,
            harness: "Codex",
            id: currentTargetId,
            kind: "local",
            label: "Current local",
            workspace: "/work/current",
          },
        ],
      }),
      "utf8",
    );
    const snapshotBackupPath = `${snapshotPath}.v2.backup`;
    await writeFile(snapshotBackupPath, "conflicting backup", "utf8");
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "delayed-remap-backup",
    });

    await expect(records.restore()).resolves.toMatchObject({
      failures: [],
      inventorySnapshots: [{ targetId: legacyTargetId }],
      mutationGuards: [{ targetId: legacyTargetId }],
    });
    const guardAfterRestore = await readFile(guardPath, "utf8");
    await expect(
      records.commit({
        fromTargetId: legacyTargetId,
        toTargetId: currentTargetId,
        type: "target.remap",
      }),
    ).resolves.toMatchObject({
      error: { code: "persist_failed" },
      ok: false,
    });
    await expect(readFile(snapshotPath, "utf8")).resolves.toBe(snapshotRaw);
    await expect(readFile(guardPath, "utf8")).resolves.toBe(guardAfterRestore);
    await expect(readFile(snapshotBackupPath, "utf8")).resolves.toBe(
      "conflicting backup",
    );

    await writeFile(snapshotBackupPath, snapshotRaw, "utf8");
    await expect(
      records.commit({
        fromTargetId: legacyTargetId,
        toTargetId: currentTargetId,
        type: "target.remap",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(records.restore()).resolves.toMatchObject({
      failures: [],
      inventorySnapshots: [{ targetId: currentTargetId }],
      mutationGuards: [{ targetId: currentTargetId }],
    });
  });

  it("rejects a current UUID as a legacy remap source", async () => {
    const currentTargetId = "00000000-0000-4000-8000-000000000020";
    const replacementTargetId = "00000000-0000-4000-8000-000000000021";
    const records = createMemoryRecoveryRecords([], [
      {
        ...guardV3Binding,
        deadline: "2026-08-21T08:10:00.000Z",
        effects: "possible",
        generation: 2,
        operationId: "current-operation",
        phase: "executing",
        targetId: currentTargetId,
      },
    ]);

    await expect(
      records.commit({
        fromTargetId: currentTargetId,
        toTargetId: replacementTargetId,
        type: "target.remap",
      }),
    ).resolves.toMatchObject({
      error: { code: "persist_failed" },
      ok: false,
    });
    await expect(records.restore()).resolves.toMatchObject({
      mutationGuards: [{ targetId: currentTargetId }],
    });
  });

  it("quarantines corrupt input instead of treating it as durable empty state", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "inventory-snapshots.json"), "not json");
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "corrupt",
    });

    const restored = await records.restore();

    expect(restored.failures).toEqual([
      { code: "corrupt_store", store: "inventorySnapshots" },
    ]);
    expect(
      await readFile(
        join(directory, "inventory-snapshots.quarantine-corrupt.json"),
        "utf8",
      ),
    ).toBe("not json");
  });

  it("refuses to overwrite a newer unsupported schema", async () => {
    const directory = await temporaryDirectory();
    const document = JSON.stringify({
      kind: "inventory-snapshots",
      schemaVersion: 99,
      snapshots: [],
    });
    const path = join(directory, "inventory-snapshots.json");
    await writeFile(path, document);
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "newer",
    });

    expect((await records.restore()).failures).toEqual([
      { code: "unsupported_schema", store: "inventorySnapshots" },
    ]);
    expect(
      await records.commit({
        generation: 1,
        inventory,
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "inventory.replace",
      }),
    ).toMatchObject({ error: { code: "unsupported_schema" }, ok: false });
    expect(await readFile(path, "utf8")).toBe(document);
  });

  it("retains the prior durable Snapshot when an atomic replacement cannot start", async () => {
    const directory = await temporaryDirectory();
    const ids = ["first", "blocked"];
    const records = createJsonRecoveryRecords({
      directory,
      id: () => ids.shift() ?? "unexpected",
    });
    const path = join(directory, "inventory-snapshots.json");
    expect(
      await records.commit({
        generation: 1,
        inventory,
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "inventory.replace",
      }),
    ).toEqual({ ok: true, value: undefined });
    const durableBeforeFault = await readFile(path, "utf8");
    await writeFile(
      join(directory, ".inventory-snapshots.json.blocked.tmp"),
      "collision",
    );

    const failed = await records.commit({
      generation: 2,
      inventory: { ...inventory, observedAt: "2026-08-21T11:00:00.000Z" },
      targetId: "00000000-0000-4000-8000-000000000001",
      type: "inventory.replace",
    });

    expect(failed).toMatchObject({
      error: { code: "persist_failed", effects: "none" },
      ok: false,
    });
    expect(await readFile(path, "utf8")).toBe(durableBeforeFault);
    expect((await records.restore()).inventorySnapshots[0]).toMatchObject({
      generation: 1,
      observedAt: "2026-08-21T10:00:00.000Z",
    });
  });

  it.each(["temporary-sync", "replace", "directory-sync"] as const)(
    "contains a %s fault behind the RecoveryRecords boundary",
    async (fault) => {
      const directory = await temporaryDirectory();
      const initial = createJsonRecoveryRecords({
        directory,
        id: () => "initial",
      });
      expect(
        await initial.commit({
          generation: 1,
          inventory,
          targetId: "00000000-0000-4000-8000-000000000001",
          type: "inventory.replace",
        }),
      ).toEqual({ ok: true, value: undefined });
      const path = join(directory, "inventory-snapshots.json");
      const beforeFault = await readFile(path, "utf8");
      const records = createJsonRecoveryRecords({
        directory,
        fileSystem: faultingFileSystem(fault),
        id: () => fault,
        platform: "linux",
      });
      await records.restore();

      const result = await records.commit({
        generation: 2,
        inventory: { ...inventory, observedAt: "2026-08-21T11:00:00.000Z" },
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "inventory.replace",
      });

      expect(result).toMatchObject({
        error: { code: "persist_failed" },
        ok: false,
      });
      const afterFault = await readFile(path, "utf8");
      expect(() => JSON.parse(afterFault)).not.toThrow();
      if (fault === "directory-sync") {
        expect(JSON.parse(afterFault)).toMatchObject({
          snapshots: [{ generation: 2 }],
        });
      } else {
        expect(afterFault).toBe(beforeFault);
      }
      expect(
        (await readdir(directory)).some((name) => name.endsWith(".tmp")),
      ).toBe(false);
    },
  );

  it("serializes concurrent writes under its application lock", async () => {
    const directory = await temporaryDirectory();
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "serialized",
    });

    const results = await Promise.all([
      records.commit({
        generation: 1,
        inventory,
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "inventory.replace",
      }),
      records.commit({
        generation: 2,
        inventory: { ...inventory, observedAt: "2026-08-21T11:00:00.000Z" },
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "inventory.replace",
      }),
    ]);

    expect(results).toEqual([
      { ok: true, value: undefined },
      { ok: true, value: undefined },
    ]);
    expect(
      JSON.parse(
        await readFile(join(directory, "inventory-snapshots.json"), "utf8"),
      ),
    ).toMatchObject({ snapshots: [{ generation: 2 }] });
  });

  it("does not overwrite a store that failed before it could be read", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "inventory-snapshots.json");
    await mkdir(path);
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "unreadable",
    });

    expect((await records.restore()).failures).toEqual([
      { code: "corrupt_store", store: "inventorySnapshots" },
    ]);
    expect(
      await records.commit({
        generation: 1,
        inventory,
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "inventory.replace",
      }),
    ).toMatchObject({
      error: {
        code: "persist_failed",
        message:
          "Recovery data could not be read safely and will not be overwritten.",
      },
      ok: false,
    });
    await expect(
      (await import("node:fs/promises"))
        .stat(path)
        .then((details) => details.isDirectory()),
    ).resolves.toBe(true);
  });
});

describe("RecoveryRecords Target Definition contract", () => {
  it("migrates a known scalar harness without changing Target identity", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "target-definitions.json");
    const targetId = "00000000-0000-4000-8000-000000000021";
    const legacyDocument = {
      kind: "target-definitions",
      schemaVersion: 3,
      targets: [
        {
          connectionReference: null,
          executionBindingDigest: "a".repeat(64),
          generation: 7,
          harness: "Codex",
          id: targetId,
          kind: "local",
          label: "Legacy Codex",
          workspace: "/work/legacy",
        },
      ],
    };
    await writeFile(targetPath, JSON.stringify(legacyDocument), "utf8");

    const restored = await createJsonRecoveryRecords({
      directory,
      id: () => "target-v4-migration",
    }).restore();

    expect(restored.failures).toEqual([]);
    expect(restored.targetDefinitions).toEqual([
      {
        connectionReference: null,
        dialectId: "skills-1.5.23",
        executionBindingDigest: null,
        generation: 8,
        harnessIds: ["codex"],
        id: targetId,
        kind: "local",
        label: "Legacy Codex",
        registryDigest:
          "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
        registryVersion: 1,
        workspace: "/work/legacy",
      },
    ]);
    expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual({
      kind: "target-definitions",
      schemaVersion: 4,
      targets: restored.targetDefinitions,
    });
    await expect(readFile(`${targetPath}.v3.backup`, "utf8")).resolves.toBe(
      JSON.stringify(legacyDocument),
    );
  });

  it("atomically migrates Target, Snapshot, and surviving Guard authority", async () => {
    const directory = await temporaryDirectory();
    const targetId = "00000000-0000-4000-8000-000000000022";
    const targetPath = join(directory, "target-definitions.json");
    const snapshotPath = join(directory, "inventory-snapshots.json");
    const guardPath = join(directory, "mutation-guards.json");
    const legacyTarget = {
      kind: "target-definitions",
      schemaVersion: 3,
      targets: [
        {
          connectionReference: null,
          executionBindingDigest: null,
          generation: 7,
          harness: "Codex",
          id: targetId,
          kind: "local",
          label: "Guarded Codex",
          workspace: "/work/legacy",
        },
      ],
    };
    const snapshot = {
      kind: "inventory-snapshots",
      legacySnapshots: [],
      schemaVersion: 3,
      snapshots: [
        {
          cliVersion: "1.5.23",
          entries: [],
          generation: 7,
          observedAt: "2026-08-20T08:00:00.000Z",
          targetId,
        },
      ],
    };
    const legacyGuard = {
      guards: [
        {
          deadline: "2026-08-20T08:10:00.000Z",
          effects: "possible",
          generation: 7,
          operationId: "legacy-operation",
          phase: "executing",
          targetId,
        },
      ],
      kind: "mutation-guards",
      legacyGuards: [],
      schemaVersion: 2,
    };
    await writeFile(targetPath, JSON.stringify(legacyTarget), "utf8");
    await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
    await writeFile(guardPath, JSON.stringify(legacyGuard), "utf8");

    const restored = await createJsonRecoveryRecords({
      directory,
      id: () => "cross-record-migration",
    }).restore();

    expect(restored.failures).toEqual([]);
    expect(restored.targetDefinitions).toMatchObject([
      { generation: 8, harnessIds: ["codex"], id: targetId },
    ]);
    expect(restored.inventorySnapshots).toEqual(snapshot.snapshots);
    expect(restored.mutationGuards).toEqual([
      {
        bindingDigest:
          "sha256:e5cd92c8602592fc4573df9ba9b40fb83b42764b851d2ae1b8ba8f40a491e5fc",
        deadline: "2026-08-20T08:10:00.000Z",
        dialectId: "skills-1.5.23",
        effects: "possible",
        generation: 7,
        harnessSetDigest:
          "sha256:e25eaf648dc7039953915d93cac78cc23b21b780b60f562ff1aaa53086f25364",
        operationId: "legacy-operation",
        phase: "reconciliation-required",
        registryDigest:
          "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
        targetId,
      },
    ]);
    expect(JSON.parse(await readFile(guardPath, "utf8"))).toMatchObject({
      schemaVersion: 3,
    });
    await expect(readFile(`${targetPath}.v3.backup`, "utf8")).resolves.toBe(
      JSON.stringify(legacyTarget),
    );
    await expect(readFile(`${guardPath}.v2.backup`, "utf8")).resolves.toBe(
      JSON.stringify(legacyGuard),
    );

    const restarted = await createJsonRecoveryRecords({
      directory,
      id: () => "cross-record-restart",
    }).restore();
    expect(restarted.targetDefinitions[0]?.generation).toBe(8);
    expect(restarted.mutationGuards).toEqual(restored.mutationGuards);
  });

  it("publishes no partial Target v4 state when Guard migration replacement fails", async () => {
    const directory = await temporaryDirectory();
    const targetId = "00000000-0000-4000-8000-000000000023";
    const targetPath = join(directory, "target-definitions.json");
    const guardPath = join(directory, "mutation-guards.json");
    const legacyTargetRaw = JSON.stringify({
      kind: "target-definitions",
      schemaVersion: 3,
      targets: [
        {
          connectionReference: null,
          executionBindingDigest: null,
          generation: 2,
          harness: "Codex",
          id: targetId,
          kind: "local",
          label: "Atomic Codex",
          workspace: "/work/atomic",
        },
      ],
    });
    const legacyGuardRaw = JSON.stringify({
      guards: [
        {
          deadline: "2026-08-20T08:10:00.000Z",
          effects: "possible",
          generation: 2,
          operationId: "atomic-operation",
          phase: "executing",
          targetId,
        },
      ],
      kind: "mutation-guards",
      legacyGuards: [],
      schemaVersion: 2,
    });
    await writeFile(targetPath, legacyTargetRaw, "utf8");
    await writeFile(guardPath, legacyGuardRaw, "utf8");
    const delegate = createNodeRecoveryFileSystem();
    const records = createJsonRecoveryRecords({
      directory,
      fileSystem: {
        ...delegate,
        rename(source, destination) {
          if (destination === guardPath) {
            return Promise.reject(new Error("Guard replacement fault"));
          }
          return delegate.rename(source, destination);
        },
      },
      id: () => "atomic-fault",
    });

    await expect(records.restore()).resolves.toMatchObject({
      failures: [
        { code: "migration_failed", store: "mutationGuards" },
        { code: "migration_failed", store: "targetDefinitions" },
      ],
      targetDefinitions: [],
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe(legacyTargetRaw);
    await expect(readFile(guardPath, "utf8")).resolves.toBe(legacyGuardRaw);

    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "atomic-restart",
      }).restore(),
    ).resolves.toMatchObject({
      failures: [],
      mutationGuards: [{ targetId }],
      targetDefinitions: [{ generation: 3, harnessIds: ["codex"], id: targetId }],
    });
  });

  it("keeps a legacy Guard retryable when Target replacement fails first", async () => {
    const directory = await temporaryDirectory();
    const targetId = "00000000-0000-4000-8000-000000000026";
    const targetPath = join(directory, "target-definitions.json");
    const guardPath = join(directory, "mutation-guards.json");
    const legacyTargetRaw = JSON.stringify({
      kind: "target-definitions",
      schemaVersion: 3,
      targets: [
        {
          connectionReference: null,
          executionBindingDigest: null,
          generation: 2,
          harness: "Codex",
          id: targetId,
          kind: "local",
          label: "Retryable Codex",
          workspace: "/work/retryable",
        },
      ],
    });
    const legacyGuardRaw = JSON.stringify({
      guards: [
        {
          deadline: "2026-08-20T08:10:00.000Z",
          effects: "possible",
          generation: 2,
          operationId: "retryable-operation",
          phase: "executing",
          targetId,
        },
      ],
      kind: "mutation-guards",
      legacyGuards: [],
      schemaVersion: 2,
    });
    await writeFile(targetPath, legacyTargetRaw, "utf8");
    await writeFile(guardPath, legacyGuardRaw, "utf8");
    const delegate = createNodeRecoveryFileSystem();
    const restored = await createJsonRecoveryRecords({
      directory,
      fileSystem: {
        ...delegate,
        rename(source, destination) {
          if (destination === targetPath) {
            return Promise.reject(new Error("Target replacement fault"));
          }
          return delegate.rename(source, destination);
        },
      },
      id: () => "target-before-guard-fault",
    }).restore();

    expect(restored).toMatchObject({
      failures: [
        { code: "migration_failed", store: "mutationGuards" },
        { code: "migration_failed", store: "targetDefinitions" },
      ],
      mutationGuards: [
        {
          harnessSetDigest:
            "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          targetId,
        },
      ],
      targetDefinitions: [],
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe(legacyTargetRaw);
    await expect(readFile(guardPath, "utf8")).resolves.toBe(legacyGuardRaw);

    const restarted = await createJsonRecoveryRecords({
      directory,
      id: () => "target-before-guard-restart",
    }).restore();
    expect(restarted.failures).toEqual([]);
    expect(restarted.mutationGuards).toMatchObject([
      {
        harnessSetDigest:
          "sha256:e25eaf648dc7039953915d93cac78cc23b21b780b60f562ff1aaa53086f25364",
        targetId,
      },
    ]);
  });

  it("does not roll Target back after Guard replacement is already visible", async () => {
    const directory = await temporaryDirectory();
    const targetId = "00000000-0000-4000-8000-000000000025";
    const targetPath = join(directory, "target-definitions.json");
    const guardPath = join(directory, "mutation-guards.json");
    await writeFile(
      targetPath,
      JSON.stringify({
        kind: "target-definitions",
        schemaVersion: 3,
        targets: [
          {
            connectionReference: null,
            executionBindingDigest: null,
            generation: 2,
            harness: "Codex",
            id: targetId,
            kind: "local",
            label: "Synced Codex",
            workspace: "/work/synced",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      guardPath,
      JSON.stringify({
        guards: [
          {
            deadline: "2026-08-20T08:10:00.000Z",
            effects: "possible",
            generation: 2,
            operationId: "synced-operation",
            phase: "executing",
            targetId,
          },
        ],
        kind: "mutation-guards",
        legacyGuards: [],
        schemaVersion: 2,
      }),
      "utf8",
    );
    const delegate = createNodeRecoveryFileSystem();
    const records = createJsonRecoveryRecords({
      directory,
      fileSystem: {
        ...delegate,
        async rename(source, destination) {
          await delegate.rename(source, destination);
          if (destination === guardPath) {
            throw new Error("Post-Guard replacement fault");
          }
        },
      },
      id: () => "post-guard-replacement",
    });

    await expect(records.restore()).resolves.toMatchObject({
      failures: [{ code: "migration_failed", store: "mutationGuards" }],
      mutationGuards: [{ targetId }],
      targetDefinitions: [{ generation: 3, harnessIds: ["codex"], id: targetId }],
    });
    await expect(
      readFile(targetPath, "utf8").then(JSON.parse),
    ).resolves.toMatchObject({ schemaVersion: 4 });
    await expect(
      readFile(guardPath, "utf8").then(JSON.parse),
    ).resolves.toMatchObject({ schemaVersion: 3 });
  });

  it("retains an unmapped legacy harness as blocked migration authority", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "target-definitions.json");
    const targetId = "00000000-0000-4000-8000-000000000024";
    const legacyRaw = JSON.stringify({
      kind: "target-definitions",
      schemaVersion: 3,
      targets: [
        {
          connectionReference: null,
          executionBindingDigest: null,
          generation: 4,
          harness: "Future Harness",
          id: targetId,
          kind: "local",
          label: "Needs repair",
          workspace: "/work/blocked",
        },
      ],
    });
    await writeFile(targetPath, legacyRaw, "utf8");

    const restored = await createJsonRecoveryRecords({
      directory,
      id: () => "unmapped-harness",
    }).restore();

    expect(restored).toMatchObject({
      blockedTargetDefinitions: [
        {
          generation: 4,
          id: targetId,
          label: "Needs repair",
          legacyHarness: "Future Harness",
          reason: "unsupported_harness",
        },
      ],
      failures: [
        {
          code: "migration_failed",
          store: "targetDefinitions",
          targetIds: [targetId],
        },
      ],
      targetDefinitions: [],
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe(legacyRaw);
    await expect(readdir(directory)).resolves.not.toContain(
      "target-definitions.quarantine-unmapped-harness.json",
    );
  });

  it("restores allowlisted Local and SSH Target Definitions in memory", async () => {
    const records = createMemoryRecoveryRecords();

    const committed = await records.commit({
      targets: [
        {
          connectionReference: null,
          ...targetV4Binding,
          generation: 2,
          id: "00000000-0000-4000-8000-000000000001",
          kind: "local",
          label: "Workstation",
          workspace: "/work/project",
        },
        {
          connectionReference: "build-host",
          ...targetV4Binding,
          generation: 4,
          id: "00000000-0000-4000-8000-00000000000a",
          kind: "ssh",
          label: "Build host",
          workspace: "/srv/project",
        },
      ],
      type: "targets.replace",
    });

    expect(committed).toEqual({ ok: true, value: undefined });
    await expect(records.restore()).resolves.toMatchObject({
      failures: [],
      targetDefinitions: [
        {
          connectionReference: null,
          ...targetV4Binding,
          generation: 2,
          id: "00000000-0000-4000-8000-000000000001",
          kind: "local",
          label: "Workstation",
          workspace: "/work/project",
        },
        {
          connectionReference: "build-host",
          ...targetV4Binding,
          generation: 4,
          id: "00000000-0000-4000-8000-00000000000a",
          kind: "ssh",
          label: "Build host",
          workspace: "/srv/project",
        },
      ],
    });
  });

  it("atomically restores Target Definitions from an independent JSON document", async () => {
    const directory = await temporaryDirectory();
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "target-write",
    });

    await expect(
      records.commit({
        targets: [
          {
            connectionReference: "build-host",
            ...targetV4Binding,
            generation: 1,
            id: "00000000-0000-4000-8000-00000000000a",
            kind: "ssh",
            label: "Build host",
            workspace: "/srv/project",
          },
        ],
        type: "targets.replace",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });

    const restored = await createJsonRecoveryRecords({
      directory,
      id: () => "target-restore",
    }).restore();
    expect(restored.targetDefinitions).toEqual([
      {
        connectionReference: "build-host",
        ...targetV4Binding,
        generation: 1,
        id: "00000000-0000-4000-8000-00000000000a",
        kind: "ssh",
        label: "Build host",
        workspace: "/srv/project",
      },
    ]);
    expect(
      JSON.parse(
        await readFile(join(directory, "target-definitions.json"), "utf8"),
      ),
    ).toEqual({
      kind: "target-definitions",
      schemaVersion: 4,
      targets: restored.targetDefinitions,
    });
  });

  it("migrates a v1 Target Definition document with a retained backup", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "target-definitions.json");
    await mkdir(directory, { recursive: true });
    const legacyDocument = {
      kind: "target-definitions",
      schemaVersion: 1,
      targets: [
        {
          connectionReference: null,
          harness: "Codex",
          id: "00000000-0000-4000-8000-000000000016",
          kind: "local",
          label: "Legacy local",
          workspace: "/work/legacy",
        },
      ],
    };
    await writeFile(targetPath, JSON.stringify(legacyDocument), "utf8");

    const restored = await createJsonRecoveryRecords({
      directory,
      id: () => "target-migration",
    }).restore();

    expect(restored.targetDefinitions).toEqual(
      legacyDocument.targets.map((definition) => ({
        connectionReference: definition.connectionReference,
        ...targetV4Binding,
        executionBindingDigest: null,
        generation: 1,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    );
    expect(JSON.parse(await readFile(targetPath, "utf8"))).toMatchObject({
      kind: "target-definitions",
      schemaVersion: 4,
      targets: legacyDocument.targets.map((definition) => ({
        connectionReference: definition.connectionReference,
        ...targetV4Binding,
        executionBindingDigest: null,
        generation: 1,
        id: definition.id,
        kind: definition.kind,
        label: definition.label,
        workspace: definition.workspace,
      })),
    });
    expect(
      JSON.parse(await readFile(`${targetPath}.v1.backup`, "utf8")),
    ).toEqual(legacyDocument);
  });

  it("migrates v2 Target Definitions to a nullable effective-binding digest", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "target-definitions.json");
    await mkdir(directory, { recursive: true });
    const legacyDocument = {
      kind: "target-definitions",
      schemaVersion: 2,
      targets: [
        {
          connectionReference: "build-host",
          generation: 4,
          harness: "Codex",
          id: "00000000-0000-4000-8000-000000000018",
          kind: "ssh",
          label: "Build host",
          workspace: "/srv/skills",
        },
      ],
    };
    await writeFile(targetPath, JSON.stringify(legacyDocument), "utf8");

    const restored = await createJsonRecoveryRecords({
      directory,
      id: () => "target-v2-migration",
    }).restore();

    expect(restored.targetDefinitions).toEqual([
      {
        connectionReference: "build-host",
        ...targetV4Binding,
        generation: 5,
        id: "00000000-0000-4000-8000-000000000018",
        kind: "ssh",
        label: "Build host",
        workspace: "/srv/skills",
      },
    ]);
    expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual({
      kind: "target-definitions",
      schemaVersion: 4,
      targets: restored.targetDefinitions,
    });
    expect(
      JSON.parse(await readFile(`${targetPath}.v2.backup`, "utf8")),
    ).toEqual(legacyDocument);
  });

  it("refuses to overwrite Target Definitions from a newer schema", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "target-definitions.json");
    await mkdir(directory, { recursive: true });
    const newerDocument = {
      kind: "target-definitions",
      schemaVersion: 5,
      targets: [],
    };
    await writeFile(targetPath, JSON.stringify(newerDocument), "utf8");
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "newer-target-schema",
    });

    await expect(records.restore()).resolves.toMatchObject({
      failures: [{ code: "unsupported_schema", store: "targetDefinitions" }],
      targetDefinitions: [],
    });
    await expect(
      records.commit({ targets: [], type: "targets.replace" }),
    ).resolves.toMatchObject({
      error: { code: "unsupported_schema" },
      ok: false,
    });
    expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual(
      newerDocument,
    );
  });

  it("quarantines corrupt Target Definitions instead of substituting empty authority", async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "target-definitions.json"),
      "{not valid JSON",
      "utf8",
    );
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "corrupt-targets",
    });

    await expect(records.restore()).resolves.toMatchObject({
      failures: [{ code: "corrupt_store", store: "targetDefinitions" }],
      targetDefinitions: [],
    });
    expect(await readdir(directory)).toContain(
      "target-definitions.quarantine-corrupt-targets.json",
    );

    const restarted = createJsonRecoveryRecords({
      directory,
      id: () => "corrupt-targets-restart",
    });
    await expect(restarted.restore()).resolves.toMatchObject({
      failures: [{ code: "corrupt_store", store: "targetDefinitions" }],
      targetDefinitions: [],
    });
    await expect(
      restarted.commit({ targets: [], type: "targets.replace" }),
    ).resolves.toMatchObject({
      error: { code: "persist_failed" },
      ok: false,
    });
  });

  it("rejects duplicate Target identities in current and legacy documents", async () => {
    const cases = [
      {
        document: {
          kind: "target-definitions",
          schemaVersion: 3,
          targets: [
            {
              connectionReference: null,
              executionBindingDigest: null,
              generation: 1,
              harness: "Codex",
              id: "00000000-0000-4000-8000-000000000001",
              kind: "local",
              label: "First",
              workspace: "/work/first",
            },
            {
              connectionReference: null,
              executionBindingDigest: null,
              generation: 2,
              harness: "Codex",
              id: "00000000-0000-4000-8000-000000000001",
              kind: "local",
              label: "Second",
              workspace: "/work/second",
            },
          ],
        },
        id: "duplicate-current-targets",
      },
      {
        document: {
          kind: "target-definitions",
          schemaVersion: 1,
          targets: [
            {
              connectionReference: null,
              harness: "Codex",
              id: "00000000-0000-4000-8000-000000000001",
              kind: "local",
              label: "First",
              workspace: "/work/first",
            },
            {
              connectionReference: null,
              harness: "Codex",
              id: "00000000-0000-4000-8000-000000000001",
              kind: "local",
              label: "Second",
              workspace: "/work/second",
            },
          ],
        },
        id: "duplicate-legacy-targets",
      },
    ] as const;

    for (const { document, id } of cases) {
      const directory = await temporaryDirectory();
      await writeFile(
        join(directory, "target-definitions.json"),
        JSON.stringify(document),
        "utf8",
      );

      await expect(
        createJsonRecoveryRecords({ directory, id: () => id }).restore(),
      ).resolves.toMatchObject({
        failures: [{ code: "corrupt_store", store: "targetDefinitions" }],
        targetDefinitions: [],
      });
      expect(await readdir(directory)).toContain(
        `target-definitions.quarantine-${id}.json`,
      );
    }
  });
});

describe("RecoveryRecords Mutation Guard contract", () => {
  it("restores and explicitly clears one minimal Guard per Target in memory", async () => {
    const records = createMemoryRecoveryRecords();

    expect(
      await records.commit({
        deadline: "2026-08-21T10:10:00.000Z",
        effects: "none",
        generation: 3,
        operationId: "mutation-1",
        phase: "reconciliation-required",
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "guard.put",
      }),
    ).toEqual({ ok: true, value: undefined });
    expect((await records.restore()).mutationGuards).toMatchObject([
      {
        deadline: "2026-08-21T10:10:00.000Z",
        effects: "none",
        generation: 3,
        operationId: "mutation-1",
        phase: "reconciliation-required",
        targetId: "00000000-0000-4000-8000-000000000001",
      },
    ]);

    expect(
      await records.commit({
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "guard.clear",
      }),
    ).toEqual({ ok: true, value: undefined });
    expect((await records.restore()).mutationGuards).toEqual([]);
  });

  it("durably allowlists Guard recovery authority in an independent JSON document", async () => {
    const directory = await temporaryDirectory();
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "guard-write",
    });

    expect(
      await records.commit({
        deadline: "2026-08-21T10:10:00.000Z",
        effects: "possible",
        generation: 3,
        operationId: "mutation-1",
        phase: "reconciliation-required",
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "guard.put",
      }),
    ).toEqual({ ok: true, value: undefined });

    const persisted = await readFile(
      join(directory, "mutation-guards.json"),
      "utf8",
    );
    expect(JSON.parse(persisted)).toMatchObject({
      guards: [
        {
          deadline: "2026-08-21T10:10:00.000Z",
          effects: "possible",
          generation: 3,
          operationId: "mutation-1",
          phase: "reconciliation-required",
          targetId: "00000000-0000-4000-8000-000000000001",
        },
      ],
      kind: "mutation-guards",
      legacyGuards: [],
      schemaVersion: 3,
    });
    expect(persisted).not.toContain('"entries"');
    expect(persisted).not.toContain("preview");
    expect(persisted).not.toContain("args");

    const restarted = createJsonRecoveryRecords({
      directory,
      id: () => "guard-restart",
    });
    expect((await restarted.restore()).mutationGuards).toEqual(
      JSON.parse(persisted).guards,
    );
  });

  it("merges a remap collision without shortening Guard deadline or effects", async () => {
    const directory = await temporaryDirectory();
    const legacyTargetId = "local-codex-0123456789abcdef01234567";
    const currentTargetId = "00000000-0000-4000-8000-000000000020";
    await writeFile(
      join(directory, "mutation-guards.json"),
      JSON.stringify({
        guards: [
          {
            deadline: "2026-08-21T12:10:00.000Z",
            effects: "none",
            generation: 2,
            operationId: "current-operation",
            phase: "reconciliation-required",
            targetId: currentTargetId,
          },
          {
            deadline: "2026-08-21T13:10:00.000Z",
            effects: "possible",
            generation: 1,
            operationId: "legacy-operation",
            phase: "reconciliation-required",
            targetId: legacyTargetId,
          },
        ],
        kind: "mutation-guards",
        schemaVersion: 1,
      }),
      "utf8",
    );
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "reverse-deadline",
    });

    await expect(
      records.commit({
        fromTargetId: legacyTargetId,
        toTargetId: currentTargetId,
        type: "target.remap",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(records.restore()).resolves.toMatchObject({
      mutationGuards: [
        {
          deadline: "2026-08-21T13:10:00.000Z",
          effects: "possible",
          targetId: currentTargetId,
        },
      ],
    });
    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "reverse-deadline-restart",
      }).restore(),
    ).resolves.toMatchObject({
      mutationGuards: [
        {
          deadline: "2026-08-21T13:10:00.000Z",
          effects: "possible",
          targetId: currentTargetId,
        },
      ],
    });
  });

  it("rejects duplicate Guard identities in current and legacy documents", async () => {
    const cases = [
      {
        document: {
          guards: [
            {
              deadline: "2026-08-21T10:10:00.000Z",
              effects: "none",
              generation: 1,
              operationId: "first",
              phase: "executing",
              targetId: "00000000-0000-4000-8000-000000000001",
            },
            {
              deadline: "2026-08-21T11:10:00.000Z",
              effects: "possible",
              generation: 2,
              operationId: "second",
              phase: "reconciliation-required",
              targetId: "00000000-0000-4000-8000-000000000001",
            },
          ],
          kind: "mutation-guards",
          legacyGuards: [],
          schemaVersion: 2,
        },
        id: "duplicate-current-guards",
      },
      {
        document: {
          guards: [
            {
              deadline: "2026-08-21T10:10:00.000Z",
              effects: "none",
              generation: 1,
              operationId: "first",
              phase: "executing",
              targetId: "legacy-target",
            },
            {
              deadline: "2026-08-21T11:10:00.000Z",
              effects: "possible",
              generation: 2,
              operationId: "second",
              phase: "reconciliation-required",
              targetId: "legacy-target",
            },
          ],
          kind: "mutation-guards",
          schemaVersion: 1,
        },
        id: "duplicate-legacy-guards",
      },
      {
        document: {
          guards: [
            {
              deadline: "2026-08-21T10:10:00.000Z",
              effects: "none",
              generation: 1,
              operationId: "duplicate-operation",
              phase: "executing",
              targetId: "00000000-0000-4000-8000-000000000001",
            },
            {
              deadline: "2026-08-21T11:10:00.000Z",
              effects: "possible",
              generation: 2,
              operationId: "duplicate-operation",
              phase: "reconciliation-required",
              targetId: "00000000-0000-4000-8000-000000000002",
            },
          ],
          kind: "mutation-guards",
          legacyGuards: [],
          schemaVersion: 2,
        },
        id: "duplicate-current-operation-ids",
      },
      {
        document: {
          guards: [
            {
              deadline: "2026-08-21T10:10:00.000Z",
              effects: "none",
              generation: 1,
              operationId: "duplicate-operation",
              phase: "executing",
              targetId: "legacy-target-a",
            },
            {
              deadline: "2026-08-21T11:10:00.000Z",
              effects: "possible",
              generation: 2,
              operationId: "duplicate-operation",
              phase: "reconciliation-required",
              targetId: "legacy-target-b",
            },
          ],
          kind: "mutation-guards",
          schemaVersion: 1,
        },
        id: "duplicate-legacy-operation-ids",
      },
      {
        document: {
          guards: [
            {
              deadline: "2026-08-21T10:10:00.000Z",
              effects: "none",
              generation: 1,
              operationId: "duplicate-operation",
              phase: "executing",
              targetId: "00000000-0000-4000-8000-000000000001",
            },
          ],
          kind: "mutation-guards",
          legacyGuards: [
            {
              deadline: "2026-08-21T11:10:00.000Z",
              effects: "possible",
              generation: 2,
              operationId: "duplicate-operation",
              phase: "reconciliation-required",
              targetId: "legacy-target",
            },
          ],
          schemaVersion: 2,
        },
        id: "duplicate-mixed-operation-ids",
      },
    ] as const;

    for (const { document, id } of cases) {
      const directory = await temporaryDirectory();
      await writeFile(
        join(directory, "mutation-guards.json"),
        JSON.stringify(document),
        "utf8",
      );

      await expect(
        createJsonRecoveryRecords({ directory, id: () => id }).restore(),
      ).resolves.toMatchObject({
        failures: [{ code: "corrupt_store", store: "mutationGuards" }],
        mutationGuards: [],
      });
      expect(await readdir(directory)).toContain(
        `mutation-guards.quarantine-${id}.json`,
      );
    }
  });

  it("keeps current Guards with distinct operation identities and deadlines readable", async () => {
    const directory = await temporaryDirectory();
    const firstTargetId = "00000000-0000-4000-8000-000000000001";
    const secondTargetId = "00000000-0000-4000-8000-000000000002";
    await writeFile(
      join(directory, "target-definitions.json"),
      JSON.stringify({
        kind: "target-definitions",
        schemaVersion: 3,
        targets: [
          {
            connectionReference: null,
            executionBindingDigest: null,
            generation: 1,
            harness: "Codex",
            id: firstTargetId,
            kind: "local",
            label: "First local",
            workspace: "/work/first",
          },
          {
            connectionReference: null,
            executionBindingDigest: null,
            generation: 2,
            harness: "Codex",
            id: secondTargetId,
            kind: "local",
            label: "Second local",
            workspace: "/work/second",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(directory, "mutation-guards.json"),
      JSON.stringify({
        guards: [
          {
            deadline: "2026-08-21T10:10:00.000Z",
            effects: "none",
            generation: 1,
            operationId: "operation-first",
            phase: "executing",
            targetId: firstTargetId,
          },
          {
            deadline: "2026-08-21T11:10:00.000Z",
            effects: "possible",
            generation: 2,
            operationId: "operation-second",
            phase: "reconciliation-required",
            targetId: secondTargetId,
          },
        ],
        kind: "mutation-guards",
        legacyGuards: [],
        schemaVersion: 2,
      }),
      "utf8",
    );

    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "distinct-guard-operations",
      }).restore(),
    ).resolves.toMatchObject({
      failures: [],
      mutationGuards: [
        {
          deadline: "2026-08-21T10:10:00.000Z",
          operationId: "operation-first",
          targetId: firstTargetId,
        },
        {
          deadline: "2026-08-21T11:10:00.000Z",
          operationId: "operation-second",
          targetId: secondTargetId,
        },
      ],
    });
  });

  it("fails closed when current Guards survive without a Target store", async () => {
    const directory = await temporaryDirectory();
    const currentTargetId = "00000000-0000-4000-8000-000000000001";
    await writeFile(
      join(directory, "mutation-guards.json"),
      JSON.stringify({
        guards: [
          {
            deadline: "2026-08-21T10:10:00.000Z",
            effects: "possible",
            generation: 1,
            operationId: "surviving-operation",
            phase: "reconciliation-required",
            targetId: currentTargetId,
          },
        ],
        kind: "mutation-guards",
        legacyGuards: [],
        schemaVersion: 2,
      }),
      "utf8",
    );
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "missing-target-store",
    });

    await expect(records.restore()).resolves.toMatchObject({
      failures: [{ code: "corrupt_store", store: "targetDefinitions" }],
      mutationGuards: [{ targetId: currentTargetId }],
      targetDefinitions: [],
    });
    await expect(
      records.commit({
        targets: [
          {
            connectionReference: null,
            ...targetV4Binding,
            generation: 1,
            id: currentTargetId,
            kind: "local",
            label: "Recovered local",
            workspace: "/work/recovered",
          },
        ],
        type: "targets.replace",
      }),
    ).resolves.toMatchObject({
      error: { code: "persist_failed" },
      ok: false,
    });
  });

  it.each(["temporary-sync", "replace", "directory-sync"] as const)(
    "fails closed when a Guard %s fault prevents confirmed durability",
    async (fault) => {
      const directory = await temporaryDirectory();
      const initial = createJsonRecoveryRecords({
        directory,
        id: () => "initial-guard",
      });
      expect(
        await initial.commit({
          deadline: "2026-08-21T10:10:00.000Z",
          effects: "none",
          generation: 1,
          operationId: "mutation-1",
          phase: "executing",
          targetId: "00000000-0000-4000-8000-000000000001",
          type: "guard.put",
        }),
      ).toEqual({ ok: true, value: undefined });
      const path = join(directory, "mutation-guards.json");
      const beforeFault = await readFile(path, "utf8");
      const records = createJsonRecoveryRecords({
        directory,
        fileSystem: faultingFileSystem(fault),
        id: () => `guard-${fault}`,
        platform: "linux",
      });
      await records.restore();

      expect(
        await records.commit({
          deadline: "2026-08-21T10:20:00.000Z",
          effects: "possible",
          generation: 1,
          operationId: "mutation-2",
          phase: "reconciliation-required",
          targetId: "00000000-0000-4000-8000-000000000001",
          type: "guard.put",
        }),
      ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
      const afterFault = await readFile(path, "utf8");
      expect(() => JSON.parse(afterFault)).not.toThrow();
      if (fault === "directory-sync") {
        expect(JSON.parse(afterFault)).toMatchObject({
          guards: [{ operationId: "mutation-2" }],
        });
      } else expect(afterFault).toBe(beforeFault);
      expect(
        (await readdir(directory)).some((name) => name.endsWith(".tmp")),
      ).toBe(false);
    },
  );

  it("refuses to overwrite a newer Guard schema", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "mutation-guards.json");
    const document = JSON.stringify({
      guards: [],
      kind: "mutation-guards",
      schemaVersion: 99,
    });
    await writeFile(path, document);
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "newer-guard",
    });

    expect((await records.restore()).failures).toContainEqual({
      code: "unsupported_schema",
      store: "mutationGuards",
    });
    expect(
      await records.commit({
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "guard.clear",
      }),
    ).toMatchObject({ error: { code: "unsupported_schema" }, ok: false });
    expect(await readFile(path, "utf8")).toBe(document);
  });

  it("fails closed for unreadable initialized Guard state", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "mutation-guards.json");
    await mkdir(path);
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "unreadable-guard",
    });

    expect((await records.restore()).failures).toContainEqual({
      code: "corrupt_store",
      store: "mutationGuards",
    });
    expect(
      await records.commit({
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "guard.clear",
      }),
    ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
    await expect(
      (await import("node:fs/promises"))
        .stat(path)
        .then((details) => details.isDirectory()),
    ).resolves.toBe(true);
  });

  it.each([
    ["invalid JSON", "{not valid JSON"],
    [
      "invalid schema",
      JSON.stringify({
        guards: "not-an-array",
        kind: "mutation-guards",
        schemaVersion: 2,
      }),
    ],
  ] as const)(
    "keeps quarantined Guard %s fail-closed across restarts",
    async (_name, source) => {
      const directory = await temporaryDirectory();
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "mutation-guards.json"), source, "utf8");
      const records = createJsonRecoveryRecords({
        directory,
        id: () => "corrupt-guards",
      });

      await expect(records.restore()).resolves.toMatchObject({
        failures: [{ code: "corrupt_store", store: "mutationGuards" }],
        mutationGuards: [],
      });
      expect(await readdir(directory)).toContain(
        "mutation-guards.quarantine-corrupt-guards.json",
      );

      const restarted = createJsonRecoveryRecords({
        directory,
        id: () => "corrupt-guards-restart",
      });
      await expect(restarted.restore()).resolves.toMatchObject({
        failures: [{ code: "corrupt_store", store: "mutationGuards" }],
        mutationGuards: [],
      });
      await expect(
        restarted.commit({
          deadline: "2026-08-23T10:00:00.000Z",
          effects: "none",
          generation: 1,
          operationId: "mutation-after-corruption",
          phase: "executing",
          targetId: "00000000-0000-4000-8000-000000000001",
          type: "guard.put",
        }),
      ).resolves.toMatchObject({
        error: { code: "persist_failed" },
        ok: false,
      });
      await expect(
        restarted.commit({
          remainingGuards: [],
          type: "guards.clear-corruption",
        }),
      ).resolves.toEqual({ ok: true, value: undefined });
      await expect(restarted.restore()).resolves.toMatchObject({
        failures: [],
        mutationGuards: [],
      });
      expect(await readdir(directory)).not.toContain(
        "mutation-guards.failure.json",
      );
      await expect(
        restarted.commit({
          deadline: "2026-08-23T10:10:00.000Z",
          effects: "none",
          generation: 1,
          operationId: "mutation-after-recovery",
          phase: "executing",
          targetId: "00000000-0000-4000-8000-000000000001",
          type: "guard.put",
        }),
      ).resolves.toEqual({ ok: true, value: undefined });
    },
  );

  it("does not treat Guard clear as a corruption recovery transition", async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "mutation-guards.json"),
      "{not valid JSON",
      "utf8",
    );
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "guard-clear-is-not-recovery",
    });
    await records.restore();

    await expect(
      records.commit({
        targetId: "00000000-0000-4000-8000-000000000001",
        type: "guard.clear",
      }),
    ).resolves.toMatchObject({
      error: { code: "persist_failed" },
      ok: false,
    });
    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "guard-clear-is-not-recovery-restart",
      }).restore(),
    ).resolves.toMatchObject({
      failures: [{ code: "corrupt_store", store: "mutationGuards" }],
    });
  });

  it("keeps remaining Targets guarded when Guard corruption is explicitly recovered", async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "target-definitions.json"),
      JSON.stringify({
        kind: "target-definitions",
        schemaVersion: 3,
        targets: [
          {
            connectionReference: null,
            executionBindingDigest: null,
            generation: 2,
            harness: "Codex",
            id: "00000000-0000-4000-8000-000000000002",
            kind: "local",
            label: "Remaining local",
            workspace: "/work/remaining",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(directory, "mutation-guards.json"),
      "{not valid JSON",
      "utf8",
    );
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "remaining-guards",
    });
    await records.restore();

    const remaining = {
      ...guardV3Binding,
      deadline: "2026-08-23T18:00:00.000Z",
      effects: "possible" as const,
      generation: 2,
      operationId: "remaining-guard",
      phase: "reconciliation-required" as const,
      targetId: "00000000-0000-4000-8000-000000000002",
    };
    await expect(
      records.commit({
        remainingGuards: [remaining],
        type: "guards.clear-corruption",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });

    const restarted = createJsonRecoveryRecords({
      directory,
      id: () => "remaining-guards-restart",
    });
    await expect(restarted.restore()).resolves.toMatchObject({
      failures: [],
      mutationGuards: [
        {
          deadline: remaining.deadline,
          effects: remaining.effects,
          generation: remaining.generation,
          operationId: remaining.operationId,
          phase: remaining.phase,
          targetId: remaining.targetId,
        },
      ],
    });
  });

  it("refuses Guard corruption recovery when no marker is present", async () => {
    const directory = await temporaryDirectory();
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "no-guard-marker",
    });

    await expect(
      records.commit({
        remainingGuards: [],
        type: "guards.clear-corruption",
      }),
    ).resolves.toMatchObject({
      error: { code: "persist_failed" },
      ok: false,
    });
  });

  it("does not let Guard corruption recovery overwrite a newer schema", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "mutation-guards.json");
    const document = JSON.stringify({
      guards: [],
      kind: "mutation-guards",
      schemaVersion: 99,
    });
    await writeFile(path, document);
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "newer-guard-recovery",
    });
    await records.restore();

    await expect(
      records.commit({
        remainingGuards: [],
        type: "guards.clear-corruption",
      }),
    ).resolves.toMatchObject({
      error: { code: "unsupported_schema" },
      ok: false,
    });
    expect(await readFile(path, "utf8")).toBe(document);
  });

  it("stores exact OpenSSH host trust through the closed durable interface", async () => {
    const directory = await temporaryDirectory();
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "host-trust-write",
    });

    expect(
      await records.commit({
        record: {
          algorithm: "ssh-ed25519",
          identity: "[resolved.internal]:2222",
          key: "AQIDBA==",
        },
        type: "host-trust.replace",
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(await readFile(join(directory, "known_hosts"), "utf8")).toBe(
      "[resolved.internal]:2222 ssh-ed25519 AQIDBA==\n",
    );
    await expect(records.restore()).resolves.toMatchObject({
      failures: [],
      hostTrustRecords: [
        {
          algorithm: "ssh-ed25519",
          identity: "[resolved.internal]:2222",
          key: "AQIDBA==",
        },
      ],
    });
  });

  it("isolates corrupt host trust and refuses to overwrite it", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "known_hosts"), "not an OpenSSH record\n");
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "host-trust-corrupt",
    });

    expect((await records.restore()).failures).toContainEqual({
      code: "corrupt_store",
      store: "hostTrustRecords",
    });
    expect(
      await records.commit({
        record: {
          algorithm: "ssh-ed25519",
          identity: "replacement.internal",
          key: "AQIDBA==",
        },
        type: "host-trust.replace",
      }),
    ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
  });
});

describe("RecoveryRecords Collection Acknowledgement contract", () => {
  const acknowledgement = {
    acknowledgedAt: "2026-08-22T06:00:00.000Z",
    collectionId: "skills-desktop-starter",
    kind: "release" as const,
    manifestDigest: `sha256:${"a".repeat(64)}`,
    releaseNumber: 1,
  };

  it("restores only strict acknowledgement records in memory", async () => {
    const records = createMemoryRecoveryRecords();
    expect(
      await records.commit({
        acknowledgements: [acknowledgement],
        type: "collections.acknowledgements.replace",
      }),
    ).toEqual({ ok: true, value: undefined });
    expect((await records.restore()).collectionAcknowledgements).toEqual([
      acknowledgement,
    ]);

    expect(
      await records.commit({
        acknowledgements: [
          {
            ...acknowledgement,
            plan: "must-not-persist",
          } as unknown as typeof acknowledgement,
        ],
        type: "collections.acknowledgements.replace",
      }),
    ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
  });

  it("keeps acknowledgements in an independent allowlisted JSON document", async () => {
    const directory = await temporaryDirectory();
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "collection-write",
    });
    expect(
      await records.commit({
        acknowledgements: [acknowledgement],
        type: "collections.acknowledgements.replace",
      }),
    ).toEqual({ ok: true, value: undefined });

    const persisted = await readFile(
      join(directory, "collection-acknowledgements.json"),
      "utf8",
    );
    expect(JSON.parse(persisted)).toEqual({
      acknowledgements: [acknowledgement],
      kind: "collection-acknowledgements",
      schemaVersion: 1,
    });
    expect(persisted).not.toMatch(
      /inventory|command|plan|assessment|prepared/i,
    );

    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "collection-restart",
      }).restore(),
    ).resolves.toMatchObject({
      collectionAcknowledgements: [acknowledgement],
    });
  });

  it("quarantines corrupt acknowledgements before accepting a clean replacement", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, "collection-acknowledgements.json"),
      "not json",
    );
    const records = createJsonRecoveryRecords({
      directory,
      id: () => "collection-corrupt",
    });

    await expect(records.restore()).resolves.toMatchObject({
      collectionAcknowledgements: [],
      failures: [
        { code: "corrupt_store", store: "collectionAcknowledgements" },
      ],
    });
    await expect(
      readFile(
        join(
          directory,
          "collection-acknowledgements.quarantine-collection-corrupt.json",
        ),
        "utf8",
      ),
    ).resolves.toBe("not json");
    await expect(
      records.commit({
        acknowledgements: [acknowledgement],
        type: "collections.acknowledgements.replace",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      createJsonRecoveryRecords({
        directory,
        id: () => "collection-recovered",
      }).restore(),
    ).resolves.toMatchObject({
      collectionAcknowledgements: [acknowledgement],
      failures: [],
    });
  });
});
