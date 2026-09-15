import { z } from "zod";

import {
  WELL_KNOWN_LIMITS,
  isValidArchivePath,
  isValidSkillName,
  readSkillFrontmatter,
} from "./well-known.js";

/**
 * ADR 0018 static Studio profile. Everything here is pure: the host hands in
 * an already-observed tree (kinds, sizes, and bounded bytes of regular files)
 * and receives findings with stable codes and root-relative locations. Nothing
 * in this module reads the filesystem, executes authored content, or returns
 * raw file content in a finding.
 */
export const STUDIO_VALIDATOR_PROFILE = Object.freeze({
  /** Directories or files that are never authored content. */
  ignoredEntries: [".git", ".DS_Store", "node_modules", "Thumbs.db"],
  limits: {
    ...WELL_KNOWN_LIMITS,
    maxFindings: 256,
    maxMarkdownBytes: 128 * 1_024,
    maxPreviewBlocks: 2_048,
  },
  version: 1,
} as const);

export const STUDIO_MAX_DRAFT_TEXT_LENGTH =
  STUDIO_VALIDATOR_PROFILE.limits.maxMarkdownBytes;

export type StudioEntryKind =
  "directory" | "file" | "hardlink" | "special" | "symlink";

export interface StudioTreeEntry {
  /** Bytes of a regular file within `maxFileBytes`; omitted otherwise. */
  readonly bytes?: Uint8Array;
  readonly kind: StudioEntryKind;
  /** Root-relative forward-slash path exactly as observed (unvalidated). */
  readonly path: string;
  readonly size: number;
}

export interface StudioTreeInput {
  /** Name of the Skill directory itself (must agree with frontmatter). */
  readonly directoryName: string;
  readonly entries: readonly StudioTreeEntry[];
}

export const studioFindingCodeSchema = z.enum([
  "case_conflict",
  "description_invalid",
  "file_too_large",
  "frontmatter_invalid",
  "hardlink",
  "html_inert",
  "link_escape",
  "link_unresolved",
  "link_unsafe",
  "name_invalid",
  "name_mismatch",
  "not_utf8",
  "path_invalid",
  "path_traversal",
  "skill_md_missing",
  "skill_too_large",
  "special_file",
  "symlink",
  "too_many_files",
]);

export const studioFindingSchema = z
  .object({
    code: studioFindingCodeSchema,
    /** Root-relative location only; never a raw excerpt. */
    line: z.number().int().positive().optional(),
    message: z.string().min(1).max(512),
    path: z.string().min(1).max(1_024),
    severity: z.enum(["error", "warning"]),
  })
  .strict();

export const studioValidationSchema = z
  .object({
    description: z.string().max(WELL_KNOWN_LIMITS.maxDescriptionLength),
    fileCount: z.number().int().nonnegative(),
    findings: z
      .array(studioFindingSchema)
      .max(STUDIO_VALIDATOR_PROFILE.limits.maxFindings),
    name: z.string().max(WELL_KNOWN_LIMITS.maxSkillNameLength),
    /** True only when no error-severity finding exists. */
    ok: z.boolean(),
    profileVersion: z.literal(STUDIO_VALIDATOR_PROFILE.version),
    totalBytes: z.number().int().nonnegative(),
  })
  .strict();

export type StudioFindingCode = z.infer<typeof studioFindingCodeSchema>;
export type StudioFinding = z.infer<typeof studioFindingSchema>;
export type StudioValidation = z.infer<typeof studioValidationSchema>;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

const REMOTE_LINK = /^(?:https?:|mailto:)/i;
const SCHEME_LINK = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const MARKDOWN_LINK = /(!?)\[[^\]\n]*\]\(([^)\s]*)(?:\s+"[^"\n]*")?\)/g;
const RAW_HTML_BLOCK = /^\s*<(?:[a-zA-Z][a-zA-Z0-9-]*|!--|\/)/;

interface FindingSink {
  add(finding: StudioFinding): void;
  hasErrors(): boolean;
  list(): StudioFinding[];
}

