import { z } from "zod";

import { rendererErrorSchema } from "./workspace.js";

export const reviewSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("unavailable"),
  })
  .strict();

export type ReviewSnapshot = z.infer<typeof reviewSnapshotSchema>;

export const reviewSnapshotResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: reviewSnapshotSchema }).strict(),
  z.object({ error: rendererErrorSchema, ok: z.literal(false) }).strict(),
]);

export type ReviewSnapshotResult = z.infer<typeof reviewSnapshotResultSchema>;

export interface ReviewBridge {
  getReview(): Promise<ReviewSnapshotResult>;
}
