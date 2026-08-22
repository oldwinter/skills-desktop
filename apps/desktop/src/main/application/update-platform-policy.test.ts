import { describe, expect, it } from "vitest";

import { selectUpdatePlatformPolicy } from "./update-platform-policy.js";

describe("update platform guidance", () => {
  it("directs Linux users to manual releases without updater authority", () => {
    expect(
      selectUpdatePlatformPolicy({
        architecture: "x64",
        isPackaged: true,
        platform: "linux",
        version: "0.1.0",
      }),
    ).toEqual({
      message:
        "Download a newer package from GitHub Releases and install it manually.",
      mode: "manual",
      releasePageUrl:
        "https://github.com/oldwinter/skills-desktop/releases",
    });
  });

  it.each([
    { architecture: "arm64", platform: "darwin" },
    { architecture: "x64", platform: "darwin" },
    { architecture: "x64", platform: "win32" },
  ] as const)(
    "selects the stable $platform/$architecture feed in main",
    ({ architecture, platform }) => {
      expect(
        selectUpdatePlatformPolicy({
          architecture,
          isPackaged: true,
          platform,
          version: "0.1.0",
        }),
      ).toEqual({
        channel: "stable",
        feedUrl: `https://update.electronjs.org/oldwinter/skills-desktop/${platform}-${architecture}/0.1.0`,
        mode: "automatic",
      });
    },
  );

  it.each([
    { architecture: "x64", isPackaged: false, platform: "darwin" },
    { architecture: "arm64", isPackaged: true, platform: "win32" },
    { architecture: "x64", isPackaged: true, platform: "freebsd" },
  ] as const)(
    "keeps unsupported $platform/$architecture update checks unavailable",
    (application) => {
      expect(
        selectUpdatePlatformPolicy({ ...application, version: "0.1.0" }),
      ).toEqual({
        message: "Update checks are unavailable for this build.",
        mode: "unavailable",
      });
    },
  );
});