function findingSink(): FindingSink {
  const findings: StudioFinding[] = [];
  let errors = false;
  return {
    add(finding) {
      if (finding.severity === "error") errors = true;
      if (findings.length < STUDIO_VALIDATOR_PROFILE.limits.maxFindings) {
        findings.push(finding);
      }
    },
    hasErrors: () => errors,
    list: () => findings,
  };
}

function normalizeLinkTarget(
  fromPath: string,
  rawTarget: string,
): {
  readonly kind: "escape" | "remote" | "resolved" | "unsafe";
  path?: string;
} {
  const withoutFragment = rawTarget.split("#")[0]?.split("?")[0] ?? "";
  if (withoutFragment === "") return { kind: "resolved", path: fromPath };
  if (REMOTE_LINK.test(withoutFragment)) return { kind: "remote" };
  if (SCHEME_LINK.test(withoutFragment)) return { kind: "unsafe" };
  if (withoutFragment.startsWith("/") || withoutFragment.includes("\\")) {
    return { kind: "escape" };
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    return { kind: "unsafe" };
  }
  const base = fromPath.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (base.length === 0) return { kind: "escape" };
      base.pop();
      continue;
    }
    base.push(segment);
  }
  return { kind: "resolved", path: base.join("/") };
}

function checkMarkdownLinks(
  text: string,
  path: string,
  known: ReadonlySet<string>,
  sink: FindingSink,
): void {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (RAW_HTML_BLOCK.test(line)) {
      sink.add({
        code: "html_inert",
        line: lineNumber,
        message: "Raw HTML is rendered as inert text in preview.",
        path,
        severity: "warning",
      });
    }
    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const target = match[2] ?? "";
      const resolved = normalizeLinkTarget(path, target);
      if (resolved.kind === "remote") continue;
      if (resolved.kind === "unsafe") {
        sink.add({
          code: "link_unsafe",
          line: lineNumber,
          message: "Link uses a scheme that Studio never follows.",
          path,
          severity: "error",
        });
        continue;
      }
      if (resolved.kind === "escape") {
        sink.add({
          code: "link_escape",
          line: lineNumber,
          message: "Link points outside the Skill directory.",
          path,
          severity: "error",
        });
        continue;
      }
      if (resolved.path !== undefined && !known.has(resolved.path)) {
        sink.add({
          code: "link_unresolved",
          line: lineNumber,
          message: "Link target does not exist in the Skill.",
          path,
          severity: "error",
        });
      }
    }
  });
}

function emptyValidation(): Omit<StudioValidation, "findings" | "ok"> {
  return {
    description: "",
    fileCount: 0,
    name: "",
    profileVersion: STUDIO_VALIDATOR_PROFILE.version,
    totalBytes: 0,
  };
}

/**
 * Validates one Skill directory as observed by the host. The validator fails
 * closed: any symbolic link, hard link, special file, traversal segment,
 * over-limit file, invalid path, or unreadable `SKILL.md` is an error, and
 * `ok` is `false` whenever an error-severity finding exists.
 */
