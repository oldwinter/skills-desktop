import { z } from "zod";

export const ABOUT_MANUAL_UPDATE_MESSAGE =
  "Download a newer package from GitHub Releases and install it manually.";
export const ABOUT_RELEASES_URL =
  "https://github.com/oldwinter/skills-desktop/releases";
export const ABOUT_UNAVAILABLE_UPDATE_MESSAGE =
  "Update checks are unavailable for this build.";

export const aboutUpdateCheckRequestSchema = z
  .object({
    type: z.literal("update.check"),
    version: z.literal(1),
  })
  .strict();

const applicationIdentitySchema = z
  .object({
    architecture: z.string().trim().min(1).max(32),
    platform: z.string().trim().min(1).max(32),
    version: z.string().trim().min(1).max(64),
  })
  .strict();

const automaticPolicySchema = z
  .object({
    channel: z.literal("stable"),
    mode: z.literal("automatic"),
  })
  .strict();

const updatePolicySchema = z.discriminatedUnion("mode", [
  automaticPolicySchema,
  z
    .object({
      message: z.literal(ABOUT_MANUAL_UPDATE_MESSAGE),
      mode: z.literal("manual"),
      releasePageUrl: z.literal(ABOUT_RELEASES_URL),
    })
    .strict(),
  z
    .object({
      message: z.literal(ABOUT_UNAVAILABLE_UPDATE_MESSAGE),
      mode: z.literal("unavailable"),
    })
    .strict(),
]);

const updateStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idle") }).strict(),
  z
    .object({
      kind: z.literal("checking"),
      requestedBy: z.enum(["automatic", "user"]),
    })
    .strict(),
  z.object({ kind: z.literal("update-available") }).strict(),
  z.object({ kind: z.literal("update-downloaded") }).strict(),
  z.object({ kind: z.literal("up-to-date") }).strict(),
  z
    .object({
      error: z
        .object({
          code: z.literal("check_failed"),
          message: z.literal("The update check could not be completed."),
          retryable: z.literal(true),
        })
        .strict(),
      kind: z.literal("error"),
    })
    .strict(),
  z.object({ kind: z.literal("manual") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
]);

export const aboutUpdateSnapshotSchema = z
  .object({
    application: applicationIdentitySchema,
    lastCheckAt: z.string().datetime({ offset: true }).nullable(),
    nextAutomaticCheckAt: z.string().datetime({ offset: true }).nullable(),
    policy: updatePolicySchema,
    schemaVersion: z.literal(1),
    state: updateStateSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
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
    if (
      snapshot.lastCheckAt !== null ||
      snapshot.nextAutomaticCheckAt !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Platforms without updater authority cannot report checks.",
        path: ["nextAutomaticCheckAt"],
      });
    }
  });

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

export type AboutUpdateResult = z.infer<typeof aboutUpdateResultSchema>;
export type AboutUpdateSnapshot = z.infer<typeof aboutUpdateSnapshotSchema>;

export interface AboutBridge {
  getSnapshot(): Promise<AboutUpdateResult>;
  requestCheck(): Promise<AboutUpdateResult>;
  subscribe(listener: (snapshot: AboutUpdateSnapshot) => void): () => void;
}
