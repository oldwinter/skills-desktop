import { describe, expect, it, vi } from "vitest";

import {
  describeSource,
  type Inventory,
  type SourceDescriptorV1,
} from "@skills-desktop/skills-runtime";

import type { SkillsProcess } from "../adapters/local-skills-process.js";
import type { SourceInspection } from "../adapters/skills-process.js";
import { createMemoryRecoveryRecords } from "../persistence/recovery-records.js";
import { createSkillsTargetsCatalog } from "../targets/local-skills-targets.js";
import {
  createDesktopCapabilities,
  type TargetDefinition,
} from "./desktop-capabilities.js";

const target: TargetDefinition = {
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

const freshInventory: Inventory = {
  cliVersion: "1.5.23",
  entries: [],
  observedAt: "2026-08-21T10:00:00.000Z",
  schemaVersion: 1,
};

function descriptorFor(source: string): SourceDescriptorV1 {
  const described = describeSource(source);
  if (!described.ok) throw new Error(`fixture source rejected: ${source}`);
  return described.value;
}

function inspectionFor(
  descriptor: SourceDescriptorV1,
  id: string,
  digest: string,
): SourceInspection {
  return {
    candidates: [
      { description: "Finds skills.", group: null, name: "find-skills" },
      { description: "Reviews code.", group: null, name: "code-review" },
    ],
    cliVersion: "1.5.23",
    descriptor,
    dialectVersion: 1,
    digest,
    id,
    inspectedAt: "2026-08-21T10:00:30.000Z",
    targetGeneration: target.generation,
    targetId: target.id,
  };
}

interface FixtureOptions {
  readonly ids: readonly string[];
  readonly inspect?: SkillsProcess["inspectSource"];
}

async function createFixture(options: FixtureOptions) {
  const ids = [...options.ids];
  const lifecycle: string[] = [];
  const prepareMutation = vi.fn<SkillsProcess["prepareMutation"]>(
    async (input) => {
      const { intent } = input;
      if (intent.type !== "add" || intent.source.sourceType !== "inspected") {
        throw new Error("Only inspected adds are exercised by this fixture.");
      }
      return {
        ok: true,
        value: {
          commandPlan: {
            harness: "codex",
            names: [...intent.names],
            operation: "add",
            preview: `npx skills@1.5.23 add ${intent.source.descriptor.source} --skill ${intent.names.join(" ")} --agent codex --yes`,
            schemaVersion: 1,
            scope: "project",
            source: {
              family: intent.source.descriptor.family,
              inspectionDigest: intent.source.inspection.digest,
              inspectionId: intent.source.inspection.id,
              mutability: intent.source.descriptor.mutability,
              ref: intent.source.descriptor.ref,
              source: intent.source.descriptor.source,
              sourceType: "inspected",
            },
            targetId: target.id,
            timeoutMs: 600_000,
          },
          digest: "c".repeat(64),
          expiresAt: "2026-08-21T10:10:00.000Z",
          id: "prepared-1",
          inventoryId: input.inventoryId,
          targetGeneration: target.generation,
          targetId: target.id,
        },
      };
    },
  );
  const process: SkillsProcess = {
    async executeConfirmed() {
      lifecycle.push("executeConfirmed");
      throw new Error("Execution is not exercised by this contract.");
    },
    inspectSource:
      options.inspect ??
      (async ({ descriptor }) => ({
        ok: true,
        value: inspectionFor(descriptor, "inspection-1", "a".repeat(64)),
      })),
    async observeInventory() {
      return { ok: true, value: freshInventory };
    },
    prepareMutation,
  };
  const inspectSource = vi.spyOn(process, "inspectSource");
  const records = createMemoryRecoveryRecords();
  const capabilities = createDesktopCapabilities({
    clock: () => new Date("2026-08-21T10:00:00.000Z"),
    id: () => ids.shift() ?? "unexpected-id",
    recoveryRecords: {
      async commit(change) {
        lifecycle.push(change.type);
        return records.commit(change);
      },
      restore: () => records.restore(),
    },
    skillsTargets: createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000010",
      initialTarget: target,
      processFor: () => process,
    }),
  });
  await capabilities.initialize();
  const workspace = capabilities.attach(
    {
      endpointId: "workspace-1",
      role: "workspace",
      sessionEpoch: "workspace-epoch",
    },
    () => undefined,
  );
  return {
    capabilities,
    inspectSource,
    lifecycle,
    prepareMutation,
    async refresh() {
      const refreshed = await workspace.request({
        targetId: target.id,
        type: "inventory.refresh",
        version: 2,
      });
      if (!refreshed.ok) throw new Error("fixture refresh failed");
    },
    workspace,
  };
}

