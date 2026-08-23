import { z } from "zod";

import {
  applicationIdentitySchema,
  updatePolicySchema,
  updateStateSchema,
} from "./about-update-contracts.js";

export {
  ABOUT_MANUAL_UPDATE_MESSAGE,
  ABOUT_RELEASES_URL,
  ABOUT_UNAVAILABLE_UPDATE_MESSAGE,
  ABOUT_UNSIGNED_MANUAL_UPDATE_MESSAGE,
} from "./about-update-contracts.js";

export const aboutUpdateCheckRequestSchema = z
  .object({
    type: z.literal("update.check"),
    version: z.literal(1),
  })
  .strict();

export const aboutUpdateRestartRequestSchema = z
  .object({
    candidateId: z.string().uuid(),
    type: z.literal("update.restart"),
    version: z.literal(1),
  })
  .strict();

export const aboutDiagnosticsExportRequestSchema = z
  .object({
    type: z.literal("release-diagnostics.export"),
    version: z.literal(1),
  })
  .strict();

export const releaseCandidateIdentitySchema = z
  .object({
    architecture: z.string().trim().min(1).max(32),
    id: z.string().uuid(),
    platform: z.string().trim().min(1).max(32),
    version: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^\d+\.\d+\.\d+$/),
  })
  .strict();

export const restartGuardReasonSchema = z.enum([
  "mutation-active",
  "protected-process-active",
  "trusted-review-active",
  "reconciliation-required",
  "recovery-uncertain",
]);

const restartStatusSchema = z
  .object({
    guardReasons: z
      .array(restartGuardReasonSchema)
      .max(restartGuardReasonSchema.options.length)
      .refine((reasons) => new Set(reasons).size === reasons.length),
    immediateRestartAvailable: z.boolean(),
    kind: z.enum(["none", "deferred", "blocked", "restarting"]),
  })
  .strict()
  .superRefine((restart, context) => {
    const blocked = restart.guardReasons.length > 0;
    if ((restart.kind === "blocked") !== blocked) {
      context.addIssue({
        code: "custom",
        message: "Restart blocking state and guard reasons must agree.",
        path: ["guardReasons"],
      });
    }
    if (
      restart.immediateRestartAvailable &&
      (restart.kind !== "deferred" || blocked)
    ) {
      context.addIssue({
        code: "custom",
        message: "Immediate restart is available only for an unblocked candidate.",
        path: ["immediateRestartAvailable"],
      });
    }
  });

function validatePlatformState(
  snapshot: {
    readonly lastCheckAt: string | null;
    readonly nextAutomaticCheckAt: string | null;
    readonly policy: z.infer<typeof updatePolicySchema>;
    readonly state: z.infer<typeof updateStateSchema>;
  },
  context: z.RefinementCtx,
) {
  if (snapshot.policy.mode === "automatic") {
    if (["manual", "unavailable"].includes(snapshot.state.kind)) {
      context.addIssue({
        code: "custom",
        message: "Automatic policy requires an automatic update state.",
        path: ["state"],
      });
    }
    return;
  }
  if (snapshot.state.kind !== snapshot.policy.mode) {
    context.addIssue({
      code: "custom",
      message: "Platform guidance and update state must agree.",
      path: ["state"],
    });
  }
  if (snapshot.lastCheckAt !== null || snapshot.nextAutomaticCheckAt !== null) {
    context.addIssue({
      code: "custom",
      message: "Platforms without updater authority cannot report checks.",
      path: ["nextAutomaticCheckAt"],
    });
  }
}

const aboutUpdateSnapshotV1Schema = z
  .object({
    application: applicationIdentitySchema,
    lastCheckAt: z.string().datetime({ offset: true }).nullable(),
    nextAutomaticCheckAt: z.string().datetime({ offset: true }).nullable(),
    policy: updatePolicySchema,
    schemaVersion: z.literal(1),
    state: updateStateSchema,
  })
  .strict()
  .superRefine(validatePlatformState);

