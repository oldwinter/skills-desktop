import { z } from "zod";

import {
  commandPlanSchema,
  rendererErrorSchema,
  targetDefinitionSchema,
  workspaceRequestResultSchema,
  type WorkspaceRequestResult,
} from "./workspace.js";

const reviewProjectionSchema = z
  .object({
    commandPlan: commandPlanSchema,
    expiresAt: z.string().datetime({ offset: true }),
    purpose: z.enum(["cancel", "execute"]),
    reviewId: z.string().min(1).max(256),
    target: targetDefinitionSchema,
  })
  .strict();

export const reviewSnapshotSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        schemaVersion: z.literal(1),
        status: z.literal("unavailable"),
      })
      .strict(),
    z
      .object({
        projection: reviewProjectionSchema,
        schemaVersion: z.literal(1),
        status: z.literal("pending"),
      })
      .strict(),
    z
      .object({
        decision: z.enum(["approve", "reject"]),
        schemaVersion: z.literal(1),
        status: z.literal("settled"),
      })
      .strict(),
  ]);

export type ReviewSnapshot = z.infer<typeof reviewSnapshotSchema>;

export const reviewSnapshotResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: reviewSnapshotSchema }).strict(),
  z.object({ error: rendererErrorSchema, ok: z.literal(false) }).strict(),
]);

export type ReviewSnapshotResult = z.infer<typeof reviewSnapshotResultSchema>;

export const reviewDecisionRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    type: z.literal("review.decide"),
    version: z.literal(1),
  })
  .strict();

export type ReviewDecisionResult = WorkspaceRequestResult;
export const reviewDecisionResultSchema = workspaceRequestResultSchema;

export interface ReviewBridge {
  approve(): Promise<ReviewDecisionResult>;
  getReview(): Promise<ReviewSnapshotResult>;
  reject(): Promise<ReviewDecisionResult>;
}