export function validateSkillTree(input: StudioTreeInput): StudioValidation {
  const sink = findingSink();
  const limits = STUDIO_VALIDATOR_PROFILE.limits;
  const summary = { ...emptyValidation() };
  const regularFiles = new Map<string, StudioTreeEntry>();
  const seenLowercase = new Map<string, string>();
  const directories = new Set<string>();
  const ignored = new Set<string>(STUDIO_VALIDATOR_PROFILE.ignoredEntries);

  for (const entry of input.entries) {
    const path = entry.path;
    const segments = path.split("/");
    if (segments.some((segment) => ignored.has(segment))) continue;
    if (segments.some((segment) => segment === "..")) {
      sink.add({
        code: "path_traversal",
        message: "Path contains a traversal segment.",
        path,
        severity: "error",
      });
      continue;
    }
    if (entry.kind === "symlink") {
      sink.add({
        code: "symlink",
        message: "Symbolic links are not allowed in a Skill.",
        path,
        severity: "error",
      });
      continue;
    }
    if (entry.kind === "hardlink") {
      sink.add({
        code: "hardlink",
        message: "Hard-linked files are ambiguous and not allowed.",
        path,
        severity: "error",
      });
      continue;
    }
    if (entry.kind === "special") {
      sink.add({
        code: "special_file",
        message: "Special files are not allowed in a Skill.",
        path,
        severity: "error",
      });
      continue;
    }
    if (!isValidArchivePath(path)) {
      sink.add({
        code: "path_invalid",
        message: "Path uses characters or a length that cannot be exported.",
        path,
        severity: "error",
      });
      continue;
    }
    const lowered = path.toLowerCase();
    const prior = seenLowercase.get(lowered);
    if (prior !== undefined && prior !== path) {
      sink.add({
        code: "case_conflict",
        message: "Path differs from another entry only by letter case.",
        path,
        severity: "error",
      });
      continue;
    }
    seenLowercase.set(lowered, path);
    if (entry.kind === "directory") {
      directories.add(path);
      continue;
    }
    if (entry.size > limits.maxFileBytes || entry.bytes === undefined) {
      sink.add({
        code: "file_too_large",
        message: `File exceeds ${limits.maxFileBytes} bytes or could not be bounded.`,
        path,
        severity: "error",
      });
      continue;
    }
    regularFiles.set(path, entry);
    summary.fileCount += 1;
    summary.totalBytes += entry.size;
  }

  if (summary.fileCount > limits.maxFilesPerSkill) {
    sink.add({
      code: "too_many_files",
      message: `Skill exceeds ${limits.maxFilesPerSkill} files.`,
      path: ".",
      severity: "error",
    });
  }
  if (summary.totalBytes > limits.maxSkillBytes) {
    sink.add({
      code: "skill_too_large",
      message: `Skill exceeds ${limits.maxSkillBytes} bytes.`,
      path: ".",
      severity: "error",
    });
  }

  const skillMd = regularFiles.get("SKILL.md");
  if (skillMd?.bytes === undefined) {
    sink.add({
      code: "skill_md_missing",
      message: "SKILL.md is required at the Skill root.",
      path: "SKILL.md",
      severity: "error",
    });
  } else {
    const frontmatter = readSkillFrontmatter(skillMd.bytes);
    if (!frontmatter.ok) {
      sink.add({
        code:
          decodeUtf8(skillMd.bytes) === undefined
            ? "not_utf8"
            : "frontmatter_invalid",
        line: 1,
        message: frontmatter.error.message,
        path: "SKILL.md",
        severity: "error",
      });
    } else {
      summary.name = frontmatter.value.name;
      summary.description = frontmatter.value.description;
      if (!isValidSkillName(frontmatter.value.name)) {
        sink.add({
          code: "name_invalid",
          line: 1,
          message:
            "Skill name must be lowercase letters, digits, and single hyphens.",
          path: "SKILL.md",
          severity: "error",
        });
      } else if (frontmatter.value.name !== input.directoryName) {
        sink.add({
          code: "name_mismatch",
          line: 1,
          message: "Frontmatter name must match the Skill directory name.",
          path: "SKILL.md",
          severity: "error",
        });
      }
      if (frontmatter.value.description.trim().length === 0) {
        sink.add({
          code: "description_invalid",
          line: 1,
          message: "Description must not be blank.",
          path: "SKILL.md",
          severity: "error",
        });
      }
    }
  }

  const known = new Set<string>(directories);
  for (const path of regularFiles.keys()) {
    known.add(path);
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      known.add(segments.slice(0, index).join("/"));
    }
  }
  for (const [path, entry] of regularFiles) {
    if (!path.toLowerCase().endsWith(".md") || entry.bytes === undefined) {
      continue;
    }
    if (entry.size > limits.maxMarkdownBytes) {
      sink.add({
        code: "file_too_large",
        message: `Markdown exceeds ${limits.maxMarkdownBytes} bytes.`,
        path,
        severity: "error",
      });
      continue;
    }
    const text = decodeUtf8(entry.bytes);
    if (text === undefined) {
      if (path === "SKILL.md") continue;
      sink.add({
        code: "not_utf8",
        message: "Markdown is not valid UTF-8.",
        path,
        severity: "error",
      });
      continue;
    }
    checkMarkdownLinks(text, path, known, sink);
  }

  return { ...summary, findings: sink.list(), ok: !sink.hasErrors() };
}

