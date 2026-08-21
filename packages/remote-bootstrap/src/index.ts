import { CLI_PACKAGE, CLI_VERSION } from "@skills-desktop/skills-runtime";

export const REMOTE_BOOTSTRAP_PROTOCOL_VERSION = 1 as const;

export function describeRemoteBootstrap() {
  return {
    cliPackage: CLI_PACKAGE,
    cliVersion: CLI_VERSION,
    protocolVersion: REMOTE_BOOTSTRAP_PROTOCOL_VERSION,
  } as const;
}
