import { describe, expect, it } from "vitest";

import type { ReviewSnapshot } from "../../contracts/review.js";
import type {
  DesktopEvent,
  WorkspaceSnapshot,
} from "../../contracts/workspace.js";
import type { SkillsProcess } from "../adapters/local-skills-process.js";
import { createMemoryPreferenceRecords } from "../persistence/preference-records.js";
import { createMemoryRecoveryRecords } from "../persistence/recovery-records.js";
import { createSkillsTargetsCatalog } from "../targets/local-skills-targets.js";
import {
  createDesktopCapabilities,
  type TargetDefinition,
} from "./desktop-capabilities.js";
import { createPreferenceAuthority } from "./preferences.js";

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

const failure = <Code extends string>(code: Code) => ({
  error: {
    code,
    effects: "none" as const,
    message: "unused",
    phase: "test",
    retryable: false,
  },
  ok: false as const,
});

const idleProcess = {
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
    return failure("confirmation_invalid" as const);
  },
  async observeInventory() {
    return {
      ok: true as const,
      value: {
        cliVersion: "1.5.23",
        entries: [],
        observedAt: "2026-08-21T10:00:00.000Z",
        schemaVersion: 1 as const,
      },
    };
  },
  async prepareMutation() {
    return failure("mutation_ineligible" as const);
  },
} satisfies SkillsProcess;

function build(options?: { readonly withPreferences?: boolean }) {
  const records = createMemoryPreferenceRecords();
  const preferences =
    options?.withPreferences === false
      ? undefined
      : createPreferenceAuthority({
          records,
          systemLocaleTag: () => "zh-CN",
        });
  const capabilities = createDesktopCapabilities({
    id: () => "00000000-0000-4000-8000-000000000099",
    preferences,
    recoveryRecords: createMemoryRecoveryRecords(),
    scheduleEventDelivery: (deliver) => deliver(),
    skillsTargets: createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: localTarget,
      processFor: () => idleProcess,
    }),
    v1LocalOnlyTargets: true,
  });
  return { capabilities, records };
}

describe("preferences in the Workspace and Review protocols (#210, ADR 0023)", () => {
  it("projects the OS-derived default, persists a typed update, and republishes to every workspace endpoint", async () => {
    const { capabilities, records } = build();
    await capabilities.initialize();
    const events: DesktopEvent[] = [];
    const session = capabilities.attach(
      { endpointId: "w-1", role: "workspace", sessionEpoch: "epoch-1" },
      (event) => events.push(event),
    );
    const otherEvents: DesktopEvent[] = [];
    capabilities.attach(
      { endpointId: "w-2", role: "workspace", sessionEpoch: "epoch-1" },
      (event) => otherEvents.push(event),
    );

    const initial = (await session.snapshot()) as WorkspaceSnapshot;
    expect(initial.preferences).toEqual({
      appearance: "system",
      locale: "zh-CN",
      localePreference: "system",
      systemLocale: "zh-CN",
    });

    const updated = await session.request({
      patch: { appearance: "dark", localePreference: "en" },
      type: "preferences.update",
      version: 2,
    });
    expect(updated.ok).toBe(true);
    expect(records.saved).toEqual([
      { appearance: "dark", localePreference: "en" },
    ]);

    const next = (await session.snapshot()) as WorkspaceSnapshot;
    expect(next.preferences).toEqual({
      appearance: "dark",
      locale: "en",
      localePreference: "en",
      systemLocale: "zh-CN",
    });
    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe("snapshot.changed");
    if (lastEvent?.type === "snapshot.changed") {
      expect(lastEvent.snapshot.preferences?.locale).toBe("en");
    }
    const otherLast = otherEvents.at(-1);
    expect(otherLast?.type).toBe("snapshot.changed");
    if (otherLast?.type === "snapshot.changed") {
      expect(otherLast.snapshot.preferences?.appearance).toBe("dark");
    }
  });

  it("rejects malformed patches through the strict request union", async () => {
    const { capabilities, records } = build();
    await capabilities.initialize();
    const session = capabilities.attach(
      { endpointId: "w-1", role: "workspace", sessionEpoch: "epoch-1" },
      () => undefined,
    );
    for (const patch of [{}, { appearance: "sepia" }, { theme: "dark" }]) {
      await expect(
        session.request({ patch, type: "preferences.update", version: 2 }),
      ).resolves.toMatchObject({
        error: { code: "invalid_request" },
        ok: false,
      });
    }
    expect(records.saved).toEqual([]);
  });

  it("carries the same preferences into the Review snapshot", async () => {
    const { capabilities } = build();
    await capabilities.initialize();
    const workspace = capabilities.attach(
      { endpointId: "w-1", role: "workspace", sessionEpoch: "epoch-1" },
      () => undefined,
    );
    await workspace.request({
      patch: { appearance: "high-contrast" },
      type: "preferences.update",
      version: 2,
    });
    const review = capabilities.attach(
      {
        endpointId: "r-1",
        reviewId: "missing",
        role: "review",
        sessionEpoch: "epoch-1",
      },
      () => undefined,
    );
    const snapshot = (await review.snapshot()) as ReviewSnapshot;
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.preferences).toEqual({
      appearance: "high-contrast",
      locale: "zh-CN",
      localePreference: "system",
      systemLocale: "zh-CN",
    });
  });

  it("stays compatible when no preference authority is configured", async () => {
    const { capabilities } = build({ withPreferences: false });
    await capabilities.initialize();
    const session = capabilities.attach(
      { endpointId: "w-1", role: "workspace", sessionEpoch: "epoch-1" },
      () => undefined,
    );
    const snapshot = (await session.snapshot()) as WorkspaceSnapshot;
    expect(snapshot.preferences).toBeUndefined();
    await expect(
      session.request({
        patch: { appearance: "dark" },
        type: "preferences.update",
        version: 2,
      }),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
  });
});
