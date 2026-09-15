import {
  CATALOGS,
  createTranslator,
  type MessageKey,
} from "./i18n/translate.js";
import { DEFAULT_LOCALE, type Locale } from "./preferences.js";

/**
 * Maps stable renderer / about error codes to short user-facing copy in the
 * requested locale. Raw `message` stays available for details/devtools —
 * never as the primary banner sentence. Codes are never parsed from text.
 */
export type UserFacingErrorLike = {
  readonly code: string;
  readonly message: string;
};

/** Protocol-level message main emits for a malformed GitHub add source. */
export const GITHUB_SOURCE_OWNER_REPOSITORY_COPY =
  "GitHub source must be owner/repository.";

export function userFacingErrorMessage(
  error: UserFacingErrorLike | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const { t } = createTranslator(locale);
  if (error === null || error === undefined) return t("error.fallback");
  if (error.message === GITHUB_SOURCE_OWNER_REPOSITORY_COPY) {
    return t("error.githubSource");
  }
  const key = `error.${error.code}`;
  return key in CATALOGS[locale]
    ? t(key as MessageKey)
    : t("error.fallback");
}
