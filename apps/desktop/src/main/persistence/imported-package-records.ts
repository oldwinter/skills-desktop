import { z } from "zod";

import { skillpackDocumentSchema } from "@skills-desktop/skills-runtime";

export const IMPORTED_PACKAGE_SCHEMA_VERSION = 1 as const;
export const MAX_IMPORTED_PACKAGES = 1_000;
export const MAX_RETAINED_PACKAGE_CONFLICTS = 64;

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const instantSchema = z.string().datetime({ offset: true });

/**
 * Package store v1 record (ADR 0017). One record per package ID holds the
 * current canonical `.skillpack` document, when it was imported, the last
 * explicit release delta, and every retained same-release digest conflict.
 * Nothing here claims a Skill is installed; only CLI Inventory can.
 */
export const importedPackageRecordSchema = z
  .object({
    conflicts: z
      .array(
        z
          .object({
            documentDigest: digestSchema,
            recordedAt: instantSchema,
            release: z.number().int().positive(),
          })
          .strict(),
      )
      .max(MAX_RETAINED_PACKAGE_CONFLICTS),
    delta: z
      .object({
        fromRelease: z.number().int().positive(),
        kind: z.enum(["downgrade", "upgrade"]),
        recordedAt: instantSchema,
        toRelease: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    document: skillpackDocumentSchema,
    importedAt: instantSchema,
  })
  .strict();

export const importedPackageRecordsSchema = z
  .array(importedPackageRecordSchema)
  .max(MAX_IMPORTED_PACKAGES)
  .superRefine((records, context) => {
    const ids = new Set(records.map(({ document }) => document.package.id));
    if (ids.size !== records.length) {
      context.addIssue({
        code: "custom",
        message: "Imported Package IDs must be unique.",
      });
    }
  });

export type ImportedPackageRecord = z.infer<typeof importedPackageRecordSchema>;
