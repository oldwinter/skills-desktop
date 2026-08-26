import { normalize } from "node:path";

import { describe, expect, it } from "vitest";

import type { SkillsProcess } from "../adapters/local-skills-process.js";
import {
  createLocalSkillsTargets,
  createSkillsTargetsCatalog,
} from "./local-skills-targets.js";

const process: SkillsProcess = {
  async executeConfirmed() {
    return {
      error: {
        code: "confirmation_invalid",
        effects: "none",
        message: "Not used by this contract.",
        phase: "execute",
        retryable: false,
      },
      ok: false,
    };
  },
  async prepareMutation() {
    return {
      error: {
        code: "mutation_ineligible",
        effects: "none",
        message: "Not used by this contract.",
        phase: "prepare",
        retryable: false,
      },
      ok: false,
    };
  },
  async observeInventory() {
    return {
      error: {
        code: "process_failed",
        effects: "none",
        message: "Not used by this contract.",
        phase: "test",
        retryable: false,
      },
      ok: false,
    };
  },
};

describe("Local SkillsTargets identity", () => {
  it("never exposes an empty label for a filesystem-root workspace", () => {
    const catalog = createLocalSkillsTargets({
      id: () => "00000000-0000-4000-8000-00000000000f",
      processFor: () => process,
      workspace: "/",
    });

    expect(catalog.primaryTarget).toMatchObject({
      workspace: "/",
      workspaceLabel: "/",
    });
  });

  it("uses generated stable identity and opens each restored Local definition with a frozen binding", async () => {
    const bindings: unknown[] = [];
    const first = createLocalSkillsTargets({
      id: () => "00000000-0000-4000-8000-00000000000f",
      processFor(binding) {
        bindings.push(binding);
        return process;
      },
      workspace: "/work/alpha",
    });

    expect(first.primaryTarget.id).toBe("00000000-0000-4000-8000-00000000000f");
    expect(first.primaryTarget).toMatchObject({
      generation: 1,
      workspace: "/work/alpha",
    });

    first.replaceDefinitions([
      first.primaryTarget,
      {
        connectionReference: null,
        dialectId: "skills-1.5.23",
        executionBindingDigest: null,
        generation: 3,
        harnessIds: ["codex"],
        id: "00000000-0000-4000-8000-00000000000d",
        kind: "local",
        label: "Other workspace",
        registryDigest:
          "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
        registryVersion: 1,
        workspace: "/work/beta",
        workspaceLabel: "beta",
      },
      {
        connectionReference: "build-host",
        dialectId: "skills-1.5.23",
        executionBindingDigest: null,
        generation: 2,
        harnessIds: ["codex"],
        id: "00000000-0000-4000-8000-00000000000e",
        kind: "ssh",
        label: "Build host",
        registryDigest:
          "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
        registryVersion: 1,
        workspace: "/srv/project",
        workspaceLabel: "project",
      },
    ]);

    const opened = await first.open("00000000-0000-4000-8000-00000000000d");
    expect(opened).toMatchObject({
      ok: true,
      value: {
        binding: {
          generation: 3,
          harnessIds: ["codex"],
          kind: "local",
          targetId: "00000000-0000-4000-8000-00000000000d",
          workspace: "/work/beta",
        },
        process,
        target: { id: "00000000-0000-4000-8000-00000000000d" },
      },
    });
    expect(bindings).toEqual([
      {
        generation: 3,
        harnessIds: ["codex"],
        kind: "local",
        targetId: "00000000-0000-4000-8000-00000000000d",
        workspace: "/work/beta",
      },
    ]);
    await expect(
      first.open("00000000-0000-4000-8000-00000000000e"),
    ).resolves.toMatchObject({
      error: { code: "target_unavailable", phase: "open" },
      ok: false,
    });
  });

  it("owns UUID creation, canonical workspaces, and Generation proposals", async () => {
    const catalog = createSkillsTargetsCatalog({
      canonicalizeLocalWorkspace: async (workspace) =>
        workspace === "/work/alias" ? "/work/real" : workspace,
      id: () => "00000000-0000-4000-8000-000000000017",
      initialTarget: {
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
        workspace: "/work/alpha",
        workspaceLabel: "alpha",
      },
      processFor: () => process,
    });

    const created = await catalog.proposeCreate({
      connectionReference: null,
      harnessIds: ["codex"],
      kind: "local",
      label: "Alias workspace",
      workspace: "/work/alias",
    });
    expect(created).toMatchObject({
      ok: true,
      value: {
        executionChanged: false,
        target: {
          generation: 1,
          id: "00000000-0000-4000-8000-000000000017",
          workspace: normalize("/work/real"),
          workspaceLabel: "real",
        },
      },
    });
    expect(catalog.definitions).toHaveLength(1);
    if (!created.ok) throw new Error("Expected a Target proposal.");
    catalog.replaceDefinitions(created.value.definitions);

    const updated = await catalog.proposeUpdate(created.value.target.id, {
      connectionReference: null,
      harnessIds: ["codex"],
      kind: "local",
      label: "Moved workspace",
      workspace: "/work/next",
    });
    expect(updated).toMatchObject({
      ok: true,
      value: {
        executionChanged: true,
        target: { generation: 2, workspace: normalize("/work/next") },
      },
    });
  });

  it("rejects a generated Target identity that is not a UUID", async () => {
    const catalog = createSkillsTargetsCatalog({
      id: () => "not-a-uuid",
      initialTarget: {
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
        workspace: "/work/alpha",
        workspaceLabel: "alpha",
      },
      processFor: () => process,
    });

    await expect(
      catalog.proposeCreate({
        connectionReference: "build-host",
        harnessIds: ["codex"],
        kind: "ssh",
        label: "Build host",
        workspace: "/srv/project",
      }),
    ).resolves.toMatchObject({
      error: { code: "internal_error" },
      ok: false,
    });
  });

  it("establishes a missing SSH binding digest without advancing Generation", async () => {
    const catalog = createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000028",
      initialTarget: {
        connectionReference: "build-host",
        dialectId: "skills-1.5.23",
        executionBindingDigest: null,
        generation: 8,
        harnessIds: ["codex"],
        id: "00000000-0000-4000-8000-000000000027",
        kind: "ssh",
        label: "Migrated build host",
        registryDigest:
          "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
        registryVersion: 1,
        workspace: "/srv/project",
        workspaceLabel: "project",
      },
      processFor: () => process,
      sshAccess: {
        inspect: async () => ({
          ok: true,
          value: { bindingDigest: "b".repeat(64) },
        }),
      } as never,
    });

    await expect(
      catalog.open("00000000-0000-4000-8000-000000000027"),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        proposal: {
          executionChanged: false,
          target: {
            executionBindingDigest: "b".repeat(64),
            generation: 8,
          },
        },
        status: "binding-changed",
      },
    });
  });
});
