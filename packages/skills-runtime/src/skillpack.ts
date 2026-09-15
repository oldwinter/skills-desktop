import { z } from "zod";

import {
  HARNESS_IDS,
  normalizeHarnessIds,
  SKILLS_DIALECT_ID,
} from "./harness-registry.js";
import type { PublicError, Result } from "./result.js";

/**
 * `.skillpack` v1 (ADR 0017): a strict, metadata/source-only JSON envelope for
 * User and Imported Packages. It carries no Skill content, Target, host,
 * Inventory, installed-state claim, argv, preview, Guard, or Official receipt.
 *
 * Canonical bytes follow RFC 8785 (JSON Canonicalization Scheme). The file on
 * disk must be exactly those bytes; `documentDigest` is SHA-256 over the
 * canonical `{kind, schemaVersion, package}` object so the digest never
 * includes itself.
 */
export const SKILLPACK_KIND = "skillpack" as const;
export const SKILLPACK_SCHEMA_VERSION = 1 as const;
export const SKILLPACK_MAX_BYTES = 1_024 * 1_024;

const packageIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);

const skillNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const skillNamesSchema = z
  .array(skillNameSchema)
  .min(1)
  .max(128)
  .superRefine((names, context) => {
    const exact = new Set<string>();
    const folded = new Set<string>();
    for (const name of names) {
      if (exact.has(name) || folded.has(name.toLowerCase())) {
        context.addIssue({
          code: "custom",
          message: "Skill names must be unique, including case-folded.",
        });
        return;
      }
      exact.add(name);
      folded.add(name.toLowerCase());
    }
  });

const harnessIdsSchema = z
  .array(z.string().min(1).max(128))
  .min(1)
  .max(HARNESS_IDS.length)
  .superRefine((harnessIds, context) => {
    const normalized = normalizeHarnessIds(harnessIds);
    if (
      !normalized.ok ||
      JSON.stringify(normalized.value) !== JSON.stringify(harnessIds)
    ) {
      context.addIssue({
        code: "custom",
        message: "Harness IDs must be registry IDs in registry order.",
      });
    }
  });

/**
 * Portable Source Descriptor for v1. GitHub `owner/repository` matches the
 * only Add source the Local tracer accepts today; other stable kinds arrive
 * with the ADR 0015 inspection work and must extend this closed union.
 */
export const skillpackSourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      owner: z
        .string()
        .min(1)
        .max(39)
        .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/),
      repository: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[A-Za-z0-9._-]+$/),
      revision: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .optional(),
      type: z.literal("github"),
    })
    .strict(),
]);

const noControlCharacters = (value: string) =>
  ![...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });

export const skillpackPackageSchema = z
  .object({
    compatibility: z
      .object({
        dialectId: z.literal(SKILLS_DIALECT_ID),
        harnessIds: harnessIdsSchema,
      })
      .strict(),
    description: z.string().max(2_048).refine(noControlCharacters, {
      message: "Description must not contain control characters.",
    }),
    id: packageIdSchema,
    release: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    skills: skillNamesSchema,
    source: skillpackSourceSchema,
    title: z.string().min(1).max(256).refine(noControlCharacters, {
      message: "Title must not contain control characters.",
    }),
  })
  .strict();

export const skillpackDocumentSchema = z
  .object({
    documentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    kind: z.literal(SKILLPACK_KIND),
    package: skillpackPackageSchema,
    schemaVersion: z.literal(SKILLPACK_SCHEMA_VERSION),
  })
  .strict();

export type SkillpackSource = z.infer<typeof skillpackSourceSchema>;
export type SkillpackPackage = z.infer<typeof skillpackPackageSchema>;
export type SkillpackDocument = z.infer<typeof skillpackDocumentSchema>;

export type SkillpackErrorCode =
  | "digest_mismatch"
  | "invalid_document"
  | "invalid_encoding"
  | "invalid_json"
  | "non_canonical"
  | "unsupported_schema";

export type SkillpackError = PublicError<SkillpackErrorCode> & {
  readonly path?: string;
};

export interface SkillpackCodec {
  sha256Hex(bytes: Uint8Array): string;
}

type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function failure(
  code: SkillpackErrorCode,
  message: string,
  path?: string,
): Result<never, SkillpackError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "import",
      retryable: false,
      ...(path === undefined ? {} : { path }),
    },
    ok: false,
  };
}

