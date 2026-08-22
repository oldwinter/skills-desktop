import {
  mkdir,
  open,
  readFile,
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

const deferredUpdateDocumentSchema = z
  .object({
    candidate: releaseCandidateIdentitySchema,
    downloadedAt: z.string().datetime({ offset: true }),
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
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
    async load() {
      try {
        const metadata = await stat(input.path);
        if (!metadata.isFile() || metadata.size > MAX_RECORD_BYTES) {
          throw new Error("Deferred update state is invalid.");
        }
        const source = await readFile(input.path, "utf8");
        const { schemaVersion: _schemaVersion, ...record } =
          deferredUpdateDocumentSchema.parse(JSON.parse(source));
        return record;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(record) {
      const document = deferredUpdateDocumentSchema.parse({
        ...record,
        schemaVersion: 1,
      });
      const source = `${JSON.stringify(document, null, 2)}\n`;
      if (Buffer.byteLength(source, "utf8") > MAX_RECORD_BYTES) {
        throw new Error("Deferred update state is too large.");
      }
      const writeId = input.id();
      if (!/^[0-9A-Za-z-]{1,128}$/.test(writeId)) {
        throw new Error("Deferred update write identity is invalid.");
      }
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
