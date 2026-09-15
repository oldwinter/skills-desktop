import { useId, useState } from "react";
import { AlertCircle, Check, Languages, SunMoon } from "lucide-react";

import type { MessageKey } from "../../../contracts/i18n/translate.js";
import {
  APPEARANCES,
  LOCALES,
  type Appearance,
  type LocalePreference,
  type PreferencesPatch,
  type PublicPreferences,
} from "../../../contracts/preferences.js";
import type {
  RendererError,
  WorkspaceRequestResult,
} from "../../../contracts/workspace.js";
import { useTranslator } from "../../i18n/LocaleProvider.js";
import { UserFacingErrorCopy } from "../../UserFacingErrorCopy.js";

const localeNameKey = (locale: (typeof LOCALES)[number]): MessageKey =>
  `preferences.language.${locale}`;

const appearanceKey = (appearance: Appearance): MessageKey =>
  `preferences.appearance.${appearance}`;

/**
 * ADR 0023 language and appearance controls. The renderer only sends a typed
 * patch; the resolved locale arrives back through the Snapshot, so the UI
 * never flips before main has persisted the choice.
 */
export function PreferencesPanel({
  onUpdate,
  preferences,
}: {
  readonly onUpdate: (patch: PreferencesPatch) => Promise<WorkspaceRequestResult>;
  readonly preferences: PublicPreferences | undefined;
}) {
  const { t } = useTranslator();
  const languageId = useId();
  const appearanceId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RendererError>();
  const [saved, setSaved] = useState(false);

  const apply = async (patch: PreferencesPatch) => {
    setBusy(true);
    setSaved(false);
    const result = await onUpdate(patch);
    setBusy(false);
    if (result.ok) {
      setError(undefined);
      setSaved(true);
    } else {
      setError(result.error);
    }
  };

  const disabled = busy || preferences === undefined;
  const localePreference: LocalePreference =
    preferences?.localePreference ?? "system";
  const appearance: Appearance = preferences?.appearance ?? "system";
  const systemLocaleName = t(localeNameKey(preferences?.systemLocale ?? "en"));

  return (
    <section
      aria-labelledby="preferences-heading"
      className="preferences-panel"
      data-testid="preferences-panel"
    >
      <header>
        <h2 id="preferences-heading">{t("preferences.heading")}</h2>
        <p>{t("preferences.description")}</p>
      </header>
      <div className="preferences-grid">
        <label className="preferences-field" htmlFor={languageId}>
          <span>
            <Languages aria-hidden="true" size={15} />
            {t("preferences.language")}
          </span>
          <select
            disabled={disabled}
            id={languageId}
            onChange={(event) =>
              void apply({
                localePreference: event.currentTarget.value as LocalePreference,
              })
            }
            value={localePreference}
          >
            <option value="system">
              {t("preferences.language.system", { locale: systemLocaleName })}
            </option>
            {LOCALES.map((locale) => (
              <option key={locale} lang={locale} value={locale}>
                {t(localeNameKey(locale))}
              </option>
            ))}
          </select>
        </label>
        <label className="preferences-field" htmlFor={appearanceId}>
          <span>
            <SunMoon aria-hidden="true" size={15} />
            {t("preferences.appearance")}
          </span>
          <select
            disabled={disabled}
            id={appearanceId}
            onChange={(event) =>
              void apply({
                appearance: event.currentTarget.value as Appearance,
              })
            }
            value={appearance}
          >
            {APPEARANCES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {t(appearanceKey(candidate))}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error !== undefined ? (
        <div className="state-banner state-banner--danger" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <UserFacingErrorCopy error={error} />
        </div>
      ) : saved ? (
        <p className="preferences-saved" role="status">
          <Check aria-hidden="true" size={14} />
          {t("preferences.saved")}
        </p>
      ) : null}
    </section>
  );
}
