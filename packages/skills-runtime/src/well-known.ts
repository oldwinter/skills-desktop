import type { PublicError, Result } from "./result.js";

/**
 * Agent Skills discovery v0.2.0 export profile (ADR 0019).
 *
 * The schema URI is an opaque identifier that is pinned here; export never
 * fetches it. Layout relative to the export root:
 *
 *   .well-known/agent-skills/index.json
 *   .well-known/agent-skills/<name>/SKILL.md          (type "skill-md")
 *   .well-known/agent-skills/artifacts/<name>.tar.gz  (type "archive")
 *
 * Changing the discovery version or any canonical byte rule below requires a
 * new exporter version and a later decision.
 */
export const WELL_KNOWN_EXPORT_PROFILE = Object.freeze({
  archiveDirectory: "artifacts",
  discoveryVersion: "0.2.0",
  exporterVersion: 1,
  indexPath: ".well-known/agent-skills/index.json",
  rootDirectory: ".well-known/agent-skills",
  schemaUri: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
} as const);

export const WELL_KNOWN_LIMITS = Object.freeze({
  maxDescriptionLength: 1_024,
  maxFileBytes: 4 * 1_024 * 1_024,
  maxFilesPerSkill: 256,
  maxPathLength: 255,
  maxSkillBytes: 32 * 1_024 * 1_024,
  maxSkillNameLength: 64,
  maxSkills: 128,
} as const);

export interface WellKnownFileInput {
  readonly bytes: Uint8Array;
  /** Forward-slash path relative to the Skill directory, e.g. `SKILL.md`. */
  readonly path: string;
}

export interface WellKnownSkillInput {
  readonly files: readonly WellKnownFileInput[];
  readonly name: string;
}

/**
 * Host-provided primitives. `deflateRaw` must be deterministic for identical
 * input on the exporting host; the gzip framing around it is fixed here so
 * no host timestamp or OS byte leaks into the archive.
 */
export interface WellKnownCodec {
  deflateRaw(bytes: Uint8Array): Uint8Array;
  sha256Hex(bytes: Uint8Array): string;
}

export interface WellKnownIndexEntry {
  readonly name: string;
  readonly type: "archive" | "skill-md";
  readonly description: string;
  readonly url: string;
  readonly digest: `sha256:${string}`;
}

export interface WellKnownIndex {
  readonly $schema: typeof WELL_KNOWN_EXPORT_PROFILE.schemaUri;
  readonly skills: readonly WellKnownIndexEntry[];
}

export interface WellKnownExportFile {
  readonly bytes: Uint8Array;
  /** Forward-slash path relative to the export root. */
  readonly path: string;
}

export interface WellKnownExport {
  readonly exporterVersion: typeof WELL_KNOWN_EXPORT_PROFILE.exporterVersion;
  readonly files: readonly WellKnownExportFile[];
  readonly index: WellKnownIndex;
  /** SHA-256 over `path NUL sha256(bytes) LF` for every file in path order. */
  readonly treeDigest: `sha256:${string}`;
}

export type WellKnownExportErrorCode =
  | "duplicate_skill"
  | "empty_export"
  | "invalid_frontmatter"
  | "invalid_path"
  | "invalid_skill_name"
  | "missing_skill_md"
  | "too_large"
  | "too_many_files";

export type WellKnownExportError = PublicError<WellKnownExportErrorCode> & {
  readonly path?: string;
  readonly skillName?: string;
};

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
const FRONTMATTER_LINE = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/;

function failure(
  code: WellKnownExportErrorCode,
  message: string,
  context: { path?: string; skillName?: string } = {},
): Result<never, WellKnownExportError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "export",
      retryable: false,
      ...context,
    },
    ok: false,
  };
}

function compareBytewise(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function isValidSkillName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= WELL_KNOWN_LIMITS.maxSkillNameLength &&
    SKILL_NAME.test(name)
  );
}

/**
 * Validates a forward-slash relative path for inclusion in an archive:
 * printable safe ASCII segments, no traversal, no absolute or drive paths,
 * no trailing slash, and within the ustar-representable length.
 */
export function isValidArchivePath(path: string): boolean {
  if (path.length === 0 || path.length > WELL_KNOWN_LIMITS.maxPathLength) {
    return false;
  }
  if (path.startsWith("/") || path.includes("\\") || path.includes("//")) {
    return false;
  }
  if (path.endsWith("/")) return false;
  return path
    .split("/")
    .every(
      (segment) =>
        segment !== "." && segment !== ".." && PATH_SEGMENT.test(segment),
    );
}