/**
 * Structured, allowlisted preview. Markdown is parsed into a closed set of
 * semantic blocks and inlines; there is no HTML output, no plugin hook, and
 * no URL the renderer may navigate to. Images and links carry their target
 * as inert text so the renderer can show, but never fetch, them.
 */
export type StudioPreviewInline =
  | { readonly kind: "code"; readonly text: string }
  | {
      readonly kind: "emphasis";
      readonly children: readonly StudioPreviewInline[];
    }
  | { readonly alt: string; readonly kind: "image"; readonly target: string }
  | {
      readonly children: readonly StudioPreviewInline[];
      readonly kind: "link";
      readonly target: string;
    }
  | {
      readonly kind: "strong";
      readonly children: readonly StudioPreviewInline[];
    }
  | { readonly kind: "text"; readonly text: string };

export type StudioPreviewBlock =
  | { readonly children: readonly StudioPreviewBlock[]; readonly kind: "quote" }
  | { readonly kind: "code"; readonly language: string; readonly text: string }
  | {
      readonly children: readonly StudioPreviewInline[];
      readonly kind: "heading";
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
    }
  | {
      readonly items: readonly (readonly StudioPreviewInline[])[];
      readonly kind: "list";
      readonly ordered: boolean;
    }
  | {
      readonly children: readonly StudioPreviewInline[];
      readonly kind: "paragraph";
    }
  | { readonly kind: "rule" };

const inlineSchema: z.ZodType<StudioPreviewInline> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("code"), text: z.string() }).strict(),
    z
      .object({ children: z.array(inlineSchema), kind: z.literal("emphasis") })
      .strict(),
    z
      .object({
        alt: z.string(),
        kind: z.literal("image"),
        target: z.string(),
      })
      .strict(),
    z
      .object({
        children: z.array(inlineSchema),
        kind: z.literal("link"),
        target: z.string(),
      })
      .strict(),
    z
      .object({ children: z.array(inlineSchema), kind: z.literal("strong") })
      .strict(),
    z.object({ kind: z.literal("text"), text: z.string() }).strict(),
  ]),
);

export const studioPreviewBlockSchema: z.ZodType<StudioPreviewBlock> = z.lazy(
  () =>
    z.union([
      z
        .object({
          children: z.array(studioPreviewBlockSchema),
          kind: z.literal("quote"),
        })
        .strict(),
      z
        .object({
          kind: z.literal("code"),
          language: z.string(),
          text: z.string(),
        })
        .strict(),
      z
        .object({
          children: z.array(inlineSchema),
          kind: z.literal("heading"),
          level: z.union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5),
            z.literal(6),
          ]),
        })
        .strict(),
      z
        .object({
          items: z.array(z.array(inlineSchema)),
          kind: z.literal("list"),
          ordered: z.boolean(),
        })
        .strict(),
      z
        .object({
          children: z.array(inlineSchema),
          kind: z.literal("paragraph"),
        })
        .strict(),
      z.object({ kind: z.literal("rule") }).strict(),
    ]),
);

export const studioPreviewSchema = z
  .object({
    blocks: z
      .array(studioPreviewBlockSchema)
      .max(STUDIO_VALIDATOR_PROFILE.limits.maxPreviewBlocks),
    profileVersion: z.literal(STUDIO_VALIDATOR_PROFILE.version),
    /** True when the block budget was exhausted before the end of the text. */
    truncated: z.boolean(),
  })
  .strict();

export type StudioPreview = z.infer<typeof studioPreviewSchema>;

const INLINE_TOKEN =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|(!?)\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_/g;

