import { z } from "zod";

import { publicationPlanV1Schema } from "@skills-desktop/skills-runtime";

/**
 * Publication Guard v1 (ADR 0020). Main commits the Guard before the exact
 * fast-forward push starts and clears it only after a known readback
 * (`published`, `not-published`, or `diverged`). An `uncertain` readback keeps
 * the Guard, blocks any second push, and survives restart so reconciliation
 * can read the remote again. The Guard carries the full sealed plan so
 * readback after restart needs nothing from the renderer.
 */
export const PUBLICATION_GUARD_SCHEMA_VERSION = 1 as const;

export const publicationGuardRecordSchema = z
  .object({
    committedAt: z.string().datetime({ offset: true }),
    lastReadback: z
      .enum(["diverged", "not-published", "published", "uncertain"])
      .nullable(),
    lastReadbackAt: z.string().datetime({ offset: true }).nullable(),
    phase: z.enum(["pushing", "uncertain"]),
    plan: publicationPlanV1Schema,
  })
  .strict();

export type PublicationGuardRecord = z.infer<
  typeof publicationGuardRecordSchema
>;
