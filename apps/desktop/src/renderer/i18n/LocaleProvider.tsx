import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";

import {
  createTranslator,
  type Translator,
} from "../../contracts/i18n/translate.js";
import {
  DEFAULT_LOCALE,
  type Appearance,
  type Locale,
  type PublicPreferences,
} from "../../contracts/preferences.js";

const LocaleContext = createContext<Translator>(createTranslator(DEFAULT_LOCALE));

/**
 * Applies main-owned preferences to the document: `lang` follows the resolved
 * locale and `data-appearance` drives the CSS token set. Both renderers use
 * the same hook so the workspace and Trusted Review never disagree.
 */
export function useDocumentPreferences(
  preferences: Pick<PublicPreferences, "appearance" | "locale"> | undefined,
): void {
  const locale = preferences?.locale ?? DEFAULT_LOCALE;
  const appearance: Appearance = preferences?.appearance ?? "system";
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dataset["appearance"] = appearance;
  }, [appearance, locale]);
}

export function LocaleProvider({
  children,
  locale,
}: {
  readonly children: ReactNode;
  readonly locale: Locale | undefined;
}) {
  const translator = useMemo(
    () => createTranslator(locale ?? DEFAULT_LOCALE),
    [locale],
  );
  return (
    <LocaleContext.Provider value={translator}>{children}</LocaleContext.Provider>
  );
}

export function useTranslator(): Translator {
  return useContext(LocaleContext);
}
