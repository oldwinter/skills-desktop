import { z } from "zod";

import { publicationPlanV1Schema } from "@skills-desktop/skills-runtime";

import { publicPreferencesSchema } from "./preferences.js";
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

/**
 * ADR 0020 `publication-push`: the sealed plan is the whole projection. The
 * review window shows remote, exact branch, base or unborn state, candidate
 * commit, every managed path and digest, tree digest, expiry, and plan
 * digest; approval revalidates all of it in main before any Git transport.
 */
export const publicationReviewProjectionSchema = z
  .object({
    expiresAt: z.string().datetime({ offset: true }),
    plan: publicationPlanV1Schema,
    purpose: z.literal("publication-push"),
    reviewId: z.string().min(1).max(256),
  })
  .strict();

/**
 * The Trusted Review window renders in the same locale and appearance as the
 * workspace. Main projects the preferences alongside every review state so
 * the isolated review renderer never has to ask a second authority.
 */
export const reviewSnapshotSchema = z.discriminatedUnion("status", [
  z
    .object({
      preferences: publicPreferencesSchema.optional(),
      schemaVersion: z.literal(REVIEW_PROTOCOL_VERSION),
      status: z.literal("unavailable"),
    })
    .strict(),
  z
    .object({
      preferences: publicPreferencesSchema.optional(),
      projection: z.union([
        reviewProjectionSchema,
        hostTrustReviewProjectionSchema,
        collectionReviewProjectionSchema,
        publicationReviewProjectionSchema,
      ]),
      schemaVersion: z.literal(REVIEW_PROTOCOL_VERSION),
      status: z.literal("pending"),
    })
    .strict(),
  z
    .object({
      decision: z.enum(["approve", "reject"]),
      preferences: publicPreferencesSchema.optional(),
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