function compareUtf16(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/**
 * RFC 8785 canonical serialization: members sorted by UTF-16 code units,
 * no insignificant whitespace, ES number and string serialization. Throws on
 * values JSON cannot represent (undefined, NaN, Infinity, functions).
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("Non-finite numbers cannot be canonicalized.");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new Error(`Cannot canonicalize a ${typeof value}.`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareUtf16)
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`);
  return `{${members.join(",")}}`;
}

const encoder = new TextEncoder();

export function canonicalSkillpackBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalizeJson(value));
}

/** SHA-256 over the canonical `{kind, schemaVersion, package}` bytes. */
export function skillpackDocumentDigest(
  pkg: SkillpackPackage,
  codec: SkillpackCodec,
): `sha256:${string}` {
  const hex = codec.sha256Hex(
    canonicalSkillpackBytes({
      kind: SKILLPACK_KIND,
      package: pkg,
      schemaVersion: SKILLPACK_SCHEMA_VERSION,
    }),
  );
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error("Codec returned a malformed SHA-256 digest.");
  }
  return `sha256:${hex}`;
}

/** Validates a package and returns the canonical bytes of its envelope. */
export function serializeSkillpack(
  pkg: SkillpackPackage,
  codec: SkillpackCodec,
): Result<{ readonly bytes: Uint8Array; readonly document: SkillpackDocument }, SkillpackError> {
  const parsed = skillpackPackageSchema.safeParse(pkg);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failure(
      "invalid_document",
      issue?.message ?? "Package did not pass validation.",
      issue?.path.map(String).join("."),
    );
  }
  const document: SkillpackDocument = {
    documentDigest: skillpackDocumentDigest(parsed.data, codec),
    kind: SKILLPACK_KIND,
    package: parsed.data,
    schemaVersion: SKILLPACK_SCHEMA_VERSION,
  };
  const bytes = canonicalSkillpackBytes(document);
  if (bytes.length > SKILLPACK_MAX_BYTES) {
    return failure("invalid_document", "Package exceeds 1 MiB.");
  }
  return { ok: true, value: { bytes, document } };
}

/**
 * Minimal strict JSON reader. Unlike JSON.parse it rejects duplicate object
 * keys, which RFC 8785 documents never contain, and bounds nesting depth.
 */
class StrictJsonReader {
  private index = 0;

  constructor(private readonly text: string) {}

  read(): Result<JsonValue, SkillpackError> {
    try {
      this.skipWhitespace();
      const value = this.value(0);
      this.skipWhitespace();
      if (this.index !== this.text.length) {
        throw new SyntaxError("Unexpected trailing characters.");
      }
      return { ok: true, value };
    } catch (error) {
      return failure(
        "invalid_json",
        error instanceof Error ? error.message : "Invalid JSON.",
      );
    }
  }

  private skipWhitespace() {
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === " " || character === "\n" || character === "\r" || character === "\t") {
        this.index += 1;
      } else {
        break;
      }
    }
  }

  private value(depth: number): JsonValue {
    if (depth > 16) throw new SyntaxError("JSON nesting is too deep.");
    const character = this.text[this.index];
    if (character === "{") return this.object(depth);
    if (character === "[") return this.array(depth);
    if (character === '"') return this.string();
    if (this.text.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (this.text.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (this.text.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    return this.number();
  }

  private object(depth: number): JsonValue {
    this.index += 1;
    const result: { [key: string]: JsonValue } = {};
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') {
        throw new SyntaxError("Expected an object key.");
      }
      const key = this.string();
      if (Object.hasOwn(result, key) || key === "__proto__") {
        throw new SyntaxError(`Duplicate or forbidden key "${key}".`);
      }
      this.skipWhitespace();
      if (this.text[this.index] !== ":") throw new SyntaxError("Expected ':'.");
      this.index += 1;
      this.skipWhitespace();
      result[key] = this.value(depth + 1);
      this.skipWhitespace();
      const next = this.text[this.index];
      this.index += 1;
      if (next === "}") return result;
      if (next !== ",") throw new SyntaxError("Expected ',' or '}'.");
    }
  }

  private array(depth: number): JsonValue {
    this.index += 1;
    const result: JsonValue[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      result.push(this.value(depth + 1));
      this.skipWhitespace();
      const next = this.text[this.index];
      this.index += 1;
      if (next === "]") return result;
      if (next !== ",") throw new SyntaxError("Expected ',' or ']'.");
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === "\\") {
        this.index += 2;
        continue;
      }
      if (character === '"') {
        this.index += 1;
        return JSON.parse(this.text.slice(start, this.index)) as string;
      }
      if ((character?.charCodeAt(0) ?? 0) < 0x20) {
        throw new SyntaxError("Unescaped control character in string.");
      }
      this.index += 1;
    }
    throw new SyntaxError("Unterminated string.");
  }

  private number(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.index, this.index + 64),
    );
    if (match === null) throw new SyntaxError("Unexpected token.");
    this.index += match[0].length;
    return Number(match[0]);
  }
}

