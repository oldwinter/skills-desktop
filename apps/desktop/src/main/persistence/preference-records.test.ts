import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createJsonPreferenceRecords } from "./preference-records.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), "skills-desktop-prefs-"));
  directories.push(directory);
  return directory;
}

describe("createJsonPreferenceRecords", () => {
  it("reports an absent record before the first save and round-trips saves", async () => {
    const directory = await scratch();
    let counter = 0;
    const records = createJsonPreferenceRecords({
      id: () => `id-${(counter += 1)}`,
      path: join(directory, "preferences.json"),
    });
    expect(await records.load()).toEqual({ status: "absent" });
    await records.save({ appearance: "dark", localePreference: "zh-CN" });
    expect(await records.load()).toEqual({
      status: "loaded",
      value: { appearance: "dark", localePreference: "zh-CN" },
    });
    const document: unknown = JSON.parse(
      await readFile(join(directory, "preferences.json"), "utf8"),
    );
    expect(document).toEqual({
      kind: "preferences",
      preferences: { appearance: "dark", localePreference: "zh-CN" },
      schemaVersion: 1,
    });
    expect(await readdir(directory)).toEqual(["preferences.json"]);
  });

  it("quarantines invalid JSON, schema mismatches, and newer schemas instead of resetting", async () => {
    const directory = await scratch();
    const path = join(directory, "preferences.json");
    let counter = 0;
    const records = createJsonPreferenceRecords({
      id: () => `q${(counter += 1)}`,
      path,
    });

    await writeFile(path, "{ not json");
    expect(await records.load()).toMatchObject({ status: "quarantined" });
    expect(await readdir(directory)).toEqual(["preferences.json.corrupt.q1"]);

    await writeFile(
      path,
      JSON.stringify({
        kind: "preferences",
        preferences: { appearance: "sepia", localePreference: "system" },
        schemaVersion: 1,
      }),
    );
    expect(await records.load()).toMatchObject({
      reason: expect.stringContaining("schema"),
      status: "quarantined",
    });

    await writeFile(
      path,
      JSON.stringify({ kind: "preferences", preferences: {}, schemaVersion: 2 }),
    );
    expect(await records.load()).toMatchObject({
      reason: expect.stringContaining("newer schema"),
      status: "quarantined",
    });
    expect((await readdir(directory)).sort()).toEqual([
      "preferences.json.corrupt.q1",
      "preferences.json.corrupt.q2",
      "preferences.json.corrupt.q3",
    ]);
    expect(await records.load()).toEqual({ status: "absent" });
  });

  it("rejects an invalid stored value at save time", async () => {
    const directory = await scratch();
    const records = createJsonPreferenceRecords({
      id: () => "w",
      path: join(directory, "preferences.json"),
    });
    await expect(
      records.save({
        appearance: "neon",
        localePreference: "system",
      } as never),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
});
