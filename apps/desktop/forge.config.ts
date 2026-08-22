import type { ForgeConfig } from "@electron-forge/shared-types";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { readFileSync } from "node:fs";

const desktopPackage = JSON.parse(
  readFileSync(new URL("package.json", import.meta.url), "utf8"),
) as { readonly version: string };

const PACKAGED_RUNTIME_ROOTS = [
  "/dist/main",
  "/dist/preload",
  "/dist/renderer",
  "/dist/review-renderer",
] as const;

export function shouldIgnorePackagerPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  if (
    normalized === "" ||
    normalized === "/" ||
    normalized === "/package.json" ||
    normalized === "/dist"
  ) {
    return false;
  }
  return !PACKAGED_RUNTIME_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}

const config: ForgeConfig = {
  makers: [
    { name: "@electron-forge/maker-dmg", config: {}, platforms: ["darwin"] },
    { name: "@electron-forge/maker-zip", config: {}, platforms: ["darwin"] },
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        authors: "Skills Desktop maintainers",
        name: "skills_desktop",
        noDelta: true,
        noMsi: true,
        setupExe: `skills-desktop-${desktopPackage.version}-win32-x64-setup.exe`,
      },
      platforms: ["win32"],
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          bin: "skills-desktop",
          homepage: "https://github.com/oldwinter/skills-desktop",
          maintainer: "Skills Desktop maintainers",
          name: "skills-desktop",
        },
      },
      platforms: ["linux"],
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          bin: "skills-desktop",
          homepage: "https://github.com/oldwinter/skills-desktop",
          license: "Proprietary",
          name: "skills-desktop",
        },
      },
      platforms: ["linux"],
    },
  ],
  packagerConfig: {
    appBundleId: "dev.skillsdesktop.app",
    asar: true,
    executableName: "skills-desktop",
    ignore: shouldIgnorePackagerPath,
    name: "Skills Desktop",
    prune: false,
  },
  plugins: [
    new FusesPlugin({
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.RunAsNode]: false,
      version: FuseVersion.V1,
    }),
  ],
};

export default config;
