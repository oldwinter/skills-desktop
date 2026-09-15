import { z } from "zod";

import { CLI_VERSION } from "./inventory.js";
import type { PublicError, Result } from "./result.js";

/**
 * ADR 0015: the closed set of stable source forms that `skills@1.5.23`
 * accepts for `add`. The descriptor keeps the exact case-sensitive text the
 * user approved and records its family, its mutable ref (if any), and
 * whether it can leave the desktop machine.
 */
export const SOURCE_DESCRIPTOR_SCHEMA_VERSION = 1 as const;
export const SOURCE_LISTING_DIALECT_VERSION = 1 as const;

export const SOURCE_FAMILIES = [
  "github",
  "gitlab",
  "git",
  "http-skill",
  "http-archive",
  "local-directory",
  "local-archive",
  "well-known",
  "skills-sh-pack",
] as const;

export type SourceFamily = (typeof SOURCE_FAMILIES)[number];

const MAX_SOURCE_LENGTH = 2_048;
const MAX_REF_LENGTH = 256;
export const MAX_SOURCE_CANDIDATES = 512;
const MAX_CANDIDATE_NAME_LENGTH = 256;
const MAX_CANDIDATE_DESCRIPTION_LENGTH = 4_096;
const MAX_CANDIDATE_GROUP_LENGTH = 256;
const MAX_LISTING_LINES = 20_000;

const COMMIT_SHA = /^[a-f0-9]{40}$/;

