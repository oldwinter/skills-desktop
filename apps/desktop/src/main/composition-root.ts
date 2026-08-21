import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { app } from "electron";

import { createDesktopCapabilities } from "./application/desktop-capabilities.js";
import {
  createSpawnProcessRunner,
  createLocalSkillsProcess,
} from "./adapters/local-skills-process.js";
import { createJsonRecoveryRecords } from "./persistence/recovery-records.js";
import { createLocalSkillsTargets } from "./targets/local-skills-targets.js";

export async function createCompositionRoot() {
  const requestedWorkspace =
    process.env.SKILLS_DESKTOP_WORKSPACE ?? process.cwd();
  const workspace = await realpath(resolve(requestedWorkspace));
  const runner = createSpawnProcessRunner({ platform: process.platform });
  const recoveryRecords = createJsonRecoveryRecords({
    directory: resolve(app.getPath("userData"), "recovery"),
    id: randomUUID,
    platform: process.platform,
  });
  const skillsTargets = createLocalSkillsTargets({
    processFor(binding) {
      return createLocalSkillsProcess({
        clock: () => new Date(),
        platform: process.platform,
        runner,
        workspace: binding.workspace,
      });
    },
    workspace,
    workspaceLabel: basename(workspace),
  });
  const capabilities = createDesktopCapabilities({
    id: randomUUID,
    recoveryRecords,
    skillsTargets,
  });
  await capabilities.initialize();
  return { capabilities };
}
