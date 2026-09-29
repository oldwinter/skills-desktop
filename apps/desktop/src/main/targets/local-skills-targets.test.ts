import { normalize } from "node:path";

import { describe, expect, it } from "vitest";

import type { SkillsProcess } from "../adapters/local-skills-process.js";
import type { TargetDefinition } from "../../contracts/workspace.js";
import {
  createLocalSkillsTargets,
  createSkillsTargetsCatalog,
} from "./local-skills-targets.js";

const process: SkillsProcess = {
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

const sshTargetDefinition: TargetDefinition = {
  connectionReference: "build-host",
  dialectId: "skills-1.5.23",
  executionBindingDigest: "a".repeat(64),
  generation: 4,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000031",
  kind: "ssh" as const,
  label: "Build host",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/srv/project",
  workspaceLabel: "project",
};

const localTargetDefinition: TargetDefinition = {
  connectionReference: null,
  dialectId: "skills-1.5.23",
  executionBindingDigest: null,
  generation: 1,
  harnessIds: ["codex"],
  id: "00000000-0000-4000-8000-000000000001",
  kind: "local" as const,
  label: "This device",
  registryDigest:
    "sha256:36d0c792e0480a13818d890e1dccc93e3b29a4ea44af78091e80db8a3e9181de",
  registryVersion: 1,
  workspace: "/work/alpha",
  workspaceLabel: "alpha",
};

describe("Local SkillsTargets mutation guards", () => {
  const catalogWith = (sshAccess?: {
    confirm: (...args: unknown[]) => unknown;
    pendingChallenge: (...args: unknown[]) => unknown;
  }) =>
    createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: localTargetDefinition,
      processFor: () => process,
      ...(sshAccess === undefined ? {} : { sshAccess: sshAccess as never }),
    });

  it("deletes an existing Target and reports a missing one honestly", async () => {
    const catalog = createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: localTargetDefinition,
      processFor: () => process,
    });
    catalog.replaceDefinitions([localTargetDefinition, sshTargetDefinition]);

    const deleted = await catalog.proposeDelete(sshTargetDefinition.id);
    expect(deleted).toMatchObject({
      ok: true,
      value: {
        definitions: [{ id: localTargetDefinition.id }],
        executionChanged: true,
        target: { id: sshTargetDefinition.id },
      },
    });

    expect(
      catalog.proposeDelete("00000000-0000-4000-8000-000000000042"),
    ).toMatchObject({
      error: { code: "target_not_found", phase: "target" },
      ok: false,
    });
    await expect(
      catalog.proposeUpdate("00000000-0000-4000-8000-000000000042", {
        connectionReference: null,
        harnessIds: ["codex"],
        kind: "local",
        label: "Missing",
        workspace: "/work/none",
      }),
    ).resolves.toMatchObject({
      error: { code: "target_not_found", phase: "target" },
      ok: false,
    });
  });

  it("rejects host-trust proposals that no longer match the Target", async () => {
    const challenge = { id: "challenge-1", targetGeneration: 4 };
    const catalog = catalogWith({
      confirm: async () => ({ ok: true, value: { bindingDigest: "c".repeat(64) } }),
      pendingChallenge: (targetId) =>
        targetId === sshTargetDefinition.id ? challenge : undefined,
    });
    catalog.replaceDefinitions([localTargetDefinition, sshTargetDefinition]);

    // Unknown Target id.
    expect(
      catalog.proposeHostTrust(
        "00000000-0000-4000-8000-000000000042",
        "challenge-1",
      ),
    ).toMatchObject({
      error: { code: "host_trust_invalid", phase: "trust" },
      ok: false,
    });
    // Local Target: no SSH challenge can apply.
    expect(
      catalog.proposeHostTrust(localTargetDefinition.id, "challenge-1"),
    ).toMatchObject({
      error: { code: "host_trust_invalid", phase: "trust" },
      ok: false,
    });
    // Wrong challenge id.
    expect(
      catalog.proposeHostTrust(sshTargetDefinition.id, "challenge-other"),
    ).toMatchObject({
      error: { code: "host_trust_invalid", phase: "trust" },
      ok: false,
    });
    // Challenge pinned to a stale generation.
    catalog.replaceDefinitions([
      localTargetDefinition,
      { ...sshTargetDefinition, generation: 9 },
    ]);
    expect(
      catalog.proposeHostTrust(sshTargetDefinition.id, "challenge-1"),
    ).toMatchObject({
      error: { code: "host_trust_invalid", phase: "trust" },
      ok: false,
    });
    // No pending challenge at all.
    expect(
      catalog.proposeHostTrust(
        "00000000-0000-4000-8000-000000000043",
        "challenge-1",
      ),
    ).toMatchObject({
      error: { code: "host_trust_invalid", phase: "trust" },
      ok: false,
    });

    // A matching challenge proposes exactly one generation bump.
    catalog.replaceDefinitions([localTargetDefinition, sshTargetDefinition]);
    const proposed = await catalog.proposeHostTrust(
      sshTargetDefinition.id,
      "challenge-1",
    );
    expect(proposed).toMatchObject({
      ok: true,
      value: { target: { generation: 5, id: sshTargetDefinition.id } },
    });
  });

  it("commits host trust only when the review still matches, binding the digest", async () => {
    const challenge = { id: "challenge-1", targetGeneration: 4 };
    const catalog = catalogWith({
      confirm: async () => ({
        ok: true,
        value: { bindingDigest: "c".repeat(64) },
      }),
      pendingChallenge: (targetId) =>
        targetId === sshTargetDefinition.id ? challenge : undefined,
    });
    catalog.replaceDefinitions([localTargetDefinition, sshTargetDefinition]);

    // Unknown Target.
    await expect(
      catalog.commitHostTrust(
        "00000000-0000-4000-8000-000000000042",
        "challenge-1",
        4,
      ),
    ).resolves.toMatchObject({
      error: { code: "target_not_found", phase: "trust" },
      ok: false,
    });
    // Local Target has no SSH trust surface.
    await expect(
      catalog.commitHostTrust(localTargetDefinition.id, "challenge-1", 1),
    ).resolves.toMatchObject({
      error: { code: "target_unavailable", phase: "trust" },
      ok: false,
    });
    // Generation drifted since the review was taken.
    await expect(
      catalog.commitHostTrust(sshTargetDefinition.id, "challenge-1", 99),
    ).resolves.toMatchObject({
      error: { code: "host_trust_invalid", phase: "trust" },
      ok: false,
    });

    const committed = await catalog.commitHostTrust(
      sshTargetDefinition.id,
      "challenge-1",
      4,
    );
    expect(committed).toMatchObject({
      ok: true,
      value: {
        executionChanged: true,
        target: {
          executionBindingDigest: "c".repeat(64),
          generation: 5,
          id: sshTargetDefinition.id,
        },
      },
    });
    if (!committed.ok) throw new Error("commit expected");
    expect(
      committed.value.definitions.find(({ id }) => id === sshTargetDefinition.id)
        ?.executionBindingDigest,
    ).toBe("c".repeat(64));
  });

  it("propagates a failed confirm and reports host trust unavailable without SSH access", async () => {
    const failing = {
      confirm: async () => ({
        error: { code: "host_trust_invalid", phase: "trust" },
        ok: false,
      }),
      pendingChallenge: () => ({ id: "challenge-1", targetGeneration: 4 }),
    };
    const failingCatalog = catalogWith(failing);
    failingCatalog.replaceDefinitions([
      localTargetDefinition,
      sshTargetDefinition,
    ]);
    await expect(
      failingCatalog.commitHostTrust(
        sshTargetDefinition.id,
        "challenge-1",
        4,
      ),
    ).resolves.toMatchObject({
      error: { code: "host_trust_invalid" },
      ok: false,
    });

    // A Local-only catalog has no sshAccess at all.
    const localOnly = catalogWith();
    localOnly.replaceDefinitions([localTargetDefinition, sshTargetDefinition]);
    await expect(
      localOnly.commitHostTrust(sshTargetDefinition.id, "challenge-1", 4),
    ).resolves.toMatchObject({
      error: { code: "target_unavailable", phase: "trust" },
      ok: false,
    });
  });
});


