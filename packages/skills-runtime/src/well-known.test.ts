import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  buildDeterministicTar,
  crc32,
  encodeWellKnownIndex,
  exportWellKnownTree,
  isValidArchivePath,
  isValidSkillName,
  readSkillFrontmatter,
  WELL_KNOWN_EXPORT_PROFILE,
  wrapGzip,
  type WellKnownCodec,
  type WellKnownSkillInput,
} from "./well-known.js";

const codec: WellKnownCodec = {
  deflateRaw: (bytes) => new Uint8Array(deflateRawSync(bytes, { level: 9 })),
  sha256Hex: (bytes) => createHash("sha256").update(bytes).digest("hex"),
};

const text = (value: string) => new TextEncoder().encode(value);

const skillMd = (name: string, description: string) =>
  text(`---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`);

const simple: WellKnownSkillInput = {
  files: [{ bytes: skillMd("git-workflow", "Follow Git conventions."), path: "SKILL.md" }],
  name: "git-workflow",
};

const bundled: WellKnownSkillInput = {
  files: [
    { bytes: text("#!/bin/sh\necho deploy\n"), path: "scripts/deploy.sh" },
    { bytes: skillMd("wrangler", "Deploy Workers projects."), path: "SKILL.md" },
    { bytes: text("# Forms\n"), path: "references/FORMS.md" },
  ],
  name: "wrangler",
};

