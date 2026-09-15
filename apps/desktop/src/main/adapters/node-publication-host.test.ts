import {
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

import { afterEach, describe, expect, it } from "vitest";

import { exportWellKnownTree } from "@skills-desktop/skills-runtime";

import { createNodeWellKnownCodec } from "./node-well-known-codec.js";
import {
  createNodePublicationHost,
  readSkillFolder,
  writeExportTree,
} from "./node-publication-host.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skills-desktop-pub-"));
  roots.push(root);
  return root;
}

async function seedSkills(root: string): Promise<void> {
  await mkdir(join(root, "hello"), { recursive: true });
  await writeFile(
    join(root, "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Says hello.\n---\n# Hello\n",
  );
  await mkdir(join(root, "with-assets", "assets"), { recursive: true });
  await writeFile(
    join(root, "with-assets", "SKILL.md"),
    "---\nname: with-assets\ndescription: Has assets.\n---\n",
  );
  await writeFile(join(root, "with-assets", "assets", "a.txt"), "a\n");
  await writeFile(join(root, "README.md"), "not a skill\n");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "no-skill-md"), { recursive: true });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("node publication host (ADR 0019)", () => {
  it("reads only Skill directories with SKILL.md and skips dot-entries", async () => {
    const root = await tempRoot();
    await seedSkills(root);
    const result = await readSkillFolder(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map(({ name }) => name).sort()).toEqual([
      "hello",
      "with-assets",
    ]);
    const withAssets = result.value.find(({ name }) => name === "with-assets");
    expect(withAssets?.files.map(({ path }) => path).sort()).toEqual([
      "SKILL.md",
      "assets/a.txt",
    ]);
    const exported = exportWellKnownTree(
      result.value,
      createNodeWellKnownCodec(),
    );
    expect(exported.ok).toBe(true);
  });

  it("refuses symbolic links inside a Skill", async () => {
    const root = await tempRoot();
    await seedSkills(root);
    await symlink(join(root, "README.md"), join(root, "hello", "link.md"));
    const result = await readSkillFolder(root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("export_invalid");
      expect(result.error.message).toContain("symbolic link");
    }
  });

  it("fails closed for a folder without Skills or an unreadable folder", async () => {
    const root = await tempRoot();
    const empty = await readSkillFolder(root);
    expect(empty.ok).toBe(false);
    const missing = await readSkillFolder(join(root, "missing"));
    expect(missing.ok).toBe(false);
  });

  it("writes the exact export into a new folder and refuses a non-empty one", async () => {
    const root = await tempRoot();
    await seedSkills(root);
    const skills = await readSkillFolder(root);
    if (!skills.ok) throw new Error("skills expected");
    const exported = exportWellKnownTree(
      skills.value,
      createNodeWellKnownCodec(),
    );
    if (!exported.ok) throw new Error("export expected");
    const destination = join(root, "out", "nested");
    expect((await writeExportTree(destination, exported.value.files)).ok).toBe(
      true,
    );
    for (const file of exported.value.files) {
      const written = await readFile(
        join(destination, ...file.path.split("/")),
      );
      expect(new Uint8Array(written)).toEqual(file.bytes);
    }
    expect(await readdir(join(destination, ".well-known"))).toEqual([
      "agent-skills",
    ]);
    const again = await writeExportTree(destination, exported.value.files);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain("empty folder");
  });

  it("maps native dialogs to labels only", async () => {
    const calls: unknown[] = [];
    const host = createNodePublicationHost({
      dialog: {
        showOpenDialog: async (options: unknown) => {
          calls.push(options);
          return { canceled: false, filePaths: ["/home/me/My Skills"] };
        },
      } as never,
    });
    expect(await host.chooseSourceFolder()).toEqual({
      label: "My Skills",
      path: "/home/me/My Skills",
      status: "picked",
    });
    expect(await host.chooseExportDestination()).toMatchObject({
      label: "My Skills",
      status: "picked",
    });
    expect(calls[0]).toMatchObject({
      properties: ["openDirectory", "dontAddToRecent"],
    });
    expect(calls[1]).toMatchObject({
      properties: ["openDirectory", "dontAddToRecent", "createDirectory"],
    });
    const cancelled = createNodePublicationHost({
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      } as never,
    });
    expect(await cancelled.chooseSourceFolder()).toEqual({
      status: "cancelled",
    });
  });
});
