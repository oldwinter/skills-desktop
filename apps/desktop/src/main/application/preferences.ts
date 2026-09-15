import {
  applyPreferencesPatch,
  DEFAULT_STORED_PREFERENCES,
  preferencesPatchSchema,
  projectPreferences,
  resolveSystemLocale,
  type Locale,
  type PreferencesPatch,
  type PublicPreferences,
  type StoredPreferences,
} from "../../contracts/preferences.js";
import type { RendererError } from "../../contracts/workspace.js";
import type { PreferenceRecords } from "../persistence/preference-records.js";

type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly error: E; readonly ok: false };

export interface PreferenceAuthority {
  /** Current renderer-facing projection (defaults before `initialize`). */
  current(): PublicPreferences;
  initialize(): Promise<void>;
  /** Persist first, then expose; a failed write leaves the old value live. */
  update(patch: unknown): Promise<Result<PublicPreferences, RendererError>>;
  /** Non-fatal startup problem with the durable record, if any. */
  warning(): string | undefined;
}

export interface PreferenceAuthorityOptions {
  readonly records: PreferenceRecords;
  /** Raw OS locale tag such as `zh-CN` or `en-US`. */
  readonly systemLocaleTag: () => string | undefined;
}

/**
 * ADR 0023: main owns locale and appearance. The OS locale supplies the
 * default; an explicit stored preference wins. Renderers never persist.
 */
export function createPreferenceAuthority(
  options: PreferenceAuthorityOptions,
): PreferenceAuthority {
  let stored: StoredPreferences = DEFAULT_STORED_PREFERENCES;
  let warning: string | undefined;

  const systemLocale = (): Locale =>
    resolveSystemLocale(options.systemLocaleTag());

  const failure = (
    code: RendererError["code"],
    message: string,
    phase: string,
  ): Result<PublicPreferences, RendererError> => ({
    error: { code, effects: "none", message, phase, retryable: false },
    ok: false,
  });

  return {
    current() {
      return projectPreferences(stored, systemLocale());
    },
    async initialize() {
      try {
        const loaded = await options.records.load();
        if (loaded.status === "loaded") stored = loaded.value;
        else if (loaded.status === "quarantined") warning = loaded.reason;
      } catch (error) {
        warning =
          error instanceof Error
            ? error.message
            : "Preference state could not be read.";
      }
    },
    async update(patch) {
      const parsed = preferencesPatchSchema.safeParse(patch);
      if (!parsed.success) {
        return failure(
          "invalid_request",
          "The preferences update is not supported.",
          "validate",
        );
      }
      const next = applyPreferencesPatch(stored, parsed.data as PreferencesPatch);
      try {
        await options.records.save(next);
      } catch (error) {
        return failure(
          "persist_failed",
          error instanceof Error
            ? error.message
            : "Preferences could not be saved.",
          "persist",
        );
      }
      stored = next;
      warning = undefined;
      return { ok: true, value: projectPreferences(stored, systemLocale()) };
    },
    warning() {
      return warning;
    },
  };
}
