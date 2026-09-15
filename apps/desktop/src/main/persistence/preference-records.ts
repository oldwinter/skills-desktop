import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { z } from "zod";

import {
  storedPreferencesSchema,
  type StoredPreferences,
} from "../../contracts/preferences.js";

const MAX_RECORD_BYTES = 4_096;
const DOCUMENT_KIND = "preferences";

const preferencesDocumentSchema = z
  .object({
    kind: z.literal(DOCUMENT_KIND),
    preferences: storedPreferencesSchema,
    schemaVersion: z.literal(1),
  })
  .strict();

export type PreferenceLoadResult =
  | { readonly status: "absent" }
  | { readonly status: "loaded"; readonly value: StoredPreferences }
  /** The file was unreadable or invalid; it was moved aside, not deleted. */
  | { readonly reason: string; readonly status: "quarantined" };

export interface PreferenceRecords {
  load(): Promise<PreferenceLoadResult>;
  save(preferences: StoredPreferences): Promise<void>;
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function validateFileIdentity(identity: string) {
  if (!/^[0-9A-Za-z-]{1,128}$/.test(identity)) {
    throw new Error("Preference file identity is invalid.");
  }
  return identity;
}

async function syncDirectory(directory: string, platform: NodeJS.Platform) {
  if (platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Durable ADR 0023 preference record. Writes are atomic (temp file + rename);
 * an unreadable record is quarantined beside the original so a corrupt file
 * never blocks startup and never silently resets to defaults on disk.
 */
export function createJsonPreferenceRecords(input: {
  readonly id: () => string;
  readonly path: string;
  readonly platform?: NodeJS.Platform;
}): PreferenceRecords {
  const directory = dirname(input.path);
  const platform = input.platform ?? process.platform;

  const quarantine = async (reason: string): Promise<PreferenceLoadResult> => {
    const quarantineId = validateFileIdentity(input.id());
    const quarantinePath = resolve(
      directory,
      `${basename(input.path)}.corrupt.${quarantineId}`,
    );
    try {
      await rename(input.path, quarantinePath);
      await syncDirectory(directory, platform);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        return {
          reason: `${reason} The invalid file could not be quarantined.`,
          status: "quarantined",
        };
      }
    }
    return { reason, status: "quarantined" };
  };

  return {
    async load() {
      let source: string;
      try {
        const metadata = await stat(input.path);
        if (!metadata.isFile() || metadata.size > MAX_RECORD_BYTES) {
          return quarantine("Preference state is not a small regular file.");
        }
        source = await readFile(input.path, "utf8");
      } catch (error) {
        if (errorCode(error) === "ENOENT") return { status: "absent" };
        return quarantine("Preference state is unreadable.");
      }
      let value: unknown;
      try {
        value = JSON.parse(source);
      } catch {
        return quarantine("Preference state is not valid JSON.");
      }
      if (
        typeof value === "object" &&
        value !== null &&
        "schemaVersion" in value &&
        typeof value.schemaVersion === "number" &&
        value.schemaVersion > 1
      ) {
        return quarantine("Preference state uses a newer schema.");
      }
      const parsed = preferencesDocumentSchema.safeParse(value);
      if (!parsed.success) {
        return quarantine("Preference state does not match the schema.");
      }
      return { status: "loaded", value: parsed.data.preferences };
    },
    async save(preferences) {
      const document = preferencesDocumentSchema.parse({
        kind: DOCUMENT_KIND,
        preferences,
        schemaVersion: 1,
      });
      const source = `${JSON.stringify(document, null, 2)}\n`;
      if (Buffer.byteLength(source, "utf8") > MAX_RECORD_BYTES) {
        throw new Error("Preference state is too large.");
      }
      const writeId = validateFileIdentity(input.id());
      await mkdir(directory, { recursive: true });
      const temporaryPath = resolve(
        directory,
        `.${basename(input.path)}.${writeId}.tmp`,
      );
      let replaced = false;
      try {
        const handle = await open(temporaryPath, "wx", 0o600);
        try {
          await handle.writeFile(source, { encoding: "utf8" });
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporaryPath, input.path);
        replaced = true;
        await syncDirectory(directory, platform);
      } finally {
        if (!replaced) await rm(temporaryPath, { force: true });
      }
    },
  };
}

/** In-memory records for tests and for the unavailable-store fallback. */
export function createMemoryPreferenceRecords(
  initial?: StoredPreferences,
): PreferenceRecords & { readonly saved: StoredPreferences[] } {
  let current = initial;
  const saved: StoredPreferences[] = [];
  return {
    async load() {
      return current === undefined
        ? { status: "absent" }
        : { status: "loaded", value: current };
    },
    saved,
    async save(preferences) {
      current = preferences;
      saved.push(preferences);
    },
  };
}