export interface SkillFrontmatter {
  readonly description: string;
  readonly name: string;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Reads the `name` and `description` frontmatter fields from SKILL.md. Only
 * the single-line scalar subset of YAML is accepted; anything else fails
 * closed rather than guessing.
 */
export function readSkillFrontmatter(
  bytes: Uint8Array,
): Result<SkillFrontmatter, PublicError<"invalid_frontmatter">> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    return {
      error: {
        code: "invalid_frontmatter",
        effects: "none",
        message: "SKILL.md is not valid UTF-8.",
        phase: "export",
        retryable: false,
      },
      ok: false,
    };
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return {
      error: {
        code: "invalid_frontmatter",
        effects: "none",
        message: "SKILL.md must start with YAML frontmatter.",
        phase: "export",
        retryable: false,
      },
      ok: false,
    };
  }
  const closing = lines.indexOf("---", 1);
  if (closing === -1) {
    return {
      error: {
        code: "invalid_frontmatter",
        effects: "none",
        message: "SKILL.md frontmatter is not closed.",
        phase: "export",
        retryable: false,
      },
      ok: false,
    };
  }
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, closing)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = FRONTMATTER_LINE.exec(line);
    if (match === null) continue;
    const [, key, value] = match;
    if (key === undefined || value === undefined) continue;
    if (!fields.has(key)) fields.set(key, unquote(value));
  }
  const name = fields.get("name") ?? "";
  const description = fields.get("description") ?? "";
  if (
    name === "" ||
    description === "" ||
    description.length > WELL_KNOWN_LIMITS.maxDescriptionLength ||
    hasControlCharacter(description)
  ) {
    return {
      error: {
        code: "invalid_frontmatter",
        effects: "none",
        message:
          "SKILL.md frontmatter needs single-line name and description fields.",
        phase: "export",
        retryable: false,
      },
      ok: false,
    };
  }
  return { ok: true, value: { description, name } };
}

const encoder = new TextEncoder();

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  target.set(encoder.encode(value), offset);
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function splitUstarName(
  path: string,
): { readonly name: string; readonly prefix: string } | undefined {
  const bytes = encoder.encode(path);
  if (bytes.length <= 100) return { name: path, prefix: "" };
  for (let index = path.length - 1; index > 0; index -= 1) {
    if (path[index] !== "/") continue;
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (
      encoder.encode(prefix).length <= 155 &&
      encoder.encode(name).length <= 100
    ) {
      return { name, prefix };
    }
  }
  return undefined;
}

/**
 * Builds a deterministic ustar archive: paths sorted bytewise, regular files
 * only, mode 0644, zero mtime/uid/gid/uname/gname, no PAX headers, padded to
 * a full 10240-byte record.
 */
