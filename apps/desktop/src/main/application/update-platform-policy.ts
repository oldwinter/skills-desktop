import {
  ABOUT_MANUAL_UPDATE_MESSAGE,
  ABOUT_RELEASES_URL,
  ABOUT_UNAVAILABLE_UPDATE_MESSAGE,
} from "../../contracts/about.js";

export interface UpdateApplicationIdentity {
  readonly architecture: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly version: string;
}

export type UpdatePlatformPolicy =
  | {
      readonly channel: "stable";
      readonly feedUrl: string;
      readonly mode: "automatic";
    }
  | {
      readonly message: typeof ABOUT_MANUAL_UPDATE_MESSAGE;
      readonly mode: "manual";
      readonly releasePageUrl: typeof ABOUT_RELEASES_URL;
    }
  | {
      readonly message: typeof ABOUT_UNAVAILABLE_UPDATE_MESSAGE;
      readonly mode: "unavailable";
    };

export function selectUpdatePlatformPolicy(
  application: UpdateApplicationIdentity,
): UpdatePlatformPolicy {
  if (application.platform === "linux") {
    return {
      message: ABOUT_MANUAL_UPDATE_MESSAGE,
      mode: "manual",
      releasePageUrl: ABOUT_RELEASES_URL,
    };
  }
  const supportsAutomaticUpdates =
    application.isPackaged &&
    ((application.platform === "darwin" &&
      ["arm64", "x64"].includes(application.architecture)) ||
      (application.platform === "win32" &&
        application.architecture === "x64"));
  if (supportsAutomaticUpdates) {
    return {
      channel: "stable",
      feedUrl: `https://update.electronjs.org/oldwinter/skills-desktop/${application.platform}-${application.architecture}/${application.version}`,
      mode: "automatic",
    };
  }
  return {
    message: ABOUT_UNAVAILABLE_UPDATE_MESSAGE,
    mode: "unavailable",
  };
}