function tarEntries(archive: Uint8Array) {
  const entries: Array<{
    gid: string;
    mode: string;
    mtime: string;
    name: string;
    prefix: string;
    size: number;
    uid: string;
    uname: string;
  }> = [];
  const ascii = (start: number, length: number) =>
    new TextDecoder().decode(archive.subarray(start, start + length)).replace(/\0.*$/s, "");
  let offset = 0;
  while (offset + 512 <= archive.length && archive[offset] !== 0) {
    const size = Number.parseInt(ascii(offset + 124, 12), 8);
    entries.push({
      gid: ascii(offset + 116, 8),
      mode: ascii(offset + 100, 8),
      mtime: ascii(offset + 136, 12),
      name: ascii(offset, 100),
      prefix: ascii(offset + 345, 155),
      size,
      uid: ascii(offset + 108, 8),
      uname: ascii(offset + 265, 32),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

describe("well-known export profile", () => {
  it("pins discovery 0.2.0 and validates names and paths", () => {
    expect(WELL_KNOWN_EXPORT_PROFILE).toEqual({
      archiveDirectory: "artifacts",
      discoveryVersion: "0.2.0",
      exporterVersion: 1,
      indexPath: ".well-known/agent-skills/index.json",
      rootDirectory: ".well-known/agent-skills",
      schemaUri: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    });
    expect(isValidSkillName("code-review")).toBe(true);
    expect(isValidSkillName("Code-Review")).toBe(false);
    expect(isValidSkillName("-code")).toBe(false);
    expect(isValidSkillName("code--review")).toBe(false);
    expect(isValidSkillName("a".repeat(65))).toBe(false);
    expect(isValidArchivePath("scripts/deploy.sh")).toBe(true);
    expect(isValidArchivePath("../SKILL.md")).toBe(false);
    expect(isValidArchivePath("/etc/passwd")).toBe(false);
    expect(isValidArchivePath("a//b")).toBe(false);
    expect(isValidArchivePath("dir/")).toBe(false);
    expect(isValidArchivePath("with space.md")).toBe(false);
    expect(isValidArchivePath("back\\slash")).toBe(false);
    expect(isValidArchivePath(`${"a".repeat(256)}`)).toBe(false);
  });

  it("reads the single-line frontmatter subset and fails closed otherwise", () => {
    expect(readSkillFrontmatter(skillMd("x", "Does x."))).toEqual({
      ok: true,
      value: { description: "Does x.", name: "x" },
    });
    expect(
      readSkillFrontmatter(text("---\r\nname: crlf\r\ndescription: 'ok'\r\n---\r\n")),
    ).toMatchObject({ ok: true, value: { description: "ok", name: "crlf" } });
    expect(readSkillFrontmatter(text("# no frontmatter\n"))).toMatchObject({
      error: { code: "invalid_frontmatter" },
      ok: false,
    });
    expect(readSkillFrontmatter(text("---\nname: x\n"))).toMatchObject({
      error: { code: "invalid_frontmatter" },
      ok: false,
    });
    expect(readSkillFrontmatter(text("---\nname: x\n---\n"))).toMatchObject({
      error: { code: "invalid_frontmatter" },
      ok: false,
    });
    expect(readSkillFrontmatter(new Uint8Array([0xff, 0xfe, 0x2d]))).toMatchObject({
      error: { code: "invalid_frontmatter", message: "SKILL.md is not valid UTF-8." },
      ok: false,
    });
  });

  it("builds ustar archives with sorted paths and zeroed host metadata", () => {
    const archive = buildDeterministicTar(bundled.files);
    expect(archive.length % 10_240).toBe(0);
    const entries = tarEntries(archive);
    expect(entries.map(({ name }) => name)).toEqual([
      "SKILL.md",
      "references/FORMS.md",
      "scripts/deploy.sh",
    ]);
    for (const entry of entries) {
      expect(entry.mode).toBe("0000644");
      expect(entry.uid).toBe("0000000");
      expect(entry.gid).toBe("0000000");
      expect(entry.mtime).toBe("00000000000");
      expect(entry.uname).toBe("");
      expect(entry.prefix).toBe("");
    }
    const longDirectory = `${"d".repeat(120)}/${"f".repeat(40)}.md`;
    const [long] = tarEntries(
      buildDeterministicTar([{ bytes: text("x"), path: longDirectory }]),
    );
    expect(long).toMatchObject({
      name: `${"f".repeat(40)}.md`,
      prefix: "d".repeat(120),
    });
    expect(() =>
      buildDeterministicTar([{ bytes: text("x"), path: "e".repeat(200) }]),
    ).toThrow(/not representable/);
  });

  it("frames gzip with a zero timestamp and unix OS byte and round-trips", () => {
    const tar = buildDeterministicTar(bundled.files);
    const gz = wrapGzip(tar, codec.deflateRaw(tar));
    expect([...gz.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]);
    expect(new Uint8Array(gunzipSync(gz))).toEqual(tar);
    expect(crc32(text("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("exports byte-identical trees regardless of input order (#206)", () => {
    const first = exportWellKnownTree([bundled, simple], codec);
    const second = exportWellKnownTree([simple, bundled], codec);
    if (!first.ok || !second.ok) throw new Error("expected exports");
    expect(first.value.files.map(({ path }) => path)).toEqual([
      ".well-known/agent-skills/artifacts/wrangler.tar.gz",
      ".well-known/agent-skills/git-workflow/SKILL.md",
      ".well-known/agent-skills/index.json",
    ]);
    expect(first.value.treeDigest).toBe(second.value.treeDigest);
    expect(first.value.treeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const [index, file] of first.value.files.entries()) {
      expect(Buffer.from(file.bytes).equals(Buffer.from(second.value.files[index]!.bytes))).toBe(true);
    }
    const indexFile = first.value.files.find(({ path }) => path.endsWith("index.json"))!;
    const indexText = new TextDecoder().decode(indexFile.bytes);
    expect(indexText.endsWith("}\n")).toBe(true);
    expect(indexText).not.toContain("\r");
    const [gitEntry, wranglerEntry] = first.value.index.skills;
    expect(Object.keys(gitEntry!)).toEqual(["name", "type", "description", "url", "digest"]);
    expect(gitEntry).toMatchObject({
      description: "Follow Git conventions.",
      name: "git-workflow",
      type: "skill-md",
      url: "./git-workflow/SKILL.md",
    });
    expect(wranglerEntry).toMatchObject({
      name: "wrangler",
      type: "archive",
      url: "./artifacts/wrangler.tar.gz",
    });
    expect(indexText.startsWith(`{\n  "$schema": "${WELL_KNOWN_EXPORT_PROFILE.schemaUri}",\n  "skills": [\n`)).toBe(true);
    for (const entry of first.value.index.skills) {
      const artifact = first.value.files.find(
        ({ path }) => path === `.well-known/agent-skills/${entry.url.slice(2)}`,
      )!;
      expect(entry.digest).toBe(`sha256:${codec.sha256Hex(artifact.bytes)}`);
    }
    expect(new TextDecoder().decode(encodeWellKnownIndex(first.value.index))).toBe(indexText);
  });

  it("changes digests when any artifact byte changes", () => {
    const base = exportWellKnownTree([simple], codec);
    const edited = exportWellKnownTree(
      [{ ...simple, files: [{ bytes: skillMd("git-workflow", "Follow Git conventions!"), path: "SKILL.md" }] }],
      codec,
    );
    if (!base.ok || !edited.ok) throw new Error("expected exports");
    expect(base.value.treeDigest).not.toBe(edited.value.treeDigest);
    expect(base.value.index.skills[0]!.digest).not.toBe(edited.value.index.skills[0]!.digest);
  });

  it("is readable by a real tar implementation", () => {
    const exported = exportWellKnownTree([bundled], codec);
    if (!exported.ok) throw new Error("expected export");
    const archive = exported.value.files.find(({ path }) => path.endsWith(".tar.gz"))!;
    const directory = mkdtempSync(join(tmpdir(), "well-known-"));
    const archivePath = join(directory, "wrangler.tar.gz");
    writeFileSync(archivePath, archive.bytes);
    const listing = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
    expect(listing.trim().split("\n")).toEqual([
      "SKILL.md",
      "references/FORMS.md",
      "scripts/deploy.sh",
    ]);
  });

  it("fails closed on invalid input before writing anything", () => {
    const codes = (skills: WellKnownSkillInput[]) => {
      const result = exportWellKnownTree(skills, codec);
      return result.ok ? "ok" : `${result.error.code}:${result.error.skillName ?? ""}:${result.error.path ?? ""}`;
    };
    expect(codes([])).toBe("empty_export::");
    expect(codes([{ ...simple, name: "Git" }])).toBe("invalid_skill_name:Git:");
    expect(codes([simple, simple])).toBe("duplicate_skill:git-workflow:");
    expect(codes([{ files: [], name: "empty" }])).toBe("missing_skill_md:empty:");
    expect(
      codes([{ files: [{ bytes: text("x"), path: "README.md" }], name: "no-skill" }]),
    ).toBe("missing_skill_md:no-skill:");
    expect(
      codes([{ ...simple, files: [...simple.files, { bytes: text("x"), path: "../escape" }] }]),
    ).toBe("invalid_path:git-workflow:../escape");
    expect(
      codes([{ ...simple, files: [...simple.files, { bytes: text("x"), path: "skill.md" }] }]),
    ).toBe("invalid_path:git-workflow:skill.md");
    expect(
      codes([{ files: [{ bytes: skillMd("other", "Mismatch."), path: "SKILL.md" }], name: "mine" }]),
    ).toBe("invalid_frontmatter:mine:SKILL.md");
    expect(
      codes([{ files: [{ bytes: text("no frontmatter"), path: "SKILL.md" }], name: "mine" }]),
    ).toBe("invalid_frontmatter:mine:SKILL.md");
    expect(
      codes([{ ...simple, files: [...simple.files, { bytes: new Uint8Array(4 * 1_024 * 1_024 + 1), path: "big.bin" }] }]),
    ).toBe("too_large:git-workflow:big.bin");
    expect(
      codes([{ ...simple, files: [...simple.files, ...Array.from({ length: 256 }, (_, index) => ({ bytes: text("x"), path: `f${index}.md` }))] }]),
    ).toBe("too_many_files:git-workflow:");
    expect(codes(Array.from({ length: 129 }, (_, index) => ({ ...simple, name: `s${index}` })))).toBe(
      "too_many_files::",
    );
  });
});
