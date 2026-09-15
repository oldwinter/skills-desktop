import { describe, expect, it } from "vitest";

import type { WorkspaceSnapshot } from "../../contracts/workspace.js";
import type { SkillsProcess } from "../adapters/local-skills-process.js";
import { createMemoryRecoveryRecords } from "../persistence/recovery-records.js";
import { createSkillsTargetsCatalog } from "../targets/local-skills-targets.js";
import {
  createDesktopCapabilities,
  type TargetDefinition,
} from "./desktop-capabilities.js";
import { createRecordingExternalBrowser } from "./skills-sh-handoff.js";

const localTarget: TargetDefinition = {
  connectionReference: null,
  dialectId: "skills-1.5.23",
  executionBindingDigest: null,
  generation: 1,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "This device",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/work/skills-desktop",
  workspaceLabel: "skills-desktop",
};

const observedProcess = {
  async inspectSource() {
    return {
      error: {
        code: "source_unsupported" as const,
        effects: "none" as const,
        message: "Source inspection is not exercised by this contract.",
        phase: "inspect",
        retryable: false,
      },
      ok: false as const,
    };
  },
  async executeConfirmed() {
    return {
      error: {
        code: "confirmation_invalid",
        effects: "none",
        message: "unused",
        phase: "execute",
        retryable: false,
      },
      ok: false as const,
    };
  },
  async observeInventory() {
    return {
      ok: true as const,
      value: {
        cliVersion: "1.5.23",
        entries: [
          {
            agents: ["codex"],
            contentFingerprint: { status: "unknown" as const },
            declaredSource: {
              source: "vercel-labs/agent-skills",
              sourceType: "github" as const,
            },
            extensions: {},
            name: "find-skills",
            path: "/work/skills-desktop/.agents/skills/find-skills",
            revision: { status: "unknown" as const },
            scope: "project" as const,
            sourceUrl: null,
          },
          {
            agents: ["codex"],
            contentFingerprint: { status: "unknown" as const },
            declaredSource: { source: null, sourceType: null },
            extensions: {},
            name: "hand-written",
            path: "/work/skills-desktop/.agents/skills/hand-written",
            revision: { status: "unknown" as const },
            scope: "project" as const,
            sourceUrl: null,
          },
        ],
        observedAt: "2026-08-21T10:00:00.000Z",
        schemaVersion: 1 as const,
      },
    };
  },
  async prepareMutation() {
    return {
      error: {
        code: "mutation_ineligible",
        effects: "none",
        message: "unused",
        phase: "prepare",
        retryable: false,
      },
      ok: false as const,
    };
  },
} satisfies SkillsProcess;

function capabilitiesWith(browser?: { openExternal(url: string): Promise<void> }) {
  return createDesktopCapabilities({
    externalBrowser: browser,
    id: () => "00000000-0000-4000-8000-000000000099",
    recoveryRecords: createMemoryRecoveryRecords(),
    skillsTargets: createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: localTarget,
      processFor: () => observedProcess,
    }),
    v1LocalOnlyTargets: true,
  });
}

describe("skills.sh browser handoff (#208, ADR 0021)", () => {
  it("projects handoff records from Fresh Inventory and opens one allowlisted URL through the recorder", async () => {
    const browser = createRecordingExternalBrowser();
    const capabilities = capabilitiesWith(browser);
    await capabilities.initialize();
    const session = capabilities.attach(
      {
        endpointId: "workspace-handoff",
        role: "workspace",
        sessionEpoch: "epoch-handoff",
      },
      () => undefined,
    );

    const stale = (await session.snapshot()) as WorkspaceSnapshot;
    expect(stale.inventory.freshness).not.toBe("fresh");
    expect(stale.skillsShHandoffs).toEqual([]);

    // Guessing a record id never opens anything.
    await expect(
      session.request({
        recordId: "c".repeat(64),
        type: "handoff.skills-sh",
        version: 2,
      }),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(browser.opened).toEqual([]);

    await session.request({
      targetId: localTarget.id,
      type: "inventory.refresh",
      version: 2,
    });
    const fresh = (await session.snapshot()) as WorkspaceSnapshot;
    expect(fresh.inventory.freshness).toBe("fresh");
    expect(fresh.skillsShHandoffs).toHaveLength(1);
    const [record] = fresh.skillsShHandoffs!;
    expect(record).toMatchObject({
      kind: "skills-sh",
      owner: "vercel-labs",
      repository: "agent-skills",
      skill: "find-skills",
      sourceEntry: { name: "find-skills", scope: "project" },
    });
    // The Snapshot carries publication data, never a URL.
    expect(JSON.stringify(fresh)).not.toContain("https://");

    await expect(
      session.request({
        recordId: record!.id,
        type: "handoff.skills-sh",
        version: 2,
      }),
    ).resolves.toEqual({ ok: true, value: { operationId: record!.id } });
    expect(browser.opened).toEqual([
      "https://skills.sh/vercel-labs/agent-skills/find-skills",
    ]);

    // A renderer-supplied URL is not a request at all.
    await expect(
      session.request({
        type: "handoff.skills-sh",
        url: "https://skills.sh/vercel-labs/agent-skills",
        version: 2,
      } as never),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(browser.opened).toHaveLength(1);
  });

  it("does not honour a record id minted for another session", async () => {
    const browser = createRecordingExternalBrowser();
    const capabilities = capabilitiesWith(browser);
    await capabilities.initialize();
    const first = capabilities.attach(
      { endpointId: "one", role: "workspace", sessionEpoch: "epoch-one" },
      () => undefined,
    );
    const second = capabilities.attach(
      { endpointId: "two", role: "workspace", sessionEpoch: "epoch-two" },
      () => undefined,
    );
    await first.request({
      targetId: localTarget.id,
      type: "inventory.refresh",
      version: 2,
    });
    const [record] = ((await first.snapshot()) as WorkspaceSnapshot)
      .skillsShHandoffs!;
    await expect(
      second.request({
        recordId: record!.id,
        type: "handoff.skills-sh",
        version: 2,
      }),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(browser.opened).toEqual([]);
  });

  it("reports the handoff as unavailable when no system browser is composed, and as failed when it throws", async () => {
    const unavailable = capabilitiesWith(undefined);
    await unavailable.initialize();
    const session = unavailable.attach(
      { endpointId: "w", role: "workspace", sessionEpoch: "epoch" },
      () => undefined,
    );
    await session.request({
      targetId: localTarget.id,
      type: "inventory.refresh",
      version: 2,
    });
    const [record] = ((await session.snapshot()) as WorkspaceSnapshot)
      .skillsShHandoffs!;
    await expect(
      session.request({
        recordId: record!.id,
        type: "handoff.skills-sh",
        version: 2,
      }),
    ).resolves.toMatchObject({
      error: { code: "invalid_request", phase: "handoff" },
      ok: false,
    });

    const throwing = capabilitiesWith({
      async openExternal() {
        throw new Error("no browser");
      },
    });
    await throwing.initialize();
    const failing = throwing.attach(
      { endpointId: "w", role: "workspace", sessionEpoch: "epoch" },
      () => undefined,
    );
    await failing.request({
      targetId: localTarget.id,
      type: "inventory.refresh",
      version: 2,
    });
    const [failingRecord] = ((await failing.snapshot()) as WorkspaceSnapshot)
      .skillsShHandoffs!;
    await expect(
      failing.request({
        recordId: failingRecord!.id,
        type: "handoff.skills-sh",
        version: 2,
      }),
    ).resolves.toMatchObject({
      error: { code: "process_failed", retryable: true },
      ok: false,
    });
  });
});
