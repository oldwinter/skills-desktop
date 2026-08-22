import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createJsonUpdateCheckRecords } from "./update-check-records.js";

describe("JSON update check records", () => {
  it("restores the last recorded check from a strict version 1 document", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-update-check-"));
    const path = join(directory, "update-check.json");
    try {
      const records = createJsonUpdateCheckRecords({ path });
      await expect(records.load()).resolves.toBeNull();

      await records.save("2026-08-22T06:00:00.000Z");

      await expect(
        createJsonUpdateCheckRecords({ path }).load(),
      ).resolves.toBe("2026-08-22T06:00:00.000Z");
      await expect(readFile(path, "utf8")).resolves.toBe(
        '{\n  "lastCheckAt": "2026-08-22T06:00:00.000Z",\n  "schemaVersion": 1\n}\n',
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it.each([
    ["malformed JSON", "{"],
    [
      "an invalid timestamp",
      '{"lastCheckAt":"not-a-date","schemaVersion":1}',
    ],
    [
      "an additive field",
      '{"lastCheckAt":"2026-08-22T06:00:00.000Z","schemaVersion":1,"feedUrl":"https://example.invalid"}',
    ],
    [
      "a newer schema version",
      '{"lastCheckAt":"2026-08-22T06:00:00.000Z","schemaVersion":2}',
    ],
  ])("rejects %s", async (_caseName, source) => {
    const directory = await mkdtemp(join(tmpdir(), "skills-update-check-"));
    const path = join(directory, "update-check.json");
    try {
      await writeFile(path, source, "utf8");
      await expect(
        createJsonUpdateCheckRecords({ path }).load(),
      ).rejects.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
