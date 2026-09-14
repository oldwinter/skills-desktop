import { describe, expect, it } from "vitest";

import { htmlLangFor, isLocale, otherLocale, resolveInitialLocale } from "./locale.js";

describe("resolveInitialLocale", () => {
  it("prefers an explicit lang query parameter", () => {
    expect(
      resolveInitialLocale({
        preferredLanguages: ["en-US"],
        search: "?lang=zh",
        storedLocale: "en",
      }),
    ).toBe("zh");
  });

  it("ignores unsupported query values and falls back to the stored choice", () => {
    expect(
      resolveInitialLocale({
        preferredLanguages: ["en-US"],
        search: "?lang=fr",
        storedLocale: "zh",
      }),
    ).toBe("zh");
  });

  it("uses the browser language when nothing is stored", () => {
    expect(
      resolveInitialLocale({ preferredLanguages: ["zh-CN", "en"], search: "", storedLocale: null }),
    ).toBe("zh");
    expect(
      resolveInitialLocale({ preferredLanguages: ["de-DE"], search: "", storedLocale: "nope" }),
    ).toBe("en");
  });
});

describe("locale helpers", () => {
  it("maps locales to html lang attributes and their counterpart", () => {
    expect(htmlLangFor("en")).toBe("en");
    expect(htmlLangFor("zh")).toBe("zh-CN");
    expect(otherLocale("en")).toBe("zh");
    expect(otherLocale("zh")).toBe("en");
  });

  it("recognises only supported locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("zh-CN")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