describe("Local SkillsTargets draft and open failure edges", () => {
  const catalogWith = (sshAccess?: {
    confirm: (...args: unknown[]) => unknown;
    inspect: (...args: unknown[]) => unknown;
    pendingChallenge: (...args: unknown[]) => unknown;
  }) =>
    createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: localTargetDefinition,
      processFor: () => process,
      ...(sshAccess === undefined ? {} : { sshAccess: sshAccess as never }),
    });
  it("requires an application-generated UUID for the initial Target", () => {
    expect(() =>
      createSkillsTargetsCatalog({
        id: () => "00000000-0000-4000-8000-000000000099",
        initialTarget: { ...localTargetDefinition, id: "not-a-uuid" },
        processFor: () => process,
      }),
    ).toThrow(/UUID/);
  });

  it("rejects an SSH draft whose connection reference carries whitespace", async () => {
    const catalog = catalogWith();
    await expect(
      catalog.proposeCreate({
        connectionReference: "bad host",
        harnessIds: ["codex"],
        kind: "ssh",
        label: "Build host",
        workspace: "/srv/project",
      }),
    ).resolves.toMatchObject({
      error: { code: "invalid_request" },
      ok: false,
    });
  });

  it("rejects a draft whose harness ids do not normalize", async () => {
    const catalog = catalogWith();
    await expect(
      catalog.proposeCreate({
        connectionReference: null,
        harnessIds: ["not-a-harness"],
        kind: "local",
        label: "Local",
        workspace: "/work/alpha",
      }),
    ).resolves.toMatchObject({
      error: { code: "invalid_request" },
      ok: false,
    });
  });

  it("rejects a Local draft when workspace canonicalization fails", async () => {
    const catalog = createSkillsTargetsCatalog({
      canonicalizeLocalWorkspace: async () => {
        throw new Error("unresolvable");
      },
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: localTargetDefinition,
      processFor: () => process,
    });
    await expect(
      catalog.proposeCreate({
        connectionReference: null,
        harnessIds: ["codex"],
        kind: "local",
        label: "Broken",
        workspace: "/work/broken",
      }),
    ).resolves.toMatchObject({
      error: { code: "invalid_request" },
      ok: false,
    });
  });

  it("reports an unknown Target id on open", async () => {
    const catalog = catalogWith();
    await expect(
      catalog.open("00000000-0000-4000-8000-00000000dead"),
    ).resolves.toMatchObject({
      error: { code: "target_not_found" },
      ok: false,
    });
  });

  it("propagates a failed SSH binding inspection on open", async () => {
    const catalog = catalogWith({
      confirm: async () => ({ ok: false }),
      inspect: async () => ({
        error: {
          code: "remote_unreachable" as const,
          effects: "none" as const,
          message: "Host does not answer.",
          phase: "open",
          retryable: true,
        },
        ok: false as const,
      }),
      pendingChallenge: async () => null,
    });
    catalog.replaceDefinitions([localTargetDefinition, sshTargetDefinition]);
    await expect(
      catalog.open(sshTargetDefinition.id),
    ).resolves.toMatchObject({
      error: { code: "remote_unreachable" },
      ok: false,
    });
  });
});
