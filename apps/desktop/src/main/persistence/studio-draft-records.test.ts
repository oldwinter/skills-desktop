import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_STUDIO_DRAFTS,
  createJsonStudioDraftRecords,
  createMemoryStudioDraftRecords,
  type StudioDraftRecord,
  type StudioDraftRecords,
} from "./studio-draft-records.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "studio-drafts-"));
  roots.push(root);
  return root;
}

function draft(
  id: string,
  revision = 1,
  skillMd = "---\nname: a\ndescription: b\n---\n",
): StudioDraftRecord {
  return {
    createdAt: "2026-09-15T10:00:00.000Z",
    id,
    name: "a",
    revision,
    schemaVersion: 1,
    skillMd,
    updatedAt: "2026-09-15T10:00:00.000Z",
  };
}

let counter = 0;
const id = () => `id-${(counter += 1)}`;

const implementations: readonly [
  string,
  () => Promise<{ records: StudioDraftRecords; root?: string }>,
][] = [
  ["memory", async () => ({ records: createMemoryStudioDraftRecords() })],
  [
    "json",
    async () => {
      const root = await directory();
      return {
        records: createJsonStudioDraftRecords({ directory: root, id }),
        root,
      };
    },
  ],
];

describe.each(implementations)("StudioDraftRecords (%s)", (_name, make) => {
  it("creates, updates with compare-and-swap, and deletes Drafts", async () => {
    const { records } = await make();
    expect(await records.put(draft("one"), null)).toEqual({
      ok: true,
      value: undefined,
    });
    expect((await records.put(draft("one"), null)).ok).toBe(false);
    expect(await records.put(draft("one", 2), 1)).toEqual({
      ok: true,
      value: undefined,
    });
    const stale = await records.put(draft("one", 3), 1);
    expect(stale).toMatchObject({
      error: { code: "studio_draft_conflict" },
      ok: false,
    });
    expect((await records.delete("one", 1)).ok).toBe(false);
    expect(await records.delete("one", 2)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await records.restore()).toEqual({ drafts: [], failures: [] });
  });

  it("rejects malformed records before writing", async () => {
    const { records } = await make();
    const result = await records.put(
      { ...draft("bad"), name: "Not Valid Because Too Long".repeat(4) },
      null,
    );
    expect(result).toMatchObject({
      error: { code: "studio_draft_invalid" },
      ok: false,
    });
    expect((await records.restore()).drafts).toEqual([]);
  });

  it("caps the number of Drafts", async () => {
    const { records } = await make();
    for (let index = 0; index < MAX_STUDIO_DRAFTS; index += 1) {
      expect((await records.put(draft(`d${index}`), null)).ok).toBe(true);
    }
    expect(await records.put(draft("overflow"), null)).toMatchObject({
      error: { code: "studio_draft_conflict" },
      ok: false,
    });
  });
});

describe("createJsonStudioDraftRecords", () => {
  it("restores each Draft from its own file and quarantines bad ones separately", async () => {
    const root = await directory();
    const records = createJsonStudioDraftRecords({ directory: root, id });
    await records.put(draft("good"), null);
    await writeFile(join(root, "corrupt.json"), "{not json", "utf8");
    await writeFile(
      join(root, "newer.json"),
      JSON.stringify({ ...draft("newer"), schemaVersion: 99 }),
      "utf8",
    );
    await writeFile(
      join(root, "mismatch.json"),
      JSON.stringify(draft("other")),
      "utf8",
    );
    await writeFile(join(root, "ignored.txt"), "x", "utf8");

    const reopened = createJsonStudioDraftRecords({ directory: root, id });
    const restored = await reopened.restore();
    expect(restored.drafts.map(({ id: draftId }) => draftId)).toEqual(["good"]);
    expect(restored.failures).toEqual([
      { draftId: "corrupt", reason: "corrupt" },
      { draftId: "mismatch", reason: "corrupt" },
      { draftId: "newer", reason: "newer-schema" },
    ]);
    const names = (await readdir(root)).sort();
    expect(names.filter((name) => name.includes(".quarantine-"))).toHaveLength(
      3,
    );
    expect(names).toContain("good.json");
    expect(await records.put(draft("good", 2), 1)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      JSON.parse(await readFile(join(root, "good.json"), "utf8")),
    ).toMatchObject({ revision: 2 });
  });

  it("leaves no temporary file behind after a write", async () => {
    const root = await directory();
    const records = createJsonStudioDraftRecords({ directory: root, id });
    await records.put(draft("one"), null);
    await records.put(draft("one", 2), 1);
    expect(
      (await readdir(root)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
});