export function buildDeterministicTar(
  files: readonly WellKnownFileInput[],
): Uint8Array {
  const sorted = [...files].sort((left, right) =>
    compareBytewise(left.path, right.path),
  );
  const blocks: Uint8Array[] = [];
  for (const file of sorted) {
    const split = splitUstarName(file.path);
    if (split === undefined) {
      throw new Error(`Path is not representable in ustar: ${file.path}`);
    }
    const header = new Uint8Array(512);
    writeAscii(header, 0, split.name);
    writeAscii(header, 100, octal(0o644, 8));
    writeAscii(header, 108, octal(0, 8));
    writeAscii(header, 116, octal(0, 8));
    writeAscii(header, 124, octal(file.bytes.length, 12));
    writeAscii(header, 136, octal(0, 12));
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    writeAscii(header, 257, "ustar\0");
    writeAscii(header, 263, "00");
    writeAscii(header, 329, octal(0, 8));
    writeAscii(header, 337, octal(0, 8));
    writeAscii(header, 345, split.prefix);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeAscii(header, 148, `${checksum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, file.bytes);
    const remainder = file.bytes.length % 512;
    if (remainder !== 0) blocks.push(new Uint8Array(512 - remainder));
  }
  blocks.push(new Uint8Array(1_024));
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const padded = Math.ceil(total / 10_240) * 10_240;
  const archive = new Uint8Array(padded);
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.length;
  }
  return archive;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Wraps raw deflate output in a gzip member with a fixed, host-free header. */
export function wrapGzip(
  original: Uint8Array,
  deflated: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(10 + deflated.length + 8);
  out.set([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03], 0);
  out.set(deflated, 10);
  const view = new DataView(out.buffer);
  view.setUint32(10 + deflated.length, crc32(original), true);
  view.setUint32(14 + deflated.length, original.length >>> 0, true);
  return out;
}

function digestOf(codec: WellKnownCodec, bytes: Uint8Array): `sha256:${string}` {
  const hex = codec.sha256Hex(bytes);
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error("Codec returned a malformed SHA-256 digest.");
  }
  return `sha256:${hex}`;
}

/**
 * Encodes the index exactly as ADR 0019 specifies: fixed key order, two-space
 * indentation, LF line endings, and one trailing newline.
 */
export function encodeWellKnownIndex(index: WellKnownIndex): Uint8Array {
  const ordered = {
    $schema: index.$schema,
    skills: index.skills.map((entry) => ({
      name: entry.name,
      type: entry.type,
      description: entry.description,
      url: entry.url,
      digest: entry.digest,
    })),
  };
  return encoder.encode(`${JSON.stringify(ordered, null, 2)}\n`);
}

function validateSkill(
  skill: WellKnownSkillInput,
): Result<SkillFrontmatter, WellKnownExportError> {
  if (!isValidSkillName(skill.name)) {
    return failure(
      "invalid_skill_name",
      "Skill names use 1-64 lowercase letters, digits, and single hyphens.",
      { skillName: skill.name },
    );
  }
  if (skill.files.length === 0) {
    return failure("missing_skill_md", "A Skill needs a root SKILL.md.", {
      skillName: skill.name,
    });
  }
  if (skill.files.length > WELL_KNOWN_LIMITS.maxFilesPerSkill) {
    return failure(
      "too_many_files",
      `A Skill may contain at most ${WELL_KNOWN_LIMITS.maxFilesPerSkill} files.`,
      { skillName: skill.name },
    );
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  let skillMd: WellKnownFileInput | undefined;
  for (const file of skill.files) {
    if (!isValidArchivePath(file.path)) {
      return failure("invalid_path", "File path is not exportable.", {
        path: file.path,
        skillName: skill.name,
      });
    }
    const folded = file.path.toLowerCase();
    if (seen.has(folded)) {
      return failure(
        "invalid_path",
        "File paths must be unique ignoring case.",
        { path: file.path, skillName: skill.name },
      );
    }
    seen.add(folded);
    if (file.bytes.length > WELL_KNOWN_LIMITS.maxFileBytes) {
      return failure("too_large", "A single file exceeds the export limit.", {
        path: file.path,
        skillName: skill.name,
      });
    }
    totalBytes += file.bytes.length;
    if (totalBytes > WELL_KNOWN_LIMITS.maxSkillBytes) {
      return failure("too_large", "The Skill exceeds the export size limit.", {
        skillName: skill.name,
      });
    }
    if (file.path === "SKILL.md") skillMd = file;
  }
  if (skillMd === undefined) {
    return failure("missing_skill_md", "A Skill needs a root SKILL.md.", {
      skillName: skill.name,
    });
  }
  const frontmatter = readSkillFrontmatter(skillMd.bytes);
  if (!frontmatter.ok) {
    return failure("invalid_frontmatter", frontmatter.error.message, {
      path: "SKILL.md",
      skillName: skill.name,
    });
  }
  if (frontmatter.value.name !== skill.name) {
    return failure(
      "invalid_frontmatter",
      "SKILL.md frontmatter name must equal the Skill directory name.",
      { path: "SKILL.md", skillName: skill.name },
    );
  }
  return frontmatter;
}

/**
 * Produces the complete discovery tree for validated Skills. Identical input
 * and exporter version yield byte-identical files and the same tree digest;
 * input order never matters.
 */
export function exportWellKnownTree(
  skills: readonly WellKnownSkillInput[],
  codec: WellKnownCodec,
): Result<WellKnownExport, WellKnownExportError> {
  if (skills.length === 0) {
    return failure("empty_export", "Select at least one Skill to export.");
  }
  if (skills.length > WELL_KNOWN_LIMITS.maxSkills) {
    return failure(
      "too_many_files",
      `An export may contain at most ${WELL_KNOWN_LIMITS.maxSkills} Skills.`,
    );
  }
  const names = new Set<string>();
  const entries: WellKnownIndexEntry[] = [];
  const files: WellKnownExportFile[] = [];
  const sorted = [...skills].sort((left, right) =>
    compareBytewise(left.name, right.name),
  );
  for (const skill of sorted) {
    const validated = validateSkill(skill);
    if (!validated.ok) return validated;
    if (names.has(skill.name)) {
      return failure("duplicate_skill", "Skill names must be unique.", {
        skillName: skill.name,
      });
    }
    names.add(skill.name);
    const root = WELL_KNOWN_EXPORT_PROFILE.rootDirectory;
    if (skill.files.length === 1) {
      const bytes = skill.files[0]!.bytes;
      files.push({ bytes, path: `${root}/${skill.name}/SKILL.md` });
      entries.push({
        name: skill.name,
        type: "skill-md",
        description: validated.value.description,
        url: `./${skill.name}/SKILL.md`,
        digest: digestOf(codec, bytes),
      });
      continue;
    }
    const tar = buildDeterministicTar(skill.files);
    const archive = wrapGzip(tar, codec.deflateRaw(tar));
    const archiveName = `${WELL_KNOWN_EXPORT_PROFILE.archiveDirectory}/${skill.name}.tar.gz`;
    files.push({ bytes: archive, path: `${root}/${archiveName}` });
    entries.push({
      name: skill.name,
      type: "archive",
      description: validated.value.description,
      url: `./${archiveName}`,
      digest: digestOf(codec, archive),
    });
  }
  const index: WellKnownIndex = {
    $schema: WELL_KNOWN_EXPORT_PROFILE.schemaUri,
    skills: entries,
  };
  files.push({
    bytes: encodeWellKnownIndex(index),
    path: WELL_KNOWN_EXPORT_PROFILE.indexPath,
  });
  files.sort((left, right) => compareBytewise(left.path, right.path));
  const manifest = files
    .map((file) => `${file.path}\0${codec.sha256Hex(file.bytes)}\n`)
    .join("");
  return {
    ok: true,
    value: {
      exporterVersion: WELL_KNOWN_EXPORT_PROFILE.exporterVersion,
      files,
      index,
      treeDigest: digestOf(codec, encoder.encode(manifest)),
    },
  };
}
