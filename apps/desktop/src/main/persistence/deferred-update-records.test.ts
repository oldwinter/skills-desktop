import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createJsonDeferredUpdateRecords } from "./deferred-update-records.js";

const record = {
  candidate: {
    architecture: "x64",
    id: "00000000-0000-4000-8000-000000000025",
    platform: "win32",
    version: "0.2.0",
  },
  downloadedAt: "2026-08-22T06:00:00.000Z",
  runningVersion: "0.1.0",
} as const;

describe("JSON deferred update records", () => {
  it("atomically restores and clears one bounded candidate after a restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-deferred-update-"));
    const path = join(directory, "deferred-update.json");
    try {
      const records = createJsonDeferredUpdateRecords({
        id: () => "write-1",
        path,
      });
      await expect(records.load()).resolves.toBeNull();

      await records.save(record);

      await expect(
        createJsonDeferredUpdateRecords({
          id: () => "restart-write",
          path,
        }).load(),
      ).resolves.toEqual(record);
      await expect(readFile(path, "utf8")).resolves.toBe(
        `${JSON.stringify({ ...record, schemaVersion: 1 }, null, 2)}\n`,
      );
      expect((await readFile(path, "utf8")).length).toBeLessThan(1_024);

      await records.clear();
      await expect(records.load()).resolves.toBeNull();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it.each([
    ["malformed JSON", "{"],
    [
      "an additive feed URL",
      JSON.stringify({
        ...record,
        feedUrl: "https://attacker.invalid/update",
        schemaVersion: 1,
      }),
    ],
    ["a newer schema", JSON.stringify({ ...record, schemaVersion: 2 })],
    [
      "an arbitrary path",
      JSON.stringify({
        ...record,
        outputPath: "/SECRET_PATH/restart",
        schemaVersion: 1,
      }),
    ],
  ])("rejects %s without replacing it", async (_name, source) => {
    const directory = await mkdtemp(join(tmpdir(), "skills-deferred-update-"));
    const path = join(directory, "deferred-update.json");
    try {
      await writeFile(path, source, "utf8");
      await expect(
        createJsonDeferredUpdateRecords({ id: () => "unused", path }).load(),
      ).rejects.toThrow();
      await expect(readFile(path, "utf8")).resolves.toBe(source);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
