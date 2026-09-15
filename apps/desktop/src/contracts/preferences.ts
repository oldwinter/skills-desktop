import { z } from "zod";

/**
 * ADR 0023 preference contract. Main owns the durable preference record and
 * resolves the effective locale; renderers only read the projection and send
 * a typed update. Identifiers, codes, and evidence are never localized.
 */
export const LOCALES = ["en", "zh-CN"] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const DEFAULT_LOCALE: Locale = "en";

export const localePreferenceSchema = z.enum(["system", ...LOCALES]);
export type LocalePreference = z.infer<typeof localePreferenceSchema>;

export const APPEARANCES = ["system", "light", "dark", "high-contrast"] as const;
export const appearanceSchema = z.enum(APPEARANCES);
export type Appearance = z.infer<typeof appearanceSchema>;

/** Durable preference record persisted by main. `system` defers to the OS. */
export const storedPreferencesSchema = z
  .object({
    appearance: appearanceSchema,
    localePreference: localePreferenceSchema,
  })
  .strict();
export type StoredPreferences = z.infer<typeof storedPreferencesSchema>;

export const DEFAULT_STORED_PREFERENCES: StoredPreferences = {
  appearance: "system",
  localePreference: "system",
};

/**
 * Renderer-facing projection: the resolved locale is what renderers render
 * in, `localePreference` is what the user chose, and `systemLocale` is the
 * resolved OS default so the UI can label the "system" choice honestly.
 */
export const publicPreferencesSchema = z
  .object({
    appearance: appearanceSchema,
    locale: localeSchema,
    localePreference: localePreferenceSchema,
    systemLocale: localeSchema,
  })
  .strict();
export type PublicPreferences = z.infer<typeof publicPreferencesSchema>;

export const preferencesPatchSchema = z
  .object({
    appearance: appearanceSchema.optional(),
    localePreference: localePreferenceSchema.optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.appearance !== undefined || patch.localePreference !== undefined,
    { message: "A preferences update must change at least one field." },
  );
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

/**
 * Maps an operating-system locale tag to a supported catalog locale. Any
 * Chinese variant written in Simplified script (or unspecified script from
 * mainland / Singapore regions) resolves to `zh-CN`; everything else falls
 * back to English so the shell never renders a mixed catalog.
 */
export function resolveSystemLocale(tag: string | null | undefined): Locale {
  if (typeof tag !== "string") return DEFAULT_LOCALE;
  const normalized = tag.trim().replaceAll("_", "-").toLowerCase();
  if (normalized.length === 0) return DEFAULT_LOCALE;
  const parts = normalized.split("-");
  if (parts[0] !== "zh") return DEFAULT_LOCALE;
  if (parts.includes("hans")) return "zh-CN";
  if (parts.includes("hant")) return DEFAULT_LOCALE;
  const region = parts.slice(1).find((part) => /^[a-z]{2}$/.test(part));
  if (region === undefined || region === "cn" || region === "sg") return "zh-CN";
  return DEFAULT_LOCALE;
}

export function resolveLocale(
  preference: LocalePreference,
  systemLocale: Locale,
): Locale {
  return preference === "system" ? systemLocale : preference;
}

export function projectPreferences(
  stored: StoredPreferences,
  systemLocale: Locale,
): PublicPreferences {
  return {
    appearance: stored.appearance,
    locale: resolveLocale(stored.localePreference, systemLocale),
    localePreference: stored.localePreference,
    systemLocale,
  };
}

export function applyPreferencesPatch(
  stored: StoredPreferences,
  patch: PreferencesPatch,
): StoredPreferences {
  return storedPreferencesSchema.parse({
    appearance: patch.appearance ?? stored.appearance,
    localePreference: patch.localePreference ?? stored.localePreference,
  });
}
