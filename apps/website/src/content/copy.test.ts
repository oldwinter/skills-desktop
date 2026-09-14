import { describe, expect, it } from "vitest";

import { CLI_EXAMPLES } from "./cli-examples.js";
import { COPY } from "./copy.js";
import { DOWNLOAD_GROUPS } from "./downloads.js";
import { LOCALES } from "./locale.js";

function shape(value: unknown, path = ""): string[] {
  if (typeof value === "function") return [`${path}()`];
  if (Array.isArray(value)) return [`${path}[${value.length}]`];
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => shape(child, path === "" ? key : `${path}.${key}`))
      .sort();
  }
  return [path];
}

describe("bilingual copy", () => {
  it("keeps every locale structurally identical", () => {
    const [reference, ...others] = LOCALES.map((locale) => shape(COPY[locale]));
    for (const other of others) {
      expect(other).toEqual(reference);
    }
  });

  it("names a tab and a comment for every CLI example", () => {
    for (const locale of LOCALES) {
      for (const example of CLI_EXAMPLES) {
        expect(COPY[locale].cli.tabs[example.id]).toBeTruthy();
        expect(COPY[locale].cli.comments[example.id]).toMatch(/^#/);
      }
    }
  });

  it("labels every download asset and platform", () => {
    for (const locale of LOCALES) {
      for (const group of DOWNLOAD_GROUPS) {
        expect(COPY[locale].download.platforms[group.platform].title).toBeTruthy();
        for (const asset of group.assets) {
          expect(COPY[locale].download.assets[asset.labelKey]).toBeTruthy();
        }
      }
    }
  });

  it("never claims signing, notarization or remote support", () => {
    const text = JSON.stringify(COPY, (_key, value: unknown) =>
      typeof value === "function" ? undefined : value,
    );
    expect(text).not.toMatch(/notarized since|Developer ID|signed with/i);
    expect(text).not.toMatch(/SSH Target[^.]*available/i);
    expect(COPY.en.hero.figure.summary(6, 3)).toBe("6 skills → 3 harnesses");
    expect(COPY.zh.harnesses.showAll(77)).toContain("77");
    expect(COPY.en.download.latest("0.1.0")).toContain("v0.1.0");
    expect(COPY.zh.download.latest("0.1.0")).toContain("v0.1.0");
    expect(COPY.en.harnesses.count(77)).toContain("77");
    expect(COPY.zh.harnesses.count(77)).toContain("77");
    expect(COPY.zh.hero.figure.summary(6, 3)).toContain("6");
    expect(COPY.en.harnesses.showAll(77)).toContain("77");
  });
});
