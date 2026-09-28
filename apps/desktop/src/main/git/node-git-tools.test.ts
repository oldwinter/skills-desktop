import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createNodePublicationWorkspace,
  createSpawnGitRunner,
  sha256Hex,
} from "./node-git-tools.js";

const SUITE_TIMEOUT_MS = 20_000;

describe("createSpawnGitRunner", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("returns the failed outcome when the child exits before reading large stdin", async () => {
    const runner = createSpawnGitRunner({ gitExecutable: process.execPath });

    await expect(
      runner.run({
        args: [
          "-e",
          'process.stderr.write("early exit"); process.exitCode = 23;',
        ],
        cwd: process.cwd(),
        env: {},
        stdin: new Uint8Array(8 * 1_024 * 1_024),
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({
      exitCode: 23,
      stderr: "early exit",
      stdout: "",
    });
  });

  it("returns stdout, stderr, and the exit code from a finished child", async () => {
    const runner = createSpawnGitRunner({ gitExecutable: process.execPath });

    await expect(
      runner.run({
        args: [
          "-e",
          'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 7;',
        ],
        cwd: process.cwd(),
        env: {},
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({ exitCode: 7, stderr: "err", stdout: "out" });
  });

  it("rejects when the Git executable cannot be found", async () => {
    const runner = createSpawnGitRunner({
      gitExecutable: join(tmpdir(), "skills-desktop-missing-git-executable"),
    });

    await expect(
      runner.run({
        args: ["status"],
        cwd: process.cwd(),
        env: {},
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("System Git was not found on PATH.");
  });

  it.skipIf(process.platform === "win32")(
    "rejects with the raw spawn failure when the executable cannot start",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "skills-git-eacces-"));
      try {
        const blocked = join(directory, "git");
        await writeFile(blocked, "not an executable\n", { mode: 0o644 });
        const runner = createSpawnGitRunner({ gitExecutable: blocked });

        const failure = await runner
          .run({
            args: ["status"],
            cwd: directory,
            env: {},
            timeoutMs: 5_000,
          })
          .catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).not.toContain(
          "System Git was not found",
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  it("settles a bounded timeout outcome instead of hanging on a stuck child", async () => {
    const runner = createSpawnGitRunner({ gitExecutable: process.execPath });

    await expect(
      runner.run({
        args: ["-e", "setInterval(() => undefined, 1000)"],
        cwd: process.cwd(),
        env: {},
        timeoutMs: 100,
      }),
    ).resolves.toEqual({
      exitCode: 124,
      stderr: "Git did not finish within the publication time limit.",
      stdout: "",
    });
  });

  it("settles a bounded outcome when output exceeds the publication cap", async () => {
    const runner = createSpawnGitRunner({ gitExecutable: process.execPath });

    await expect(
      runner.run({
        args: [
          "-e",
          `process.stdout.write("x".repeat(${5 * 1_024 * 1_024}));`,
        ],
        cwd: process.cwd(),
        env: {},
        timeoutMs: 20_000,
      }),
    ).resolves.toEqual({
      exitCode: 125,
      stderr: "Git produced more output than publication accepts.",
      stdout: "",
    });
  });
});

describe("createNodePublicationWorkspace", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("creates a private root under the configured base and resolves joins", async () => {
    const base = await mkdtemp(join(tmpdir(), "skills-workspace-base-"));
    try {
      const workspace = createNodePublicationWorkspace({ baseDirectory: base });
      const root = await workspace.create();
      expect(root.startsWith(`${await realpath(base)}/`)).toBe(true);
      expect(basename(root).startsWith("skills-desktop-publication-")).toBe(
        true,
      );
      const info = await stat(root);
      expect(info.isDirectory()).toBe(true);
      if (process.platform !== "win32") {
        expect(info.mode & 0o777).toBe(0o700);
      }
      expect(workspace.join(root, "managed", "file")).toBe(
        join(root, "managed", "file"),
      );
      await workspace.remove(root);
      expect(existsSync(root)).toBe(false);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it("writes empty private files and refuses a second write at the same path", async () => {
    const base = await mkdtemp(join(tmpdir(), "skills-workspace-base-"));
    const workspace = createNodePublicationWorkspace({ baseDirectory: base });
    const root = await workspace.create();
    try {
      const target = join(root, "digest.txt");
      await workspace.writeEmptyFile(target);
      expect(await readFile(target)).toHaveLength(0);
      if (process.platform !== "win32") {
        expect((await stat(target)).mode & 0o777).toBe(0o600);
      }
      await expect(workspace.writeEmptyFile(target)).rejects.toMatchObject({
        code: "EEXIST",
      });
    } finally {
      await workspace.remove(root);
      await rm(base, { force: true, recursive: true });
    }
  });

  it("refuses every write and mkdir outside its own temporary root", async () => {
    const base = await mkdtemp(join(tmpdir(), "skills-workspace-base-"));
    const workspace = createNodePublicationWorkspace({ baseDirectory: base });
    const root = await workspace.create();
    const outside = join(base, "sibling");
    try {
      await expect(workspace.writeEmptyFile(outside)).rejects.toThrow(
        "Publication may only write inside its own temporary root.",
      );
      await expect(workspace.makeDirectory(outside)).rejects.toThrow(
        "Publication may only write inside its own temporary root.",
      );
      await expect(
        workspace.makeDirectory(join(root, "..", "..", "escape")),
      ).rejects.toThrow(
        "Publication may only write inside its own temporary root.",
      );
      await workspace.makeDirectory(join(root, "managed"));
      expect((await stat(join(root, "managed"))).isDirectory()).toBe(true);
    } finally {
      await workspace.remove(root);
      await rm(base, { force: true, recursive: true });
    }
  });

  it("removes only roots it created and leaves unowned paths untouched", async () => {
    const base = await mkdtemp(join(tmpdir(), "skills-workspace-base-"));
    const workspace = createNodePublicationWorkspace({ baseDirectory: base });
    const root = await workspace.create();
    const unowned = await mkdtemp(join(tmpdir(), "skills-unowned-"));
    const keep = join(unowned, "keep.txt");
    await writeFile(keep, "keep", "utf8");
    try {
      await workspace.remove(unowned);
      expect(await readFile(keep, "utf8")).toBe("keep");
      await workspace.remove(root);
      expect(existsSync(root)).toBe(false);
      // A second remove of the same root is a no-op, not an error.
      await expect(workspace.remove(root)).resolves.toBeUndefined();
    } finally {
      await rm(base, { force: true, recursive: true });
      await rm(unowned, { force: true, recursive: true });
    }
  });
});

describe("sha256Hex", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("digests bytes deterministically", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