describe("DesktopCapabilities Source Inspection contract (ADR 0015)", () => {
  it("classifies before spawning and publishes one session-only inspection projection", async () => {
    const fixture = await createFixture({
      ids: ["refresh-1", "inventory-1", "inspect-1"],
    });

    expect(await fixture.workspace.snapshot()).toMatchObject({
      sourceInspection: {
        activeOperationId: null,
        inspection: null,
        lastError: null,
        phase: "idle",
      },
    });

    for (const source of ["-r", "./skills", "/srv/skills.tar.gz"]) {
      expect(
        await fixture.workspace.request({
          source,
          targetId: target.id,
          type: "source.inspect",
          version: 2,
        }),
      ).toMatchObject({
        error: { code: "source_unsupported", effects: "none" },
        ok: false,
      });
    }
    expect(await fixture.workspace.snapshot()).toMatchObject({
      sourceInspection: {
        inspection: null,
        lastError: { code: "source_unsupported" },
        phase: "failed",
      },
    });
    expect(fixture.inspectSource).not.toHaveBeenCalled();

    expect(
      await fixture.workspace.request({
        source: "vercel-labs/skills",
        targetId: target.id,
        type: "source.inspect",
        version: 2,
      }),
    ).toMatchObject({ error: { code: "stale_inventory" }, ok: false });
    expect(fixture.inspectSource).not.toHaveBeenCalled();

    await fixture.refresh();
    expect(
      await fixture.workspace.request({
        source: "vercel-labs/skills",
        targetId: target.id,
        type: "source.inspect",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "inspect-1" } });
    expect(fixture.inspectSource).toHaveBeenCalledTimes(1);
    expect(fixture.inspectSource.mock.calls[0]?.[0]).toMatchObject({
      descriptor: {
        family: "github",
        locality: "portable",
        mutability: "mutable",
        ref: null,
        schemaVersion: 1,
        source: "vercel-labs/skills",
      },
    });
    expect(await fixture.workspace.snapshot()).toMatchObject({
      sourceInspection: {
        activeOperationId: null,
        inspection: {
          candidates: [{ name: "find-skills" }, { name: "code-review" }],
          descriptor: { source: "vercel-labs/skills" },
          digest: "a".repeat(64),
          inspectionId: "inspection-1",
          targetGeneration: 1,
          targetId: target.id,
        },
        lastError: null,
        phase: "ready",
      },
    });
    expect(fixture.lifecycle).not.toContain("guard.put");
  });

  it("cancels a running inspection without publishing candidates and refuses to overlap it", async () => {
    let release!: () => void;
    let started!: () => void;
    const listingStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await createFixture({
      ids: ["refresh-1", "inventory-1", "inspect-1", "inspect-2"],
      async inspect({ descriptor, signal }) {
        started();
        await released;
        if (signal.aborted) {
          return {
            error: {
              code: "cancelled",
              effects: "none",
              message: "Source inspection was cancelled.",
              phase: "inspect",
              retryable: true,
            },
            ok: false,
          };
        }
        return {
          ok: true,
          value: inspectionFor(descriptor, "inspection-1", "a".repeat(64)),
        };
      },
    });
    await fixture.refresh();

    const pending = fixture.workspace.request({
      source: "vercel-labs/skills",
      targetId: target.id,
      type: "source.inspect",
      version: 2,
    });
    await listingStarted;
    expect(await fixture.workspace.snapshot()).toMatchObject({
      sourceInspection: { activeOperationId: "inspect-1", phase: "inspecting" },
    });
    expect(
      await fixture.workspace.request({
        source: "vercel-labs/skills",
        targetId: target.id,
        type: "source.inspect",
        version: 2,
      }),
    ).toMatchObject({ error: { code: "mutation_conflict" }, ok: false });
    expect(
      await fixture.workspace.request({
        intent: { names: ["find-skills"], scope: "project", type: "remove" },
        targetId: target.id,
        type: "mutation.prepare",
        version: 2,
      }),
    ).toMatchObject({ error: { code: "mutation_conflict" }, ok: false });

    expect(
      await fixture.workspace.request({
        operationId: "inspect-1",
        type: "inventory.cancel",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "inspect-1" } });
    release();
    expect(await pending).toMatchObject({
      error: { code: "cancelled", effects: "none" },
      ok: false,
    });
    expect(await fixture.workspace.snapshot()).toMatchObject({
      sourceInspection: {
        activeOperationId: null,
        inspection: null,
        lastError: { code: "cancelled" },
        phase: "idle",
      },
    });
    expect(fixture.inspectSource).toHaveBeenCalledTimes(1);
  });

  it("binds an inspected add to the exact current inspection before planning", async () => {
    const fixture = await createFixture({
      ids: ["refresh-1", "inventory-1", "inspect-1"],
    });
    await fixture.refresh();
    const descriptor = descriptorFor("vercel-labs/skills");
    expect(
      await fixture.workspace.request({
        source: "vercel-labs/skills",
        targetId: target.id,
        type: "source.inspect",
        version: 2,
      }),
    ).toMatchObject({ ok: true });

    const prepareWith = (
      source: {
        readonly descriptor: SourceDescriptorV1;
        readonly inspection: { readonly digest: string; readonly id: string };
      },
      names: readonly string[] = ["find-skills"],
    ) =>
      fixture.workspace.request({
        intent: {
          names: [...names],
          scope: "project",
          source: { ...source, sourceType: "inspected" },
          type: "add",
        },
        targetId: target.id,
        type: "mutation.prepare",
        version: 2,
      });
    const bound = {
      descriptor,
      inspection: { digest: "a".repeat(64), id: "inspection-1" },
    };

    expect(
      await prepareWith({
        ...bound,
        inspection: { ...bound.inspection, digest: "b".repeat(64) },
      }),
    ).toMatchObject({
      error: { code: "source_inspection_stale", effects: "none" },
      ok: false,
    });
    expect(
      await prepareWith({
        ...bound,
        inspection: { ...bound.inspection, id: "inspection-0" },
      }),
    ).toMatchObject({ error: { code: "source_inspection_stale" }, ok: false });
    expect(
      await prepareWith({
        ...bound,
        descriptor: descriptorFor("vercel-labs/skills#main"),
      }),
    ).toMatchObject({ error: { code: "source_inspection_stale" }, ok: false });
    expect(await prepareWith(bound, ["not-listed"])).toMatchObject({
      error: { code: "source_inspection_stale" },
      ok: false,
    });
    expect(fixture.prepareMutation).not.toHaveBeenCalled();

    expect(await prepareWith(bound, ["find-skills", "code-review"])).toEqual({
      ok: true,
      value: { operationId: "prepared-1" },
    });
    expect(fixture.prepareMutation).toHaveBeenCalledTimes(1);
    expect(await fixture.workspace.snapshot()).toMatchObject({
      mutation: {
        commandPlan: {
          names: ["find-skills", "code-review"],
          operation: "add",
          source: {
            family: "github",
            inspectionDigest: "a".repeat(64),
            inspectionId: "inspection-1",
            mutability: "mutable",
            source: "vercel-labs/skills",
            sourceType: "inspected",
          },
        },
        phase: "planned",
      },
    });
  });

  it("revalidates the inspection binding before Guard creation", async () => {
    let nextInspectionId = 1;
    const fixture = await createFixture({
      ids: [
        "refresh-1",
        "inventory-1",
        "inspect-1",
        "review-1",
        "inspect-2",
        "mutation-operation-1",
      ],
      async inspect({ descriptor }) {
        const id = `inspection-${nextInspectionId++}`;
        return {
          ok: true,
          value: inspectionFor(
            descriptor,
            id,
            id === "inspection-1" ? "a".repeat(64) : "b".repeat(64),
          ),
        };
      },
    });
    await fixture.refresh();
    expect(
      await fixture.workspace.request({
        source: "vercel-labs/skills",
        targetId: target.id,
        type: "source.inspect",
        version: 2,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await fixture.workspace.request({
        intent: {
          names: ["find-skills"],
          scope: "project",
          source: {
            descriptor: descriptorFor("vercel-labs/skills"),
            inspection: { digest: "a".repeat(64), id: "inspection-1" },
            sourceType: "inspected",
          },
          type: "add",
        },
        targetId: target.id,
        type: "mutation.prepare",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "prepared-1" } });
    expect(
      await fixture.workspace.request({
        preparedMutationId: "prepared-1",
        type: "review.request",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "review-1" } });

    // A later inspection of another source replaces the session evidence the
    // planned add was bound to.
    expect(
      await fixture.workspace.request({
        source: "vercel-labs/other-skills",
        targetId: target.id,
        type: "source.inspect",
        version: 2,
      }),
    ).toMatchObject({ ok: true });

    const review = fixture.capabilities.attach(
      {
        endpointId: "review-1-endpoint",
        reviewId: "review-1",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );
    expect(await review.snapshot()).toMatchObject({
      projection: {
        commandPlan: {
          source: { inspectionId: "inspection-1", sourceType: "inspected" },
        },
      },
      status: "pending",
    });
    expect(
      await review.request({
        decision: "approve",
        type: "review.decide",
        version: 2,
      }),
    ).toMatchObject({
      error: {
        code: "source_inspection_stale",
        effects: "none",
        phase: "review",
      },
      ok: false,
    });
    expect(fixture.lifecycle).not.toContain("guard.put");
    expect(fixture.lifecycle).not.toContain("executeConfirmed");
    expect(await fixture.workspace.snapshot()).toMatchObject({
      mutation: {
        lastError: { code: "source_inspection_stale" },
        phase: "failed",
      },
    });
  });
});