/**
 * Reads `.skillpack` bytes: bounded size, no BOM, strict UTF-8, strict JSON
 * without duplicate keys, exact schema, canonical bytes, and a matching
 * digest. Every failure is closed and names the offending path when known.
 */
export function parseSkillpack(
  bytes: Uint8Array,
  codec: SkillpackCodec,
): Result<SkillpackDocument, SkillpackError> {
  if (bytes.length > SKILLPACK_MAX_BYTES) {
    return failure("invalid_encoding", "Skillpack exceeds 1 MiB.");
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return failure("invalid_encoding", "Skillpack must not start with a BOM.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return failure("invalid_encoding", "Skillpack is not valid UTF-8.");
  }
  const json = new StrictJsonReader(text).read();
  if (!json.ok) return json;
  const raw = json.value;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return failure("invalid_document", "Skillpack must be a JSON object.");
  }
  if (raw.kind !== SKILLPACK_KIND) {
    return failure("unsupported_schema", "This file is not a skillpack.", "kind");
  }
  if (raw.schemaVersion !== SKILLPACK_SCHEMA_VERSION) {
    return failure(
      "unsupported_schema",
      typeof raw.schemaVersion === "number" && raw.schemaVersion > SKILLPACK_SCHEMA_VERSION
        ? "This skillpack was written by a newer, unsupported schema."
        : "Unsupported skillpack schema version.",
      "schemaVersion",
    );
  }
  const parsed = skillpackDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failure(
      "invalid_document",
      issue?.message ?? "Skillpack did not pass validation.",
      issue?.path.map(String).join("."),
    );
  }
  const canonical = canonicalizeJson(parsed.data);
  if (canonical !== text) {
    return failure(
      "non_canonical",
      "Skillpack bytes are not RFC 8785 canonical JSON.",
    );
  }
  const expected = skillpackDocumentDigest(parsed.data.package, codec);
  if (expected !== parsed.data.documentDigest) {
    return failure(
      "digest_mismatch",
      "Skillpack documentDigest does not match its canonical package bytes.",
      "documentDigest",
    );
  }
  return { ok: true, value: parsed.data };
}

export type SkillpackRelation =
  | { readonly kind: "conflict" }
  | { readonly kind: "downgrade"; readonly fromRelease: number; readonly toRelease: number }
  | { readonly kind: "identical" }
  | { readonly kind: "new" }
  | { readonly kind: "upgrade"; readonly fromRelease: number; readonly toRelease: number };

/**
 * Relates an incoming package to an already-imported one with the same ID:
 * same release and digest is idempotent, same release with a different digest
 * is a retained conflict, and different releases are explicit deltas.
 */
export function relateSkillpack(
  incoming: SkillpackDocument,
  existing: SkillpackDocument | undefined,
): SkillpackRelation {
  if (existing === undefined || existing.package.id !== incoming.package.id) {
    return { kind: "new" };
  }
  if (existing.package.release === incoming.package.release) {
    return existing.documentDigest === incoming.documentDigest
      ? { kind: "identical" }
      : { kind: "conflict" };
  }
  return incoming.package.release > existing.package.release
    ? {
        fromRelease: existing.package.release,
        kind: "upgrade",
        toRelease: incoming.package.release,
      }
    : {
        fromRelease: existing.package.release,
        kind: "downgrade",
        toRelease: incoming.package.release,
      };
}
