import type { AboutUpdateSnapshot } from "../../contracts/about.js";
import type {
  selectUpdatePlatformPolicy,
  UpdateApplicationIdentity,
} from "./update-platform-policy.js";

export type AboutUpdateSnapshotV2 = Extract<
  AboutUpdateSnapshot,
  { readonly schemaVersion: 2 }
>;

export function createInitialUpdateSnapshot(
  application: UpdateApplicationIdentity,
  platformPolicy: ReturnType<typeof selectUpdatePlatformPolicy>,
): AboutUpdateSnapshotV2 {
  const policy =
    platformPolicy.mode === "automatic"
      ? { channel: platformPolicy.channel, mode: platformPolicy.mode }
      : platformPolicy;
  return {
    application: {
      architecture: application.architecture,
      platform: application.platform,
      version: application.version,
    },
    candidate: null,
    lastCheckAt: null,
    nextAutomaticCheckAt: null,
    policy,
    restart: {
      guardReasons: [],
      immediateRestartAvailable: false,
      kind: "none",
    },
    schemaVersion: 2,
    state:
      platformPolicy.mode === "manual"
        ? { kind: "manual" }
        : platformPolicy.mode === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "idle" },
  };
}