function hasControlCharacters(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

// The descriptor crosses the IPC boundary, so the structural schema repeats
// the argument-safety rules `describeSource` applies: one token, no
// whitespace or control characters, and never option-shaped.
const sourceTextSchema = z
  .string()
  .min(1)
  .max(MAX_SOURCE_LENGTH)
  .refine(
    (value) =>
      !hasControlCharacters(value) &&
      !/\s/.test(value) &&
      !value.startsWith("-"),
  );

export const sourceDescriptorV1Schema = z
  .object({
    family: z.enum(SOURCE_FAMILIES),
    locality: z.enum(["local-only", "portable"]),
    /**
     * `pinned` only when the source names an exact commit. Every other form
     * (default branch, named ref, HTTP content, local path) can change
     * between inspection and execution and is disclosed as mutable.
     */
    mutability: z.enum(["mutable", "pinned"]),
    ref: z.string().min(1).max(MAX_REF_LENGTH).nullable(),
    schemaVersion: z.literal(SOURCE_DESCRIPTOR_SCHEMA_VERSION),
    source: sourceTextSchema,
  })
  .strict()
  .superRefine((descriptor, context) => {
    const localFamily =
      descriptor.family === "local-directory" ||
      descriptor.family === "local-archive";
    if (localFamily !== (descriptor.locality === "local-only")) {
      context.addIssue({
        code: "custom",
        message: "Local source families are local-only; all others are portable.",
      });
    }
  });

export type SourceDescriptorV1 = z.infer<typeof sourceDescriptorV1Schema>;

export type SourceDescriptorError = PublicError<"source_unsupported">;

function unsupported(message: string): Result<never, SourceDescriptorError> {
  return {
    error: {
      code: "source_unsupported",
      effects: "none",
      message,
      phase: "describe",
      retryable: false,
    },
    ok: false,
  };
}

function descriptor(
  family: SourceFamily,
  source: string,
  ref: string | null,
  mutability: SourceDescriptorV1["mutability"] = "mutable",
): Result<SourceDescriptorV1, SourceDescriptorError> {
  const parsed = sourceDescriptorV1Schema.safeParse({
    family,
    locality:
      family === "local-directory" || family === "local-archive"
        ? "local-only"
        : "portable",
    mutability,
    ref,
    schemaVersion: SOURCE_DESCRIPTOR_SCHEMA_VERSION,
    source,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : unsupported("The source form is not supported.");
}

const ARCHIVE_SUFFIX = /\.(?:tar\.gz|tgz|zip)$/i;
const SKILL_MD_SUFFIX = /(?:^|\/)SKILL\.md$/;
const OWNER_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPOSITORY_SEGMENT = /^[A-Za-z0-9._-]+$/;
const REF_SEGMENT = /^[^\s~^:?*[\\]+$/;

function isLocalPath(input: string): boolean {
  return (
    input.startsWith("/") ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    input === "." ||
    input === ".." ||
    /^[A-Za-z]:[/\\]/.test(input)
  );
}

function splitFragmentRef(input: string): {
  readonly base: string;
  readonly ref: string | null;
} {
  const hash = input.indexOf("#");
  if (hash < 0) return { base: input, ref: null };
  const ref = input.slice(hash + 1);
  // `#ref@skill` also carries a skill filter in the pinned dialect; the
  // desktop selects names through the inspection instead, so reject it.
  if (ref.length === 0 || ref.includes("@") || ref.includes("#")) {
    return { base: input, ref: "" };
  }
  return { base: input.slice(0, hash), ref };
}

function validRef(ref: string | null): boolean {
  return (
    ref === null ||
    (ref.length > 0 && ref.length <= MAX_REF_LENGTH && REF_SEGMENT.test(ref))
  );
}

function mutabilityFor(ref: string | null): SourceDescriptorV1["mutability"] {
  return ref !== null && COMMIT_SHA.test(ref) ? "pinned" : "mutable";
}

function parseUrl(input: string): URL | undefined {
  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}

function describeHttpUrl(
  original: string,
  url: URL,
  fragmentRef: string | null,
): Result<SourceDescriptorV1, SourceDescriptorError> {
  if (url.username !== "" || url.password !== "") {
    return unsupported("Sources must not embed credentials.");
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const path = url.pathname;

  if (host === "github.com" || host === "www.github.com") {
    const [owner, repository, marker, ...rest] = segments;
    if (owner === undefined || repository === undefined) {
      return unsupported("GitHub sources must name owner/repository.");
    }
    if (
      marker === "archive" ||
      marker === "raw" ||
      marker === "releases"
    ) {
      const family = SKILL_MD_SUFFIX.test(path) ? "http-skill" : "http-archive";
      const archiveName = rest.at(-1) ?? "";
      const sha = archiveName.replace(ARCHIVE_SUFFIX, "");
      return descriptor(
        family,
        original,
        fragmentRef,
        marker === "archive" && COMMIT_SHA.test(sha) ? "pinned" : "mutable",
      );
    }
    if (marker === "tree") {
      const [ref] = rest;
      if (ref === undefined) return unsupported("GitHub tree URLs need a ref.");
      return descriptor("github", original, ref, mutabilityFor(ref));
    }
    if (marker !== undefined) {
      return unsupported("This GitHub URL form is not supported.");
    }
    return descriptor("github", original, fragmentRef, mutabilityFor(fragmentRef));
  }
  if (
    host === "raw.githubusercontent.com" ||
    host === "codeload.github.com" ||
    host === "objects.githubusercontent.com"
  ) {
    return descriptor(
      SKILL_MD_SUFFIX.test(path) ? "http-skill" : "http-archive",
      original,
      fragmentRef,
    );
  }
  if (host === "gitlab.com" || host === "www.gitlab.com") {
    const dash = segments.indexOf("-");
    if (dash >= 0) {
      const marker = segments[dash + 1];
      if (marker === "archive" || marker === "raw") {
        return descriptor(
          SKILL_MD_SUFFIX.test(path) ? "http-skill" : "http-archive",
          original,
          fragmentRef,
        );
      }
      if (marker === "tree") {
        const ref = segments[dash + 2];
        if (ref === undefined) return unsupported("GitLab tree URLs need a ref.");
        return descriptor("gitlab", original, ref, mutabilityFor(ref));
      }
      return unsupported("This GitLab URL form is not supported.");
    }
    if (segments.length < 2) {
      return unsupported("GitLab sources must name a group and project.");
    }
    return descriptor("gitlab", original, fragmentRef, mutabilityFor(fragmentRef));
  }
  if (/\.git$/i.test(path)) {
    return descriptor("git", original, fragmentRef, mutabilityFor(fragmentRef));
  }
  if (host === "skills.sh" || host === "www.skills.sh") {
    if (/^\/p\/[^/]+/.test(path)) {
      return descriptor("skills-sh-pack", original, null);
    }
    return unsupported("Only skills.sh Pack pages are supported.");
  }
  if (SKILL_MD_SUFFIX.test(path)) return descriptor("http-skill", original, null);
  if (ARCHIVE_SUFFIX.test(path)) return descriptor("http-archive", original, null);
  if (fragmentRef !== null) {
    return unsupported("Well-known discovery URLs do not take a ref.");
  }
  return descriptor("well-known", original, null);
}

/**
 * Classifies user-entered source text into a `SourceDescriptorV1` without
 * rewriting it. Anything credential-bearing, option-shaped, control-character
 * laden, or outside the reviewed dialect fails here, before any spawn.
 */
export function describeSource(
  input: unknown,
): Result<SourceDescriptorV1, SourceDescriptorError> {
  if (typeof input !== "string") return unsupported("Source must be text.");
  const source = input;
  if (source.length === 0 || source.trim() !== source) {
    return unsupported("Source must not be empty or padded with whitespace.");
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    return unsupported("Source text is too long.");
  }
  if (hasControlCharacters(source) || /\s/.test(source)) {
    return unsupported("Source must not contain whitespace or control characters.");
  }
  if (source.startsWith("-")) {
    return unsupported("Source must not look like a command option.");
  }

  if (isLocalPath(source)) {
    return descriptor(
      ARCHIVE_SUFFIX.test(source) ? "local-archive" : "local-directory",
      source,
      null,
    );
  }

  const { base, ref: fragmentRef } = splitFragmentRef(source);
  if (fragmentRef === "" || !validRef(fragmentRef)) {
    return unsupported("The source ref fragment is not supported.");
  }

  if (/^https?:\/\//i.test(base)) {
    const url = parseUrl(base);
    if (url === undefined || url.hash !== "" || url.search !== "") {
      return unsupported("The source URL is not supported.");
    }
    return describeHttpUrl(source, url, fragmentRef);
  }
  if (/^ssh:\/\//i.test(base)) {
    const url = parseUrl(base);
    if (url === undefined || url.password !== "" || !/\.git$/i.test(url.pathname)) {
      return unsupported("SSH Git sources must end in .git and carry no password.");
    }
    return descriptor("git", source, fragmentRef, mutabilityFor(fragmentRef));
  }
  const scpLike = /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+\.git$/.exec(base);
  if (scpLike !== null) {
    return descriptor("git", source, fragmentRef, mutabilityFor(fragmentRef));
  }
  if (base.includes(":") || base.startsWith(".")) {
    return unsupported("The source form is not supported.");
  }
  const shorthand = /^([^/]+)\/([^/@]+)(?:\/(.+?))?\/?$/.exec(base);
  if (shorthand !== null) {
    const [, owner, repository, subpath] = shorthand;
    if (
      owner === undefined ||
      repository === undefined ||
      !OWNER_SEGMENT.test(owner) ||
      !REPOSITORY_SEGMENT.test(repository) ||
      repository === "." ||
      repository === ".." ||
      (subpath !== undefined && /(^|\/)\.\.(\/|$)/.test(subpath))
    ) {
      return unsupported("GitHub shorthand must be owner/repository[/path].");
    }
    return descriptor("github", source, fragmentRef, mutabilityFor(fragmentRef));
  }
  return unsupported("The source form is not supported.");
}

export interface SourceCandidate {
  readonly description: string;
  readonly group: string | null;
  readonly name: string;
}

export interface SourceListing {
  readonly candidates: readonly SourceCandidate[];
  readonly cliVersion: typeof CLI_VERSION;
  readonly dialectVersion: typeof SOURCE_LISTING_DIALECT_VERSION;
}

export type SourceListingParseError = PublicError<
  "source_inspection_incompatible"
>;

function incompatible(
  message: string,
): Result<never, SourceListingParseError> {
  return {
    error: {
      code: "source_inspection_incompatible",
      effects: "none",
      message,
      phase: "inspect",
      retryable: false,
    },
    ok: false,
  };
}

const ESC = "\\u001b";
const CSI = new RegExp(
  `${ESC}\\[[\\u0030-\\u003f]*[\\u0020-\\u002f]*[\\u0040-\\u007e]`,
  "g",
);
const OSC = new RegExp(`${ESC}\\][\\s\\S]*?(?:\\u0007|${ESC}\\\\)`, "g");
const SIMPLE_ESCAPE = new RegExp(`${ESC}[\\u0020-\\u002f]*[\\u0030-\\u007e]`, "g");

export function stripTerminalEscapes(text: string): string {
  return text.replace(OSC, "").replace(CSI, "").replace(SIMPLE_ESCAPE, "");
}

const BAR = "│";
const STEP = "◇";
const OUTRO = "└";
const LISTING_HEADER = `${STEP}  Available Skills`;
const OUTROS = new Set([
  `${OUTRO}  Use --skill <name> to install specific skills`,
  `${OUTRO}  Run without --list to install`,
]);
const FOUND = /Found (\d+) skills?\b/g;

const candidateNameSchema = z
  .string()
  .min(1)
  .max(MAX_CANDIDATE_NAME_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

/**
 * Versioned parser for `skills@1.5.23 add <source> --list`. The listing is a
 * human-readable clack transcript, so the parser is deliberately narrow: it
 * only trusts the block between the `Available Skills` step and the outro,
 * requires every entry to be a name line followed by exactly one description
 * line, and cross-checks the count the CLI announced. Any deviation fails the
 * whole inspection instead of publishing a partial candidate list.
 */
export function parseSourceListing(
  stdout: string,
): Result<SourceListing, SourceListingParseError> {
  if (typeof stdout !== "string") {
    return incompatible("Source listing output is not text.");
  }
  const lines = stripTerminalEscapes(stdout)
    .replace(/\r\n?/g, "\n")
    .split("\n");
  if (lines.length > MAX_LISTING_LINES) {
    return incompatible("Source listing output has too many lines.");
  }
  const headerIndex = lines.findIndex((line) => line.trimEnd() === LISTING_HEADER);
  if (headerIndex < 0) {
    return incompatible("Source listing did not announce available Skills.");
  }
  if (lines.slice(headerIndex + 1).some((line) => line.trimEnd() === LISTING_HEADER)) {
    return incompatible("Source listing announced available Skills twice.");
  }
  let announced: number | undefined;
  for (const match of lines.slice(0, headerIndex).join("\n").matchAll(FOUND)) {
    const count = Number(match[1]);
    if (announced !== undefined && announced !== count) {
      return incompatible("Source listing announced conflicting counts.");
    }
    announced = count;
  }
  if (announced === undefined) {
    return incompatible("Source listing did not announce a Skill count.");
  }

  const candidates: SourceCandidate[] = [];
  const seen = new Set<string>();
  let group: string | null = null;
  let pendingName: string | undefined;
  let lastCandidate: SourceCandidate | undefined;
  let finished = false;

  for (const raw of lines.slice(headerIndex + 1)) {
    const line = raw.trimEnd();
    if (finished) {
      if (line !== "") return incompatible("Source listing continued after its outro.");
      continue;
    }
    if (line === "" || line === BAR) continue;
    if (OUTROS.has(line)) {
      if (pendingName !== undefined) {
        return incompatible("Source listing ended without a description.");
      }
      finished = true;
      continue;
    }
    if (line.startsWith(OUTRO) || line.startsWith(STEP)) {
      return incompatible("Source listing contained an unexpected step.");
    }
    if (!line.startsWith(`${BAR} `)) {
      if (pendingName !== undefined) {
        return incompatible("Source listing interleaved a group and an entry.");
      }
      if (line.length > MAX_CANDIDATE_GROUP_LENGTH || line.startsWith(" ")) {
        return incompatible("Source listing group title is not supported.");
      }
      group = line;
      lastCandidate = undefined;
      continue;
    }
    const body = line.slice(BAR.length);
    if (body.startsWith("      ")) {
      const text = body.slice(6);
      if (pendingName !== undefined) {
        if (text.length === 0 || text.length > MAX_CANDIDATE_DESCRIPTION_LENGTH) {
          return incompatible("Source listing description is out of bounds.");
        }
        const candidate: SourceCandidate = {
          description: text,
          group,
          name: pendingName,
        };
        candidates.push(candidate);
        lastCandidate = candidate;
        pendingName = undefined;
        continue;
      }
      // Well-known listings append a file count after the description.
      if (lastCandidate !== undefined && /^Files: \d+$/.test(text)) {
        lastCandidate = undefined;
        continue;
      }
      return incompatible("Source listing description has no entry.");
    }
    if (body.startsWith("    ")) {
      if (pendingName !== undefined) {
        return incompatible("Source listing entry has no description.");
      }
      const name = body.slice(4);
      if (!candidateNameSchema.safeParse(name).success) {
        return incompatible("Source listing entry name is not supported.");
      }
      if (seen.has(name)) {
        return incompatible("Source listing repeated an entry name.");
      }
      if (candidates.length >= MAX_SOURCE_CANDIDATES) {
        return incompatible("Source listing has too many entries.");
      }
      seen.add(name);
      pendingName = name;
      continue;
    }
    return incompatible("Source listing line is not part of the dialect.");
  }

  if (!finished) return incompatible("Source listing did not finish.");
  if (candidates.length === 0) {
    return incompatible("Source listing published no entries.");
  }
  if (candidates.length !== announced) {
    return incompatible("Source listing entry count does not match the announced count.");
  }
  return {
    ok: true,
    value: {
      candidates,
      cliVersion: CLI_VERSION,
      dialectVersion: SOURCE_LISTING_DIALECT_VERSION,
    },
  };
}

/**
 * Canonical bytes for the inspection result digest. Callers hash this with
 * SHA-256 so the exact Source Descriptor and candidate list bind the later
 * add preparation.
 */
export function canonicalSourceInspectionJson(input: {
  readonly descriptor: SourceDescriptorV1;
  readonly listing: SourceListing;
}): string {
  return JSON.stringify({
    candidates: input.listing.candidates.map((candidate) => ({
      description: candidate.description,
      group: candidate.group,
      name: candidate.name,
    })),
    cliVersion: input.listing.cliVersion,
    descriptor: {
      family: input.descriptor.family,
      locality: input.descriptor.locality,
      mutability: input.descriptor.mutability,
      ref: input.descriptor.ref,
      schemaVersion: input.descriptor.schemaVersion,
      source: input.descriptor.source,
    },
    dialectVersion: input.listing.dialectVersion,
  });
}
