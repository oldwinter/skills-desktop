import { describe, expect, it } from "vitest";

import {
  applyPreferencesPatch,
  DEFAULT_STORED_PREFERENCES,
  preferencesPatchSchema,
  projectPreferences,
  publicPreferencesSchema,
  resolveSystemLocale,
  storedPreferencesSchema,
} from "./preferences.js";

describe("preferences contract", () => {
  it("resolves Simplified Chinese OS locales to zh-CN and everything else to en", () => {
    expect(resolveSystemLocale("zh-CN")).toBe("zh-CN");
    expect(resolveSystemLocale("zh_CN.UTF-8")).toBe("zh-CN");
    expect(resolveSystemLocale("zh-Hans-SG")).toBe("zh-CN");
    expect(resolveSystemLocale("zh")).toBe("zh-CN");
    expect(resolveSystemLocale("zh-SG")).toBe("zh-CN");
    expect(resolveSystemLocale("zh-TW")).toBe("en");
    expect(resolveSystemLocale("zh-Hant-HK")).toBe("en");
    expect(resolveSystemLocale("en-US")).toBe("en");
    expect(resolveSystemLocale("fr-FR")).toBe("en");
    expect(resolveSystemLocale("")).toBe("en");
    expect(resolveSystemLocale(undefined)).toBe("en");
  });

  it("projects the effective locale from the preference and the system default", () => {
    expect(projectPreferences(DEFAULT_STORED_PREFERENCES, "zh-CN")).toEqual({
      appearance: "system",
      locale: "zh-CN",
      localePreference: "system",
      systemLocale: "zh-CN",
    });
    expect(
      projectPreferences(
        { appearance: "dark", localePreference: "en" },
        "zh-CN",
      ),
    ).toEqual({
      appearance: "dark",
      locale: "en",
      localePreference: "en",
      systemLocale: "zh-CN",
    });
    expect(
      publicPreferencesSchema.safeParse(
        projectPreferences(DEFAULT_STORED_PREFERENCES, "en"),
      ).success,
    ).toBe(true);
  });

  it("applies partial patches without touching the other field", () => {
    expect(
      applyPreferencesPatch(DEFAULT_STORED_PREFERENCES, {
        appearance: "high-contrast",
      }),
    ).toEqual({ appearance: "high-contrast", localePreference: "system" });
    expect(
      applyPreferencesPatch(
        { appearance: "light", localePreference: "system" },
        { localePreference: "zh-CN" },
      ),
    ).toEqual({ appearance: "light", localePreference: "zh-CN" });
  });

  it("rejects empty patches, unknown fields, and unsupported values", () => {
    expect(preferencesPatchSchema.safeParse({}).success).toBe(false);
    expect(
      preferencesPatchSchema.safeParse({ appearance: "sepia" }).success,
    ).toBe(false);
    expect(
      preferencesPatchSchema.safeParse({ localePreference: "fr" }).success,
    ).toBe(false);
    expect(
      preferencesPatchSchema.safeParse({ appearance: "dark", theme: "x" })
        .success,
    ).toBe(false);
    expect(
      storedPreferencesSchema.safeParse({ appearance: "dark" }).success,
    ).toBe(false);
  });
});
