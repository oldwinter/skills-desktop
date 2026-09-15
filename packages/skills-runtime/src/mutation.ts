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
    revision: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    source: z
      .string()
      .min(3)
      .max(256)
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/),
    sourceType: z.literal("github"),
  })
  .strict();

// An explicit non-empty subset of the Target harness set for add/remove
// (ADR 0014). Omitted means the whole scoped Target set, which keeps
// pre-existing intents valid. Entries are validated against the Target
// at preparation time, not here.
const harnessSubsetSchema = z
  .array(z.string().min(1).max(128))
  .min(1)
  .max(128)
  .refine((ids) => new Set(ids).size === ids.length)
  .optional();

export const mutationIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      harnessIds: harnessSubsetSchema,
      names: namesSchema,
      scope: scopeSchema,
      source: githubSourceSchema,
      type: z.literal("add"),
    })
    .strict(),
  z
    .object({
      harnessIds: harnessSubsetSchema,
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
