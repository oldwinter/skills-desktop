import { z } from "zod";

const skillNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const namesSchema = z
  .array(skillNameSchema)
  .min(1)
  .max(128)
  .refine((names) => new Set(names).size === names.length)
  .refine((names) => names.reduce((size, name) => size + name.length, 0) <= 8_192);

const scopeSchema = z.enum(["global", "project"]);

const githubSourceSchema = z
  .object({
    source: z
      .string()
      .min(3)
      .max(256)
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/),
    sourceType: z.literal("github"),
  })
  .strict();

export const mutationIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      names: namesSchema,
      scope: scopeSchema,
      source: githubSourceSchema,
      type: z.literal("add"),
    })
    .strict(),
  z
    .object({
      names: namesSchema,
      scope: scopeSchema,
      type: z.literal("remove"),
    })
    .strict(),
  z
    .object({
      names: namesSchema,
      scope: scopeSchema,
      type: z.literal("update"),
    })
    .strict(),
  z
    .object({
      scope: scopeSchema,
      type: z.literal("update-all"),
    })
    .strict(),
]);

export type MutationIntent = z.infer<typeof mutationIntentSchema>;
