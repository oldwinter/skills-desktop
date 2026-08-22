import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { app, autoUpdater, dialog } from "electron";

import { createDesktopCapabilities } from "./application/desktop-capabilities.js";
import { BUNDLED_OFFICIAL_COLLECTION_CATALOG } from "./application/bundled-official-collections.js";
import {
  createSpawnProcessRunner,
  createLocalSkillsProcess,
} from "./adapters/local-skills-process.js";
import { createElectronReleaseDiagnosticsExporter } from "./adapters/electron-release-diagnostics.js";
import {
  createSshSkillsProcess,
  createSshTransportRunner,
} from "./adapters/ssh-skills-process.js";
import { createJsonRecoveryRecords } from "./persistence/recovery-records.js";
import { createRecoveryHostTrustStore } from "./persistence/recovery-host-trust.js";
import {
  createOpenSshHostKeyProbe,
  createOpenSshTargetAccess,
  createOpenSshToolRunner,
} from "./ssh/openssh-target.js";
import { createLocalSkillsTargets } from "./targets/local-skills-targets.js";
import { createElectronUpdateComposition } from "./update-composition.js";

export async function createCompositionRoot(options?: {
  readonly onReviewRequested?: (reviewId: string) => void;
}) {
  const requestedWorkspace =
    process.env.SKILLS_DESKTOP_WORKSPACE ?? process.cwd();
  const workspace = await realpath(resolve(requestedWorkspace));
  const runner = createSpawnProcessRunner({ platform: process.platform });
  const userData = app.getPath("userData");
  const recoveryDirectory = resolve(userData, "recovery");
  const recoveryRecords = createJsonRecoveryRecords({
    directory: recoveryDirectory,
    id: randomUUID,
    platform: process.platform,
  });
  const sshToolRunner = createOpenSshToolRunner();
  const sshAccess = createOpenSshTargetAccess({
    clock: () => new Date(),
    hostKeySource: createOpenSshHostKeyProbe({
      directory: resolve(userData, "ssh", "probes"),
      runner: sshToolRunner,
    }),
    id: randomUUID,
    runner: sshToolRunner,
    trustStore: createRecoveryHostTrustStore({
      path: resolve(recoveryDirectory, "known_hosts"),
      records: recoveryRecords,
    }),
  });
  const sshRunner = createSshTransportRunner({ platform: process.platform });
  const skillsTargets = createLocalSkillsTargets({
    canonicalizeLocalWorkspace: realpath,
    id: randomUUID,
    processFor(binding) {
      if (binding.kind === "ssh" && binding.ssh !== undefined) {
        return createSshSkillsProcess({
          binding: {
            generation: binding.generation,
            harness: binding.harness,
            kind: "ssh",
            ssh: binding.ssh,
            targetId: binding.targetId,
            workspace: binding.workspace,
          },
          clock: () => new Date(),
          id: randomUUID,
          runner: sshRunner,
        });
      }
      return createLocalSkillsProcess({
        binding: {
          generation: binding.generation,
          harness: binding.harness,
          targetId: binding.targetId,
        },
        clock: () => new Date(),
        id: randomUUID,
        platform: process.platform,
        runner,
        workspace: binding.workspace,
      });
    },
    sshAccess,
    workspace,
    workspaceLabel: basename(workspace),
  });
  const capabilities = createDesktopCapabilities({
    clock: () => new Date(),
    id: randomUUID,
    officialCollectionCatalog: BUNDLED_OFFICIAL_COLLECTION_CATALOG,
    onReviewRequested: options?.onReviewRequested,
    recoveryRecords,
    platform: process.platform,
    skillsTargets,
  });
  await capabilities.initialize();
  const updates = await createElectronUpdateComposition({
    app,
    architecture: process.arch,
    autoUpdater,
    diagnosticsExporter: createElectronReleaseDiagnosticsExporter({ dialog }),
    platform: process.platform,
    restartSafety: () => capabilities.restartSafety(),
  });
  return { capabilities, updates };
}
