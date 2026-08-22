import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const updateCheckDocumentSchema = z
  .object({
    lastCheckAt: z.string().datetime({ offset: true }),
    schemaVersion: z.literal(1),
  })
  .strict();

export function createJsonUpdateCheckRecords(input: {
  readonly path: string;
}) {
  return {
    async load() {
      let source: string;
      try {
        source = await readFile(input.path, "utf8");
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }
        throw error;
      }
      return updateCheckDocumentSchema.parse(JSON.parse(source)).lastCheckAt;
    },
    async save(lastCheckAt: string) {
      const document = updateCheckDocumentSchema.parse({
        lastCheckAt,
        schemaVersion: 1,
      });
      await mkdir(dirname(input.path), { mode: 0o700, recursive: true });
      const temporaryPath = `${input.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(
          temporaryPath,
          `${JSON.stringify(document, null, 2)}\n`,
          { flag: "wx", mode: 0o600 },
        );
        await rename(temporaryPath, input.path);
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    },
  };
}
