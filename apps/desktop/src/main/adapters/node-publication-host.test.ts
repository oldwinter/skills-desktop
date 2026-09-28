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
import { createServer } from "node:net";
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

  it("refuses a file hard-linked to content outside the chosen folder", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await seedSkills(root);
    const before = await readSkillFolder(root);
    expect(before.ok).toBe(true);
    await writeFile(join(outside, "private.txt"), "fixture-private-content");
    await link(
      join(outside, "private.txt"),
      join(root, "hello", "linked.txt"),
    );
    const result = await readSkillFolder(root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("export_invalid");
      expect(result.error.message).toContain("hard link");
      expect(result.error.message).toContain("linked.txt");
    }
  });

  it("refuses a Skill whose SKILL.md is hard-linked elsewhere", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await seedSkills(root);
    await link(join(root, "hello", "SKILL.md"), join(outside, "SKILL.md"));
    const result = await readSkillFolder(root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("export_invalid");
      expect(result.error.message).toContain("hard link");
    }
  });

  it("fails closed for a folder without Skills or an unreadable folder", async () => {
    const root = await tempRoot();
    const empty = await readSkillFolder(root);
    expect(empty.ok).toBe(false);
    const missing = await readSkillFolder(join(root, "missing"));
    expect(missing.ok).toBe(false);
  });

  it("returns export_invalid when a nested Skill directory cannot be read", async () => {
    // Directory mode bits do not restrict root, and Windows ignores them.
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const root = await tempRoot();
    await seedSkills(root);
    const denied = join(root, "with-assets", "assets");
    await chmod(denied, 0o000);
    try {
      const result = await readSkillFolder(root);
      expect(result).toMatchObject({
        error: { code: "export_invalid" },
        ok: false,
      });
      if (!result.ok) expect(result.error.message).not.toContain(root);
    } finally {
      await chmod(denied, 0o700);
    }
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

  it("refuses archive-unsupported paths, special files, and over-limit content", async () => {
    // A backslashed name is legal POSIX but not a valid archive path; on
    // Windows "\" is a separator, so no creatable name can carry one.
    if (process.platform !== "win32") {
      const backslash = await tempRoot();
      await seedSkills(backslash);
      await writeFile(join(backslash, "hello", "bad\\name.md"), "x\n");
      const badPath = await readSkillFolder(backslash);
      expect(badPath.ok).toBe(false);
      if (!badPath.ok) {
        expect(badPath.error.code).toBe("export_invalid");
        expect(badPath.error.message).toContain("unsupported path");
      }
    }

    // A unix socket inside a Skill is a special file, not content.
    const withSocket = await tempRoot();
    await seedSkills(withSocket);
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(join(withSocket, "hello", "listener.sock"), resolve);
      });
      const special = await readSkillFolder(withSocket);
      expect(special.ok).toBe(false);
      if (!special.ok) {
        expect(special.error.code).toBe("export_invalid");
        expect(special.error.message).toContain("special file");
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    // A file past the per-file byte bound is refused before reading.
    const oversized = await tempRoot();
    await seedSkills(oversized);
    const big = Buffer.alloc(4 * 1_024 * 1_024 + 1, 0x41);
    await writeFile(join(oversized, "hello", "big.bin"), big);
    const tooBig = await readSkillFolder(oversized);
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) {
      expect(tooBig.error.code).toBe("export_invalid");
      expect(tooBig.error.message).toContain("big.bin");
    }

    // More files than the per-skill bound is refused.
    const many = await tempRoot();
    await seedSkills(many);
    for (let index = 0; index < 256; index += 1) {
      await writeFile(join(many, "hello", `f${index}.txt`), "x");
    }
    const tooMany = await readSkillFolder(many);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.error.code).toBe("export_invalid");
      expect(tooMany.error.message).toContain("256 files");
    }
  });

  it("refuses a folder carrying more Skills than the bound", async () => {
    const root = await tempRoot();
    for (let index = 0; index < 129; index += 1) {
      const name = `skill-${String(index).padStart(3, "0")}`;
      await mkdir(join(root, name));
      await writeFile(
        join(root, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: x\n---\n`,
      );
    }
    const result = await readSkillFolder(root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("export_invalid");
      expect(result.error.message).toContain("128 Skills");
    }
  });

  it("fails closed when the export destination cannot be created", async () => {
    const root = await tempRoot();
    await seedSkills(root);
    const skills = await readSkillFolder(root);
    if (!skills.ok) throw new Error("skills expected");
    const exported = exportWellKnownTree(
      skills.value,
      createNodeWellKnownCodec(),
    );
    if (!exported.ok) throw new Error("export expected");

    // A regular file at the destination path cannot become a directory.
    const blocked = join(root, "blocked");
    await writeFile(blocked, "not a directory");
    const result = await writeExportTree(blocked, exported.value.files);
    expect(result).toMatchObject({
      error: {
        code: "export_invalid",
        message: expect.stringContaining("could not be written"),
      },
      ok: false,
    });
  });
});
