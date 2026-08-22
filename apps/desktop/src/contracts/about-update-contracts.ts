import { z } from "zod";

export const ABOUT_MANUAL_UPDATE_MESSAGE =
  "Download a newer package from GitHub Releases and install it manually.";
export const ABOUT_RELEASES_URL =
  "https://github.com/oldwinter/skills-desktop/releases";
export const ABOUT_UNAVAILABLE_UPDATE_MESSAGE =
  "Update checks are unavailable for this build.";

export const applicationIdentitySchema = z
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

export const updatePolicySchema = z.discriminatedUnion("mode", [
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

export const updateStateSchema = z.discriminatedUnion("kind", [
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
