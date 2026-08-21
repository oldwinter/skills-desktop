import type { ForgeConfig } from "@electron-forge/shared-types";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  makers: [
    { name: "@electron-forge/maker-dmg", config: {}, platforms: ["darwin"] },
    { name: "@electron-forge/maker-zip", config: {}, platforms: ["darwin"] },
    { name: "@electron-forge/maker-squirrel", config: {}, platforms: ["win32"] },
    {
      name: "@electron-forge/maker-deb",
      config: { options: { homepage: "https://github.com/oldwinter/skills-desktop", maintainer: "Skills Desktop maintainers" } },
      platforms: ["linux"],
    },
    {
      name: "@electron-forge/maker-rpm",
      config: { options: { homepage: "https://github.com/oldwinter/skills-desktop" } },
      platforms: ["linux"],
    },
  ],
  packagerConfig: {
    appBundleId: "dev.skillsdesktop.app",
    asar: true,
    executableName: "skills-desktop",
    ignore: [
      /^\/src($|\/)/,
      /^\/node_modules($|\/)/,
      /^\/forge\.config\.ts$/,
      /^\/tsconfig\.json$/,
      /^\/vite\..*\.ts$/,
    ],
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
