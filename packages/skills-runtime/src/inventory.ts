import { z } from "zod";

import type { PublicError, Result } from "./result.js";

export const CLI_PACKAGE = "skills@1.5.23" as const;
export const CLI_VERSION = "1.5.23" as const;
export const INVENTORY_SCHEMA_VERSION = 1 as const;
export const MAX_CLI_OUTPUT_BYTES = 8 * 1024 * 1024;

const MAX_ENTRIES = 5_000;
const MAX_EXTENSION_FIELDS = 16;
const MAX_EXTENSION_BYTES = 64 * 1024;
const MAX_EXTENSION_DEPTH = 8;
const MAX_EXTENSION_NODES = 2_048;
const KNOWN_FIELDS = new Set([
  "agents",
  "name",
  "path",
  "scope",
  "source",
  "sourceType",
  "sourceUrl",
]);

export type InventoryScope = "global" | "project";

export type UnknownEvidence = { readonly status: "unknown" };
export interface KnownEvidence {
  readonly authority: string;
  readonly kind: string;
  readonly status: "known";
  readonly value: string;
}
export type InventoryEvidence = KnownEvidence | UnknownEvidence;

export interface NormalizedSkill {
  readonly agents: readonly string[];
  readonly contentFingerprint: InventoryEvidence;
  readonly declaredSource: {
    readonly source: string | null;
    readonly sourceType: string | null;
  };
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly path: string;
  readonly revision: InventoryEvidence;
  readonly scope: InventoryScope;
  readonly sourceUrl: string | null;
}

export interface Inventory {
  readonly cliVersion: typeof CLI_VERSION;
  readonly entries: readonly NormalizedSkill[];
  readonly observedAt: string;
  readonly schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
}

export type InventoryParseError = PublicError<
  | "conflicting_inventory_entry"
  | "duplicate_inventory_entry"
  | "invalid_inventory"
  | "inventory_too_large"
  | "unsupported_schema"
>;

const boundedString = (maximum: number) => z.string().min(1).max(maximum);

const cliSkillSchema = z
  .object({
    agents: z.array(boundedString(128)).max(256),
    name: boundedString(256),
    path: boundedString(8_192),
    scope: z.enum(["project", "global"]),
    source: boundedString(2_048).nullable(),
    sourceType: boundedString(128).nullable(),
    sourceUrl: boundedString(8_192).nullable(),
  })
  .passthrough();

function failure(
  code: InventoryParseError["code"],
  message: string,
): Result<never, InventoryParseError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "parse",
      retryable: false,
    },
    ok: false,
  };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}

function extensionEnvelope(
  input: Record<string, unknown>,
): Result<Readonly<Record<string, unknown>>, InventoryParseError> {
  const extensions = Object.fromEntries(
    Object.entries(input).filter(([key]) => !KNOWN_FIELDS.has(key)),
  );

  if (Object.keys(extensions).length > MAX_EXTENSION_FIELDS) {
    return failure(
      "unsupported_schema",
      "Inventory contains too many additive fields.",
    );
  }

  if (utf8ByteLength(JSON.stringify(extensions)) > MAX_EXTENSION_BYTES) {
    return failure(
      "inventory_too_large",
      "Inventory additive evidence exceeds its limit.",
    );
  }

  let nodes = 0;
  const withinStructuralLimits = (value: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_EXTENSION_NODES || depth > MAX_EXTENSION_DEPTH)
      return false;
    if (Array.isArray(value)) {
      return value.every((item) => withinStructuralLimits(item, depth + 1));
    }
    if (typeof value === "object" && value !== null) {
      return Object.values(value).every((item) =>
        withinStructuralLimits(item, depth + 1),
      );
    }
    return true;
  };
  if (!withinStructuralLimits(extensions, 0)) {
    return failure(
      "unsupported_schema",
      "Inventory additive evidence is too deeply structured.",
    );
  }

  return { ok: true, value: extensions };
}

export function parseCliInventory(
  output: string,
  expectedScope: InventoryScope,
): Result<readonly NormalizedSkill[], InventoryParseError> {
  if (utf8ByteLength(output) > MAX_CLI_OUTPUT_BYTES) {
    return failure(
      "inventory_too_large",
      "Inventory output exceeds the supported limit.",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(output);
  } catch {
    return failure("invalid_inventory", "Inventory output is not valid JSON.");
  }

  if (!Array.isArray(decoded) || decoded.length > MAX_ENTRIES) {
    return failure(
      "invalid_inventory",
      "Inventory output is not a supported list.",
    );
  }

  const normalized: NormalizedSkill[] = [];
  const identitiesByReportedName = new Map<string, string>();
  for (const candidate of decoded) {
    const parsed = cliSkillSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.scope !== expectedScope) {
      return failure(
        "invalid_inventory",
        "Inventory entry does not match the supported schema.",
      );
    }

    const extensions = extensionEnvelope(parsed.data);
    if (!extensions.ok) return extensions;

    const reportedName = parsed.data.name;
    const identity = `${parsed.data.sourceType ?? ""}\0${parsed.data.source ?? ""}`;
    const priorIdentity = identitiesByReportedName.get(reportedName);
    if (priorIdentity !== undefined) {
      return priorIdentity === identity
        ? failure(
            "duplicate_inventory_entry",
            "Inventory contains a duplicate Skill Identity.",
          )
        : failure(
            "conflicting_inventory_entry",
            "Inventory contains conflicting provenance for one skill.",
          );
    }
    identitiesByReportedName.set(reportedName, identity);

    normalized.push({
      agents: parsed.data.agents,
      contentFingerprint: { status: "unknown" },
      declaredSource: {
        source: parsed.data.source,
        sourceType: parsed.data.sourceType,
      },
      extensions: extensions.value,
      name: parsed.data.name,
      path: parsed.data.path,
      revision: { status: "unknown" },
      scope: parsed.data.scope,
      sourceUrl: parsed.data.sourceUrl,
    });
  }

  return { ok: true, value: normalized };
}
