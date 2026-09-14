export const LOCALES = ["en", "zh"] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "skills-desktop-website.locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export interface LocaleEnvironment {
  readonly search: string;
  readonly storedLocale: string | null;
  readonly preferredLanguages: readonly string[];
}

/**
 * Query string wins over a stored choice, which wins over the browser language.
 * The result is always a supported locale so the UI never renders half-translated.
 */
export function resolveInitialLocale(environment: LocaleEnvironment): Locale {
  const requested = new URLSearchParams(environment.search).get("lang");
  if (isLocale(requested)) return requested;
  if (isLocale(environment.storedLocale)) return environment.storedLocale;
  const prefersChinese = environment.preferredLanguages.some((language) =>
    language.toLowerCase().startsWith("zh"),
  );
  return prefersChinese ? "zh" : "en";
}

export function htmlLangFor(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

export function otherLocale(locale: Locale): Locale {
  return locale === "zh" ? "en" : "zh";
}
