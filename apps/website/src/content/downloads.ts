export const REPOSITORY = "oldwinter/skills-desktop";
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

export const PREVIEW_VERSION = "0.1.0";
export const PREVIEW_TAG = `preview-v${PREVIEW_VERSION}-34ff7b72b63773bfde8b37e6eb01ec44bdb2583f`;
export const PREVIEW_URL = `${RELEASES_URL}/tag/${PREVIEW_TAG}`;

export type Platform = "macos" | "windows" | "linux";

export interface DownloadAsset {
  readonly fileName: string;
  readonly bytes: number;
  readonly recommended?: boolean;
  readonly labelKey: string;
}

export interface DownloadGroup {
  readonly platform: Platform;
  readonly assets: readonly DownloadAsset[];
}

export const DOWNLOAD_GROUPS: readonly DownloadGroup[] = [
  {
    assets: [
      {
        bytes: 120_570_953,
        fileName: `skills-desktop-${PREVIEW_VERSION}-darwin-arm64.dmg`,
        labelKey: "macosArm",
        recommended: true,
      },
      {
        bytes: 122_544_614,
        fileName: `skills-desktop-${PREVIEW_VERSION}-darwin-x64.dmg`,
        labelKey: "macosIntel",
      },
    ],
    platform: "macos",
  },
  {
    assets: [
      {
        bytes: 146_080_768,
        fileName: `skills-desktop-${PREVIEW_VERSION}-win32-x64-setup.exe`,
        labelKey: "windowsSetup",
        recommended: true,
      },
    ],
    platform: "windows",
  },
  {
    assets: [
      {
        bytes: 96_514_318,
        fileName: `skills-desktop-${PREVIEW_VERSION}-linux-x64.deb`,
        labelKey: "linuxDeb",
        recommended: true,
      },
      {
        bytes: 101_482_693,
        fileName: `skills-desktop-${PREVIEW_VERSION}-linux-x64.rpm`,
        labelKey: "linuxRpm",
      },
    ],
    platform: "linux",
  },
];

export const CHECKSUMS_FILE = "SHA256SUMS";

export function assetUrl(fileName: string): string {
  return `${RELEASES_URL}/download/${PREVIEW_TAG}/${fileName}`;
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}