function parseInlines(text: string, depth = 0): StudioPreviewInline[] {
  const out: StudioPreviewInline[] = [];
  if (depth > 4) return [{ kind: "text", text }];
  let last = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const start = match.index;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    last = start + match[0].length;
    if (match[2] !== undefined) {
      out.push({ kind: "code", text: match[2].trim() });
    } else if (match[4] !== undefined) {
      const target = match[5] ?? "";
      if (match[3] === "!") {
        out.push({ alt: match[4], kind: "image", target });
      } else {
        out.push({
          children: parseInlines(match[4], depth + 1),
          kind: "link",
          target,
        });
      }
    } else if (match[6] !== undefined || match[7] !== undefined) {
      out.push({
        children: parseInlines(match[6] ?? match[7] ?? "", depth + 1),
        kind: "strong",
      });
    } else if (match[8] !== undefined || match[9] !== undefined) {
      out.push({
        children: parseInlines(match[8] ?? match[9] ?? "", depth + 1),
        kind: "emphasis",
      });
    }
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^(```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d{1,9}[.)]\s+(.*)$/;

interface BlockBudget {
  remaining: number;
  truncated: boolean;
}

function parseBlocks(
  lines: readonly string[],
  budget: BlockBudget,
): StudioPreviewBlock[] {
  const blocks: StudioPreviewBlock[] = [];
  const push = (block: StudioPreviewBlock): boolean => {
    if (budget.remaining <= 0) {
      budget.truncated = true;
      return false;
    }
    budget.remaining -= 1;
    blocks.push(block);
    return true;
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? "```";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith(marker)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      if (
        !push({ kind: "code", language: fence[2] ?? "", text: body.join("\n") })
      ) {
        return blocks;
      }
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = Math.min(6, Math.max(1, heading[1]?.length ?? 1)) as
        1 | 2 | 3 | 4 | 5 | 6;
      index += 1;
      if (
        !push({
          children: parseInlines(heading[2] ?? ""),
          kind: "heading",
          level,
        })
      ) {
        return blocks;
      }
      continue;
    }
    if (RULE.test(line)) {
      index += 1;
      if (!push({ kind: "rule" })) return blocks;
      continue;
    }
    if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith(">")) {
        quoted.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      const children = parseBlocks(quoted, budget);
      if (!push({ children, kind: "quote" })) return blocks;
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const pattern = isOrdered ? ORDERED : BULLET;
      const items: StudioPreviewInline[][] = [];
      while (index < lines.length) {
        const item = pattern.exec(lines[index] ?? "");
        if (item === null) break;
        items.push(parseInlines(item[1] ?? ""));
        index += 1;
      }
      if (!push({ items, kind: "list", ordered: isOrdered })) return blocks;
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (
        next.trim() === "" ||
        FENCE.test(next) ||
        HEADING.test(next) ||
        RULE.test(next) ||
        next.startsWith(">") ||
        BULLET.test(next) ||
        ORDERED.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    if (
      !push({ children: parseInlines(paragraph.join(" ")), kind: "paragraph" })
    ) {
      return blocks;
    }
  }
  return blocks;
}

/** Strips the leading YAML frontmatter block when present. */
export function stripSkillFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return text;
  const closing = lines.indexOf("---", 1);
  if (closing === -1) return text;
  return lines.slice(closing + 1).join("\n");
}

export function renderStudioPreview(markdown: string): StudioPreview {
  const bounded = markdown.slice(
    0,
    STUDIO_VALIDATOR_PROFILE.limits.maxMarkdownBytes,
  );
  const budget: BlockBudget = {
    remaining: STUDIO_VALIDATOR_PROFILE.limits.maxPreviewBlocks,
    truncated: false,
  };
  const blocks = parseBlocks(
    stripSkillFrontmatter(bounded).split(/\r?\n/),
    budget,
  );
  return {
    blocks,
    profileVersion: STUDIO_VALIDATOR_PROFILE.version,
    truncated: budget.truncated || bounded.length < markdown.length,
  };
}
