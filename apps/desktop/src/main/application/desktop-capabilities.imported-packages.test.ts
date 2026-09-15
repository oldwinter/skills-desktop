import { describe, expect, it, vi } from "vitest";

import {
  serializeSkillpack,
  type Inventory,
  type SkillpackPackage,
} from "@skills-desktop/skills-runtime";

import type { SkillsProcess } from "../adapters/local-skills-process.js";
import { createMemoryRecoveryRecords } from "../persistence/recovery-records.js";
import { createSkillsTargetsCatalog } from "../targets/local-skills-targets.js";
import {
  createDesktopCapabilities,
  type TargetDefinition,
} from "./desktop-capabilities.js";
import {
  createNodeSkillpackCodec,
  type SkillpackPick,
} from "./imported-packages.js";

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

const codec = createNodeSkillpackCodec();

function skillpackBytes(overrides: Partial<SkillpackPackage> = {}) {
  const serialized = serializeSkillpack(
    {
      compatibility: { dialectId: "skills-1.5.23", harnessIds: ["codex"] },
      description: "Team review recipe.",
      id: "team.review",
      release: 1,
      skills: ["find-skills", "code-review"],
      source: { owner: "vercel-labs", repository: "skills", type: "github" },
      title: "Team review",
      ...overrides,
    },
    codec,
  );
  if (!serialized.ok) throw new Error(serialized.error.message);
  return serialized.value;
}

