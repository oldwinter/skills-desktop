import { z } from "zod";

import {
  commandPlanSchema,
  publicCollectionPlanSchema,
  rendererErrorSchema,
  targetDefinitionSchema,
  workspaceRequestResultSchema,
  type WorkspaceRequestResult,
} from "./workspace.js";

export const REVIEW_PROTOCOL_VERSION = 2 as const;

export const reviewProjectionSchema = z
  .object({
    commandPlan: commandPlanSchema,
    expiresAt: z.string().datetime({ offset: true }),
    purpose: z.enum(["cancel", "execute"]),
    reviewId: z.string().min(1).max(256),
    target: targetDefinitionSchema,
  })
  .strict();

export const hostTrustReviewProjectionSchema = z
  .object({
    algorithm: z.string().min(1).max(128),
    expiresAt: z.string().datetime({ offset: true }),
    fingerprint: z.string().min(1).max(256),
    identity: z.string().min(1).max(2_048),
    reviewId: z.string().min(1).max(256),
    target: targetDefinitionSchema,
    trustAction: z.enum(["first-use", "rotation"]),
  })
  .strict();

export const collectionReviewProjectionSchema = z
  .object({
    collectionPlan: publicCollectionPlanSchema,
    expiresAt: z.string().datetime({ offset: true }),
    reviewId: z.string().min(1).max(256),
    target: targetDefinitionSchema,
  })
  .strict();

export const reviewSnapshotSchema = z.discriminatedUnion("status", [
  z
    .object({
      schemaVersion: z.literal(REVIEW_PROTOCOL_VERSION),
      status: z.literal("unavailable"),
    })
    .strict(),
  z
    .object({
      projection: z.union([
        reviewProjectionSchema,
        hostTrustReviewProjectionSchema,
        collectionReviewProjectionSchema,
      ]),
      schemaVersion: z.literal(REVIEW_PROTOCOL_VERSION),
      status: z.literal("pending"),
    })
    .strict(),
  z
    .object({
      decision: z.enum(["approve", "reject"]),
      schemaVersion: z.literal(REVIEW_PROTOCOL_VERSION),
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
    version: z.literal(REVIEW_PROTOCOL_VERSION),
  })
  .strict();

export type ReviewDecisionResult = WorkspaceRequestResult;
export const reviewDecisionResultSchema = workspaceRequestResultSchema;

export interface ReviewBridge {
  approve(): Promise<ReviewDecisionResult>;
  getReview(): Promise<ReviewSnapshotResult>;
  reject(): Promise<ReviewDecisionResult>;
}
