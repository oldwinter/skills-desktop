import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNodeStudioHost,
  exportStudioSkill,
  readStudioTree,
} from "./node-studio-host.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "studio-host-"));
  roots.push(root);
  return root;
}

const encoder = new TextEncoder();

describe("readStudioTree (ADR 0018)", () => {
  it("reports kinds without following links and reads bounded bytes", async () => {
    const root = await scratch();
    await writeFile(
      join(root, "SKILL.md"),
      "---\nname: a\ndescription: b\n---\n",
    );
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "guide.md"), "# Guide\n");
    await symlink(join(root, "SKILL.md"), join(root, "alias.md"));
    await writeFile(join(root, "shared.txt"), "x");
    await link(join(root, "shared.txt"), join(root, "shared-2.txt"));
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "HEAD"), "ref");

    const tree = await readStudioTree(root);
    expect(tree.ok).toBe(true);
    if (!tree.ok) return;
    const byPath = new Map(tree.value.map((entry) => [entry.path, entry]));
    expect(byPath.get("SKILL.md")).toMatchObject({ kind: "file", size: 31 });
    expect(byPath.get("SKILL.md")?.bytes).toBeInstanceOf(Uint8Array);
    expect(byPath.get("docs")).toMatchObject({ kind: "directory" });
    expect(byPath.get("docs/guide.md")).toMatchObject({ kind: "file" });
    expect(byPath.get("alias.md")).toMatchObject({ kind: "symlink" });
    expect(byPath.get("shared.txt")).toMatchObject({ kind: "hardlink" });
    expect(byPath.get("shared-2.txt")).toMatchObject({ kind: "hardlink" });
    expect(byPath.has(".git")).toBe(false);
    expect(byPath.has(".git/HEAD")).toBe(false);
  });

  it("fails closed on unreadable or non-directory roots", async () => {
    const root = await scratch();
    await writeFile(join(root, "file"), "x");
    expect(await readStudioTree(join(root, "file"))).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
    expect(await readStudioTree(join(root, "missing"))).toMatchObject({
      error: { code: "studio_grant_invalid" },
      ok: false,
    });
  });
});

describe("exportStudioSkill (ADR 0018)", () => {
  const files = [
    {
      bytes: encoder.encode("---\nname: demo\ndescription: d\n---\n"),
      path: "SKILL.md",
    },
    { bytes: encoder.encode("ref"), path: "docs/ref.md" },
  ];

  it("writes a new directory atomically and leaves no temporary tree", async () => {
    const parent = await scratch();
    const result = await exportStudioSkill(parent, "demo", files);
    expect(result).toEqual({ ok: true, value: { fileCount: 2 } });
    expect(await readFile(join(parent, "demo", "docs", "ref.md"), "utf8")).toBe(
      "ref",
    );
    expect(await readdir(parent)).toEqual(["demo"]);
  });

  it("refuses to overwrite an existing destination", async () => {
    const parent = await scratch();
    await mkdir(join(parent, "demo"));
    await writeFile(join(parent, "demo", "keep.txt"), "keep");
    const result = await exportStudioSkill(parent, "demo", files);
    expect(result).toMatchObject({
      error: { code: "studio_export_failed" },
      ok: false,
    });
    expect(await readdir(join(parent, "demo"))).toEqual(["keep.txt"]);
    expect(await readdir(parent)).toEqual(["demo"]);
  });

  it("rejects invalid names and paths before touching the filesystem", async () => {
    const parent = await scratch();
    expect((await exportStudioSkill(parent, "Bad Name", files)).ok).toBe(false);
    expect(
      (
        await exportStudioSkill(parent, "demo", [
          { bytes: new Uint8Array(1), path: "../x" },
        ])
      ).ok,
    ).toBe(false);
    expect(await readdir(parent)).toEqual([]);
  });

  it("removes only its own temporary tree when the parent is not writable", async () => {
    if (process.getuid?.() === 0) return;
    const parent = await scratch();
    await chmod(parent, 0o500);
    try {
      const result = await exportStudioSkill(parent, "demo", files);
      expect(result).toMatchObject({
        error: { code: "studio_export_failed" },
        ok: false,
      });
      expect(await readdir(parent)).toEqual([]);
    } finally {
      await chmod(parent, 0o700);
    }
  });
});

describe("createNodeStudioHost", () => {
  it("canonicalizes the picked folder and returns a label-only pick", async () => {
    const root = await scratch();
    await mkdir(join(root, "real-skill"));
    await symlink(join(root, "real-skill"), join(root, "linked"));
    const showOpenDialog = vi
      .fn()
      .mockResolvedValueOnce({
        canceled: false,
        filePaths: [join(root, "linked")],
      })
      .mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const host = createNodeStudioHost({ dialog: { showOpenDialog } });
    const pick = await host.chooseSkillFolder();
    expect(pick).toMatchObject({ label: "real-skill", status: "picked" });
    if (pick.status === "picked") {
      expect(pick.path.endsWith(join("real-skill"))).toBe(true);
      expect(pick.path.includes("linked")).toBe(false);
    }
    expect(await host.chooseExportParent()).toEqual({ status: "cancelled" });
    expect(showOpenDialog.mock.calls[1]?.[0]).toMatchObject({
      properties: ["openDirectory", "dontAddToRecent", "createDirectory"],
    });
  });
});
