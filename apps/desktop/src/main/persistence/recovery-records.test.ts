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
    targetId: "local-target",
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
          declaredSource: { source: "example/skills", sourceType: "github" },
          name: "tdd",
          scope: "project",
        },
      ],
      generation: 3,
      observedAt: "2026-08-21T10:00:00.000Z",
      targetId: "local-target",
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
      if (
        fault === "replace" &&
        destination.endsWith(".json")
      ) {
        return Promise.reject(new Error("replacement fault"));
      }
      return delegate.rename(source, destination);
    },
  };
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
            target: "local-target",
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
      targetId: "local-target",
    });
    expect(
      JSON.parse(
        await readFile(join(directory, "inventory-snapshots.json"), "utf8"),
      ),
    ).toMatchObject({
      kind: "inventory-snapshots",
      schemaVersion: 2,
    });
    expect(
      await readFile(
        join(directory, "inventory-snapshots.json.v1.backup"),
        "utf8",
      ),
    ).toContain('"schemaVersion":1');
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
        targetId: "local-target",
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
        targetId: "local-target",
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
      targetId: "local-target",
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
          targetId: "local-target",
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
        targetId: "local-target",
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
        targetId: "local-target",
        type: "inventory.replace",
      }),
      records.commit({
        generation: 2,
        inventory: { ...inventory, observedAt: "2026-08-21T11:00:00.000Z" },
        targetId: "local-target",
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
        targetId: "local-target",
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
    expect(
      (await import("node:fs/promises"))
        .stat(path)
        .then((details) => details.isDirectory()),
    ).resolves.toBe(true);
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
        phase: "executing",
        targetId: "local-target",
        type: "guard.put",
      }),
    ).toEqual({ ok: true, value: undefined });
    expect((await records.restore()).mutationGuards).toEqual([
      {
        deadline: "2026-08-21T10:10:00.000Z",
        effects: "none",
        generation: 3,
        operationId: "mutation-1",
        phase: "executing",
        targetId: "local-target",
      },
    ]);

    expect(
      await records.commit({ targetId: "local-target", type: "guard.clear" }),
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
        targetId: "local-target",
        type: "guard.put",
      }),
    ).toEqual({ ok: true, value: undefined });

    const persisted = await readFile(
      join(directory, "mutation-guards.json"),
      "utf8",
    );
    expect(JSON.parse(persisted)).toEqual({
      guards: [
        {
          deadline: "2026-08-21T10:10:00.000Z",
          effects: "possible",
          generation: 3,
          operationId: "mutation-1",
          phase: "reconciliation-required",
          targetId: "local-target",
        },
      ],
      kind: "mutation-guards",
      schemaVersion: 1,
    });
    expect(persisted).not.toContain("skill");
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
          targetId: "local-target",
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
          targetId: "local-target",
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
      await records.commit({ targetId: "local-target", type: "guard.clear" }),
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
      await records.commit({ targetId: "local-target", type: "guard.clear" }),
    ).toMatchObject({ error: { code: "persist_failed" }, ok: false });
    expect(
      (await import("node:fs/promises"))
        .stat(path)
        .then((details) => details.isDirectory()),
    ).resolves.toBe(true);
  });
});
