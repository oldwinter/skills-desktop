import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { z } from "zod";

import {
  releaseCandidateIdentitySchema,
  type ReleaseCandidateIdentity,
} from "../../contracts/about.js";

const MAX_RECORD_BYTES = 4_096;
const DOCUMENT_KIND = "deferred-update";

class UnsupportedDeferredUpdateSchemaError extends Error {}

const deferredUpdateDocumentSchema = z
  .object({
    candidate: releaseCandidateIdentitySchema,
    downloadedAt: z.string().datetime({ offset: true }),
    kind: z.literal(DOCUMENT_KIND),
    runningVersion: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    schemaVersion: z.literal(1),
  })
  .strict();

export interface DeferredUpdateRecord {
  readonly candidate: ReleaseCandidateIdentity;
  readonly downloadedAt: string;
  readonly runningVersion: string;
}

export interface DeferredUpdateRecords {
  clear(): Promise<void>;
  load(): Promise<DeferredUpdateRecord | null>;
  save(record: DeferredUpdateRecord): Promise<void>;
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

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function validateFileIdentity(identity: string) {
  if (!/^[0-9A-Za-z-]{1,128}$/.test(identity)) {
    throw new Error("Deferred update file identity is invalid.");
  }
  return identity;
}

async function hasQuarantinedRecord(directory: string, fileName: string) {
  try {
    const quarantinePrefix = `${fileName}.corrupt.`;
    return (await readdir(directory)).some((name) =>
      name.startsWith(quarantinePrefix),
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw new Error("Deferred update quarantine state is unreadable.", {
      cause: error,
    });
  }
}

function parseDocument(source: string) {
  const value: unknown = JSON.parse(source);
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "number" &&
    value.schemaVersion > 1
  ) {
    throw new UnsupportedDeferredUpdateSchemaError(
      "Deferred update state uses a newer schema.",
    );
  }
  return deferredUpdateDocumentSchema.parse(value);
}

export function createJsonDeferredUpdateRecords(input: {
  readonly id: () => string;
  readonly path: string;
  readonly platform?: NodeJS.Platform;
}): DeferredUpdateRecords {
  const directory = dirname(input.path);
  const platform = input.platform ?? process.platform;

  return {
    async clear() {
      try {
        await rm(input.path);
        await syncDirectory(directory, platform);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    },
    async load() {
      try {
        const metadata = await stat(input.path);
        if (!metadata.isFile() || metadata.size > MAX_RECORD_BYTES) {
          throw new Error("Deferred update state is invalid.");
        }
        const source = await readFile(input.path, "utf8");
        const {
          kind: _kind,
          schemaVersion: _schemaVersion,
          ...record
        } = parseDocument(source);
        return record;
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          if (await hasQuarantinedRecord(directory, basename(input.path))) {
            throw new Error("Deferred update state is quarantined.");
          }
          return null;
        }
        if (error instanceof UnsupportedDeferredUpdateSchemaError) throw error;
        const quarantineId = validateFileIdentity(input.id());
        const quarantinePath = resolve(
          directory,
          `${basename(input.path)}.corrupt.${quarantineId}`,
        );
        try {
          await rename(input.path, quarantinePath);
          await syncDirectory(directory, platform);
        } catch (quarantineError) {
          throw new Error("Invalid deferred update state could not be quarantined.", {
            cause: quarantineError,
          });
        }
        throw new Error("Invalid deferred update state was quarantined.", {
          cause: error,
        });
      }
    },
    async save(record) {
      const document = deferredUpdateDocumentSchema.parse({
        ...record,
        kind: DOCUMENT_KIND,
        schemaVersion: 1,
      });
      const source = `${JSON.stringify(document, null, 2)}\n`;
      if (Buffer.byteLength(source, "utf8") > MAX_RECORD_BYTES) {
        throw new Error("Deferred update state is too large.");
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
