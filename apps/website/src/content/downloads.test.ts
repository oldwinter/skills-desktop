import { describe, expect, it } from "vitest";

import {
  DOWNLOAD_GROUPS,
  PREVIEW_TAG,
  PREVIEW_URL,
  PREVIEW_VERSION,
  RELEASES_URL,
  assetUrl,
  formatMegabytes,
} from "./downloads.js";

describe("downloads", () => {
  it("points every asset at the exact unsigned preview tag", () => {
    expect(PREVIEW_TAG).toMatch(/^preview-v0\.1\.0-[a-f0-9]{40}$/);
    expect(PREVIEW_URL).toBe(`${RELEASES_URL}/tag/${PREVIEW_TAG}`);
    for (const group of DOWNLOAD_GROUPS) {
      for (const asset of group.assets) {
        expect(asset.fileName).toContain(PREVIEW_VERSION);
        expect(assetUrl(asset.fileName)).toBe(
          `https://github.com/oldwinter/skills-desktop/releases/download/${PREVIEW_TAG}/${asset.fileName}`,
        );
      }
    }
  });

  it("recommends exactly one asset per platform", () => {
    for (const group of DOWNLOAD_GROUPS) {
      expect(group.assets.filter((asset) => asset.recommended)).toHaveLength(1);
    }
    expect(DOWNLOAD_GROUPS.map((group) => group.platform)).toEqual(["macos", "windows", "linux"]);
  });

  it("formats sizes in whole megabytes", () => {
    expect(formatMegabytes(120_570_953)).toBe("121 MB");
    expect(formatMegabytes(96_514_318)).toBe("97 MB");
  });
});