async function createFixture(options: {
  readonly ids: readonly string[];
  readonly picks?: readonly SkillpackPick[];
  readonly withPicker?: boolean;
}) {
  const ids = [...options.ids];
  const picks = [...(options.picks ?? [])];
  const lifecycle: string[] = [];
  const prepareMutation = vi.fn<SkillsProcess["prepareMutation"]>(
    async (input) => {
      const { intent } = input;
      if (intent.type !== "add" || intent.source.sourceType !== "github") {
        throw new Error("Only GitHub adds are exercised by this fixture.");
      }
      return {
        ok: true,
        value: {
          commandPlan: {
            harness: "codex",
            names: [...intent.names],
            operation: "add",
            preview: `npx skills@1.5.23 add ${intent.source.source} --skill ${intent.names.join(" ")} --agent codex --yes`,
            schemaVersion: 1,
            scope: intent.scope,
            source: intent.source,
            targetId: target.id,
            timeoutMs: 600_000,
          },
          digest: "c".repeat(64),
          expiresAt: "2099-01-01T00:10:00.000Z",
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
      throw new Error("Execution is not exercised by this contract.");
    },
    async inspectSource() {
      throw new Error("Inspection is not exercised by this contract.");
    },
    async observeInventory() {
      return { ok: true, value: freshInventory };
    },
    prepareMutation,
  };
  const records = createMemoryRecoveryRecords();
  const pick = vi.fn(async (): Promise<SkillpackPick> => {
    const next = picks.shift();
    if (next === undefined) throw new Error("No pick scripted.");
    return next;
  });
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
    ...(options.withPicker === false ? {} : { skillpackPicker: { pick } }),
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
  // Target catalogue bootstrap commits are not part of the import contract.
  lifecycle.length = 0;
  return {
    capabilities,
    lifecycle,
    pick,
    prepareMutation,
    records,
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

const importRequest = { type: "package.import", version: 2 } as const;

describe("DesktopCapabilities Imported Package contract (ADR 0017)", () => {
  it("rejects import without a main-owned picker and never accepts a renderer path", async () => {
    const fixture = await createFixture({ ids: [], withPicker: false });
    expect(await fixture.workspace.request(importRequest)).toMatchObject({
      error: { code: "package_import_unavailable", effects: "none" },
      ok: false,
    });
    expect(
      await fixture.workspace.request({
        ...importRequest,
        path: "/tmp/evil.skillpack",
      }),
    ).toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(fixture.lifecycle).toEqual([]);
  });

  it("imports offline, persists through packages.replace, and projects a separate imported origin", async () => {
    const release = skillpackBytes();
    const fixture = await createFixture({
      ids: ["import-cancel", "import-invalid", "import-1"],
      picks: [
        { status: "cancelled" },
        {
          bytes: new TextEncoder().encode('{"kind":"skillpack"}'),
          fileName: "broken.skillpack",
          status: "selected",
        },
        {
          bytes: release.bytes,
          fileName: "/home/user/Downloads/team-review.skillpack",
          status: "selected",
        },
      ],
    });

    expect(await fixture.workspace.snapshot()).toMatchObject({
      collections: { lastImport: null, packages: [], releases: [] },
    });

    expect(await fixture.workspace.request(importRequest)).toEqual({
      ok: true,
      value: { operationId: "import-cancel" },
    });
    expect(await fixture.workspace.snapshot()).toMatchObject({
      collections: {
        lastImport: { fileName: null, packageId: null, status: "cancelled" },
        packages: [],
      },
    });

    expect(await fixture.workspace.request(importRequest)).toMatchObject({
      error: { code: "skillpack_invalid", effects: "none" },
      ok: false,
    });
    expect(fixture.lifecycle).not.toContain("packages.replace");

    expect(await fixture.workspace.request(importRequest)).toEqual({
      ok: true,
      value: { operationId: "import-1" },
    });
    expect(fixture.lifecycle).toEqual(["packages.replace"]);
    expect((await fixture.records.restore()).importedPackages).toHaveLength(1);
    const snapshot = await fixture.workspace.snapshot();
    expect(snapshot).toMatchObject({
      collections: {
        lastImport: {
          documentDigest: release.document.documentDigest,
          fileName: "team-review.skillpack",
          packageId: "team.review",
          release: 1,
          relatedRelease: null,
          status: "imported",
        },
        packages: [
          {
            conflicts: [],
            delta: null,
            documentDigest: release.document.documentDigest,
            executable: true,
            importedAt: "2026-08-21T10:00:00.000Z",
            origin: "imported",
            packageId: "team.review",
            release: 1,
            skills: ["find-skills", "code-review"],
            source: {
              repository: "vercel-labs/skills",
              revision: null,
              sourceType: "github",
            },
          },
        ],
        releases: [],
      },
    });
    expect(
      "collections" in snapshot ? snapshot.collections?.packages?.[0] : null,
    ).not.toHaveProperty("receipt");
  });

  it("is idempotent, retains digest conflicts, and records explicit release deltas", async () => {
    const releaseOne = skillpackBytes();
    const edited = skillpackBytes({ description: "Edited elsewhere." });
    const releaseTwo = skillpackBytes({ release: 2, skills: ["find-skills"] });
    const pickFor = (bytes: Uint8Array): SkillpackPick => ({
      bytes,
      fileName: "team.skillpack",
      status: "selected",
    });
    const fixture = await createFixture({
      ids: ["import-1", "import-2", "import-3", "import-4"],
      picks: [
        pickFor(releaseOne.bytes),
        pickFor(releaseOne.bytes),
        pickFor(edited.bytes),
        pickFor(releaseTwo.bytes),
      ],
    });

    await fixture.workspace.request(importRequest);
    await fixture.workspace.request(importRequest);
    expect(fixture.lifecycle).toEqual(["packages.replace"]);
    expect(await fixture.workspace.snapshot()).toMatchObject({
      collections: {
        lastImport: { relatedRelease: 1, status: "identical" },
      },
    });

    await fixture.workspace.request(importRequest);
    expect(fixture.lifecycle).toEqual(["packages.replace", "packages.replace"]);
    expect(await fixture.workspace.snapshot()).toMatchObject({
      collections: {
        lastImport: {
          documentDigest: edited.document.documentDigest,
          status: "conflict",
        },
        packages: [
          {
            conflicts: [
              { documentDigest: edited.document.documentDigest, release: 1 },
            ],
            documentDigest: releaseOne.document.documentDigest,
            release: 1,
          },
        ],
      },
    });

    await fixture.workspace.request(importRequest);
    expect(await fixture.workspace.snapshot()).toMatchObject({
      collections: {
        lastImport: { relatedRelease: 1, release: 2, status: "upgrade" },
        packages: [
          {
            delta: { fromRelease: 1, kind: "upgrade", toRelease: 2 },
            documentDigest: releaseTwo.document.documentDigest,
            release: 2,
            skills: ["find-skills"],
          },
        ],
      },
    });
  });

  it("applies an Imported Package through the guarded Collection path with imported evidence", async () => {
    const release = skillpackBytes();
    const fixture = await createFixture({
      ids: ["import-1", "refresh-1", "inventory-1", "plan-1", "review-1"],
      picks: [
        {
          bytes: release.bytes,
          fileName: "team.skillpack",
          status: "selected",
        },
      ],
    });
    await fixture.workspace.request(importRequest);

    const prepareRequest = {
      collectionId: "team.review",
      manifestDigest: release.document.documentDigest,
      origin: "imported",
      releaseNumber: 1,
      scope: "project",
      selections: [{ mode: "add", name: "find-skills" }],
      targetId: target.id,
      type: "collection.prepare",
      version: 2,
    } as const;

    // Matching ID/release/digest never promotes an import to Official.
    expect(
      await fixture.workspace.request({
        ...prepareRequest,
        origin: "official",
      }),
    ).toMatchObject({
      error: {
        code: "mutation_ineligible",
        message: "The selected Official Collection release is unavailable.",
      },
      ok: false,
    });
    expect(
      await fixture.workspace.request({ ...prepareRequest, origin: undefined }),
    ).toMatchObject({ error: { code: "mutation_ineligible" }, ok: false });

    expect(await fixture.workspace.request(prepareRequest)).toMatchObject({
      error: { code: "stale_inventory" },
      ok: false,
    });
    await fixture.refresh();
    expect(await fixture.workspace.request(prepareRequest)).toEqual({
      ok: true,
      value: { operationId: "plan-1" },
    });
    expect(fixture.prepareMutation).toHaveBeenCalledTimes(1);
    expect(fixture.prepareMutation.mock.calls[0]?.[0]?.intent).toEqual({
      names: ["find-skills"],
      scope: "project",
      source: { source: "vercel-labs/skills", sourceType: "github" },
      type: "add",
    });
    expect(await fixture.workspace.snapshot()).toMatchObject({
      collections: {
        plan: {
          collectionId: "team.review",
          manifestDigest: release.document.documentDigest,
          releaseEvidence: {
            compatibility: {
              dialectId: "skills-1.5.23",
              harnessIds: ["codex"],
            },
            documentDigest: release.document.documentDigest,
            importedAt: "2026-08-21T10:00:00.000Z",
            origin: "imported",
          },
          schemaVersion: 1,
          source: { repository: "vercel-labs/skills", reviewedRevision: null },
        },
      },
      mutation: { phase: "planned" },
    });

    expect(
      await fixture.workspace.request({
        collectionPlanId: "plan-1",
        type: "collection.review.request",
        version: 2,
      }),
    ).toEqual({ ok: true, value: { operationId: "review-1" } });
    const review = fixture.capabilities.attach(
      {
        endpointId: "review-1",
        reviewId: "review-1",
        role: "review",
        sessionEpoch: "review-epoch",
      },
      () => undefined,
    );
    expect(await review.snapshot()).toMatchObject({
      projection: {
        collectionPlan: {
          releaseEvidence: { origin: "imported" },
          source: { reviewedRevision: null },
        },
      },
      status: "pending",
    });
    // Imported Packages never write Official acknowledgements.
    expect(fixture.lifecycle).toEqual([
      "packages.replace",
      "inventory.replace",
    ]);
    expect(fixture.lifecycle).not.toContain(
      "collections.acknowledgements.replace",
    );
  });
});