const aboutUpdateSnapshotV2Schema = z
  .object({
    application: applicationIdentitySchema,
    candidate: releaseCandidateIdentitySchema.nullable(),
    lastCheckAt: z.string().datetime({ offset: true }).nullable(),
    nextAutomaticCheckAt: z.string().datetime({ offset: true }).nullable(),
    policy: updatePolicySchema,
    restart: restartStatusSchema,
    schemaVersion: z.literal(2),
    state: updateStateSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    validatePlatformState(snapshot, context);
    const hasCandidate = snapshot.candidate !== null;
    if ((snapshot.state.kind === "update-downloaded") !== hasCandidate) {
      context.addIssue({
        code: "custom",
        message: "Downloaded update state requires one candidate identity.",
        path: ["candidate"],
      });
    }
    if (
      (hasCandidate && snapshot.restart.kind === "none") ||
      (!hasCandidate && ["deferred", "restarting"].includes(snapshot.restart.kind))
    ) {
      context.addIssue({
        code: "custom",
        message: "Restart state requires one candidate identity.",
        path: ["restart"],
      });
    }
    if (
      snapshot.policy.mode !== "automatic" &&
      (hasCandidate || snapshot.restart.kind !== "none")
    ) {
      context.addIssue({
        code: "custom",
        message: "Manual platforms cannot expose restart authority.",
        path: ["restart"],
      });
    }
  });

export const aboutUpdateSnapshotSchema = z.union([
  aboutUpdateSnapshotV1Schema,
  aboutUpdateSnapshotV2Schema,
]);

const aboutErrorSchema = z
  .object({
    code: z.enum(["internal_error", "invalid_request", "unauthorized"]),
    message: z.string().trim().min(1).max(256),
    retryable: z.boolean(),
  })
  .strict();

export const aboutUpdateResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: aboutUpdateSnapshotSchema }).strict(),
  z.object({ error: aboutErrorSchema, ok: z.literal(false) }).strict(),
]);

const diagnosticErrorSchema = z
  .object({
    code: z.literal("check_failed"),
    message: z.literal("The update check could not be completed."),
  })
  .strict();

export const aboutReleaseDiagnosticsSchema = z
  .object({
    application: applicationIdentitySchema,
    candidate: releaseCandidateIdentitySchema.nullable(),
    errors: z.array(diagnosticErrorSchema).max(8),
    exportedAt: z.string().datetime({ offset: true }),
    guardReasons: z
      .array(restartGuardReasonSchema)
      .max(restartGuardReasonSchema.options.length)
      .refine((reasons) => new Set(reasons).size === reasons.length),
    restartState: z.enum(["none", "deferred", "blocked", "restarting"]),
    schemaVersion: z.literal(1),
    updateState: z.enum(updateStateSchema.options.map((option) => option.shape.kind.value)),
  })
  .strict();

export const aboutDiagnosticsExportResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      value: z
        .object({ status: z.enum(["cancelled", "saved"]) })
        .strict(),
    })
    .strict(),
  z.object({ error: aboutErrorSchema, ok: z.literal(false) }).strict(),
]);

export type AboutUpdateResult = z.infer<typeof aboutUpdateResultSchema>;
export type AboutUpdateSnapshot = z.infer<typeof aboutUpdateSnapshotSchema>;
export type AboutDiagnosticsExportResult = z.infer<
  typeof aboutDiagnosticsExportResultSchema
>;
export type ReleaseCandidateIdentity = z.infer<
  typeof releaseCandidateIdentitySchema
>;
export type RestartGuardReason = z.infer<typeof restartGuardReasonSchema>;

export interface AboutBridge {
  exportDiagnostics(): Promise<AboutDiagnosticsExportResult>;
  getSnapshot(): Promise<AboutUpdateResult>;
  requestCheck(): Promise<AboutUpdateResult>;
  requestRestart(candidateId: string): Promise<AboutUpdateResult>;
  subscribe(listener: (snapshot: AboutUpdateSnapshot) => void): () => void;
}
