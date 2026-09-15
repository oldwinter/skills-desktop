import { describe, expect, it } from "vitest";

import { createMemoryPreferenceRecords } from "../persistence/preference-records.js";
import { createPreferenceAuthority } from "./preferences.js";

describe("createPreferenceAuthority", () => {
  it("follows the OS locale until the user chooses one, then keeps the choice", async () => {
    const records = createMemoryPreferenceRecords();
    let tag = "zh-CN";
    const authority = createPreferenceAuthority({
      records,
      systemLocaleTag: () => tag,
    });
    await authority.initialize();
    expect(authority.current()).toEqual({
      appearance: "system",
      locale: "zh-CN",
      localePreference: "system",
      systemLocale: "zh-CN",
    });

    tag = "en-US";
    expect(authority.current().locale).toBe("en");

    const updated = await authority.update({ localePreference: "zh-CN" });
    expect(updated).toEqual({
      ok: true,
      value: {
        appearance: "system",
        locale: "zh-CN",
        localePreference: "zh-CN",
        systemLocale: "en",
      },
    });
    expect(records.saved).toEqual([
      { appearance: "system", localePreference: "zh-CN" },
    ]);
  });

  it("restores a stored record on initialize and patches one field at a time", async () => {
    const records = createMemoryPreferenceRecords({
      appearance: "dark",
      localePreference: "en",
    });
    const authority = createPreferenceAuthority({
      records,
      systemLocaleTag: () => "zh-CN",
    });
    await authority.initialize();
    expect(authority.current()).toMatchObject({
      appearance: "dark",
      locale: "en",
    });
    await authority.update({ appearance: "high-contrast" });
    expect(authority.current()).toMatchObject({
      appearance: "high-contrast",
      locale: "en",
      localePreference: "en",
    });
  });

  it("rejects malformed patches without touching the record", async () => {
    const records = createMemoryPreferenceRecords();
    const authority = createPreferenceAuthority({
      records,
      systemLocaleTag: () => "en",
    });
    await authority.initialize();
    for (const patch of [
      {},
      { appearance: "sepia" },
      { localePreference: "fr" },
      { appearance: "dark", extra: true },
      "dark",
      null,
    ]) {
      const result = await authority.update(patch);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_request");
    }
    expect(records.saved).toEqual([]);
  });

  it("keeps the previous value live when the durable write fails", async () => {
    const authority = createPreferenceAuthority({
      records: {
        async load() {
          return { status: "absent" };
        },
        async save() {
          throw new Error("EACCES: disk is read-only");
        },
      },
      systemLocaleTag: () => "en",
    });
    await authority.initialize();
    const result = await authority.update({ appearance: "dark" });
    expect(result).toEqual({
      error: {
        code: "persist_failed",
        effects: "none",
        message: "EACCES: disk is read-only",
        phase: "persist",
        retryable: false,
      },
      ok: false,
    });
    expect(authority.current().appearance).toBe("system");
  });

  it("surfaces a quarantined record as a warning and falls back to defaults", async () => {
    const authority = createPreferenceAuthority({
      records: {
        async load() {
          return { reason: "Preference state is not valid JSON.", status: "quarantined" };
        },
        async save() {},
      },
      systemLocaleTag: () => undefined,
    });
    await authority.initialize();
    expect(authority.warning()).toBe("Preference state is not valid JSON.");
    expect(authority.current()).toEqual({
      appearance: "system",
      locale: "en",
      localePreference: "system",
      systemLocale: "en",
    });
    await authority.update({ appearance: "light" });
    expect(authority.warning()).toBeUndefined();
  });
});
