import { createHash } from "node:crypto";
import { isAbsolute, normalize, posix } from "node:path";

import { z } from "zod";

import {
  HARNESS_REGISTRY_DIGEST,
  HARNESS_REGISTRY_VERSION,
  normalizeHarnessIds,
  SKILLS_DIALECT_ID,
  type Result,
} from "@skills-desktop/skills-runtime";

import type { RendererError, TargetDraft } from "../../contracts/workspace.js";
import type { SkillsProcess } from "../adapters/skills-process.js";
import type { OpenSshTargetAccess } from "../ssh/openssh-target.js";
import type {
  EffectiveTargetBinding,
  SkillsTargets,
  TargetDefinition,
  TargetDefinitionProposal,
} from "./skills-targets.js";
import { localWorkspaceLabel } from "./workspace-path.js";

const uuidSchema = z.string().uuid();

function definitionError<Code extends RendererError["code"]>(
  code: Code,
  message: string,
  phase: string,
): Result<never, RendererError & { readonly code: Code }> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase,
      retryable: false,
    },
    ok: false,
  };
}

async function canonicalTargetDraft(
  draft: TargetDraft,
  canonicalizeLocalWorkspace: (workspace: string) => Promise<string>,
): Promise<Result<Omit<TargetDefinition, "generation" | "id">, RendererError>> {
  let workspace: string | undefined;
  if (draft.kind === "ssh") {
    workspace = posix.isAbsolute(draft.workspace)
      ? posix.normalize(draft.workspace)
      : undefined;
  } else if (isAbsolute(draft.workspace)) {
    workspace = await canonicalizeLocalWorkspace(draft.workspace).catch(
      () => undefined,
    );
    if (workspace !== undefined) workspace = normalize(workspace);
  }
  const connectionReference = draft.connectionReference?.trim() ?? null;
  if (
    workspace === undefined ||
    (draft.kind === "local"
      ? !isAbsolute(workspace)
      : !posix.isAbsolute(workspace)) ||
    workspace.includes("\0") ||
    draft.label.trim().length === 0 ||
    (draft.kind === "local" && connectionReference !== null) ||
    (draft.kind === "ssh" &&
      (connectionReference === null ||
        connectionReference.length === 0 ||
        /\s|\0/.test(connectionReference)))
  ) {
    return definitionError(
      "invalid_request",
      "Target Definition is not valid.",
      "validate",
    );
  }
  const harnessIds = normalizeHarnessIds(
    Array.isArray(draft.harnessIds) ? draft.harnessIds : [],
  );
  if (!harnessIds.ok) {
    return definitionError(
      "invalid_request",
      "Target Definition is not valid.",
      "validate",
    );
  }
  return {
    ok: true,
    value: {
      connectionReference,
      dialectId: SKILLS_DIALECT_ID,
      executionBindingDigest: null,
      harnessIds: [...harnessIds.value],
      kind: draft.kind,
      label: draft.label.trim(),
      registryDigest: HARNESS_REGISTRY_DIGEST,
      registryVersion: HARNESS_REGISTRY_VERSION,
      workspace,
      workspaceLabel:
        draft.kind === "ssh"
          ? posix.basename(workspace) || workspace
          : localWorkspaceLabel(workspace),
    },
  };
}

export function createSkillsTargetsCatalog(input: {
  readonly canonicalizeLocalWorkspace?: (workspace: string) => Promise<string>;
  readonly id: () => string;
  readonly initialTarget: TargetDefinition;
  readonly legacyIdFor?: (target: TargetDefinition) => string | undefined;
  readonly processFor: (binding: EffectiveTargetBinding) => SkillsProcess;
  readonly sshAccess?: OpenSshTargetAccess;
}): SkillsTargets {
  if (!uuidSchema.safeParse(input.initialTarget.id).success) {
    throw new Error("SkillsTargets requires an application-generated UUID.");
  }
  let definitions: readonly TargetDefinition[] = [input.initialTarget];
  const canonicalizeLocalWorkspace =
    input.canonicalizeLocalWorkspace ??
    (async (workspace: string) => workspace);

  const proposal = async (
    draft: TargetDraft,
    existing?: TargetDefinition,
  ): Promise<Result<TargetDefinitionProposal, RendererError>> => {
    const normalized = await canonicalTargetDraft(
      draft,
      canonicalizeLocalWorkspace,
    );
    if (!normalized.ok) return normalized;
    const generatedId = existing?.id ?? input.id();
    if (
      !uuidSchema.safeParse(generatedId).success ||
      (existing === undefined &&
        definitions.some(({ id }) => id === generatedId))
    ) {
      return definitionError(
        "internal_error",
        "A stable Target identity could not be generated.",
        "target",
      );
    }
    const executionChanged =
      existing !== undefined &&
      (existing.kind !== normalized.value.kind ||
        existing.workspace !== normalized.value.workspace ||
        JSON.stringify(existing.harnessIds) !==
          JSON.stringify(normalized.value.harnessIds) ||
        (existing.connectionReference ?? null) !==
          normalized.value.connectionReference);
    const target: TargetDefinition = {
      ...normalized.value,
      executionBindingDigest:
        existing === undefined || executionChanged
          ? null
          : (existing.executionBindingDigest ?? null),
      generation:
        existing === undefined
          ? 1
          : existing.generation + (executionChanged ? 1 : 0),
      id: generatedId,
    };
    return {
      ok: true,
      value: {
        definitions:
          existing === undefined
            ? [...definitions, target]
            : definitions.map((definition) =>
                definition.id === existing.id ? target : definition,
              ),
        executionChanged,
        target,
      },
    };
  };

  return {
    async commitHostTrust(targetId, challengeId, expectedGeneration) {
      const selected = definitions.find(({ id }) => id === targetId);
      if (selected === undefined) {
        return definitionError(
          "target_not_found",
          "Target was not found.",
          "trust",
        );
      }
      if (selected.kind !== "ssh" || input.sshAccess === undefined) {
        return definitionError(
          "target_unavailable",
          "SSH host trust is not available in this build.",
          "trust",
        );
      }
      if (selected.generation !== expectedGeneration) {
        return definitionError(
          "host_trust_invalid",
          "The host-trust review no longer matches this Target.",
          "trust",
        );
      }
      const confirmed = await input.sshAccess.confirm(challengeId, selected);
      if (!confirmed.ok) return confirmed;
      const target: TargetDefinition = {
        ...selected,
        executionBindingDigest: confirmed.value.bindingDigest,
        generation: selected.generation + 1,
      };
      return {
        ok: true,
        value: {
          definitions: definitions.map((definition) =>
            definition.id === target.id ? target : definition,
          ),
          executionChanged: true,
          target,
        },
      };
    },
    get definitions() {
      return definitions;
    },
    get primaryTarget() {
      return definitions[0] ?? input.initialTarget;
    },
    legacyIdFor(target) {
      return input.legacyIdFor?.(target);
    },
    async open(targetId) {
      const selected = definitions.find(({ id }) => id === targetId);
      if (selected === undefined) {
        return definitionError(
          "target_not_found",
          "Target was not found.",
          "open",
        );
      }
      if (selected.kind === "ssh") {
        if (input.sshAccess === undefined) {
          return definitionError(
            "target_unavailable",
            "SSH Target refresh is not available in this build.",
            "open",
          );
        }
        const inspected = await input.sshAccess.inspect(selected);
        if (!inspected.ok) return inspected;
        if (
          (selected.executionBindingDigest ?? null) !==
          inspected.value.bindingDigest
        ) {
          const bindingChanged = selected.executionBindingDigest !== null;
          const target: TargetDefinition = {
            ...selected,
            executionBindingDigest: inspected.value.bindingDigest,
            generation: selected.generation + (bindingChanged ? 1 : 0),
          };
          return {
            ok: true,
            value: {
              proposal: {
                definitions: definitions.map((definition) =>
                  definition.id === target.id ? target : definition,
                ),
                executionChanged: bindingChanged,
                target,
              },
              status: "binding-changed",
            },
          };
        }
        if (inspected.value.status === "trust-required") {
          return {
            ok: true,
            value: {
              challenge: inspected.value.challenge,
              status: "trust-required",
            },
          };
        }
        const binding: EffectiveTargetBinding = {
          generation: selected.generation,
          harnessIds: selected.harnessIds,
          kind: selected.kind,
          ssh: inspected.value.binding,
          targetId: selected.id,
          workspace: selected.workspace,
        };
        return {
          ok: true,
          value: {
            binding,
            process: input.processFor(binding),
            target: selected,
          },
        };
      }
      const binding: EffectiveTargetBinding = {
        generation: selected.generation,
        harnessIds: selected.harnessIds,
        kind: selected.kind,
        targetId: selected.id,
        workspace: selected.workspace,
      };
      return {
        ok: true,
        value: {
          binding,
          process: input.processFor(binding),
          target: selected,
        },
      };
    },
    pendingHostTrust(targetId) {
      return input.sshAccess?.pendingChallenge(targetId);
    },
    proposeHostTrust(targetId, challengeId) {
      const selected = definitions.find(({ id }) => id === targetId);
      const challenge = input.sshAccess?.pendingChallenge(targetId);
      if (
        selected === undefined ||
        selected.kind !== "ssh" ||
        challenge === undefined ||
        challenge.id !== challengeId ||
        challenge.targetGeneration !== selected.generation
      ) {
        return definitionError(
          "host_trust_invalid",
          "The host-trust review no longer matches this Target.",
          "trust",
        );
      }
      const target: TargetDefinition = {
        ...selected,
        generation: selected.generation + 1,
      };
      return {
        ok: true,
        value: {
          definitions: definitions.map((definition) =>
            definition.id === target.id ? target : definition,
          ),
          executionChanged: true,
          target,
        },
      };
    },
    proposeCreate(draft) {
      return proposal(draft);
    },
    proposeDelete(targetId) {
      const target = definitions.find(({ id }) => id === targetId);
      if (target === undefined) {
        return definitionError(
          "target_not_found",
          "Target was not found.",
          "target",
        );
      }
      return {
        ok: true,
        value: {
          definitions: definitions.filter(({ id }) => id !== targetId),
          executionChanged: true,
          target,
        },
      };
    },
    proposeUpdate(targetId, draft) {
      const existing = definitions.find(({ id }) => id === targetId);
      if (existing === undefined) {
        return Promise.resolve(
          definitionError(
            "target_not_found",
            "Target was not found.",
            "target",
          ),
        );
      }
      return proposal(draft, existing);
    },
    replaceDefinitions(nextDefinitions) {
      definitions = nextDefinitions.map((definition) => ({ ...definition }));
    },
  };
}

export function createLocalSkillsTargets(input: {
  readonly canonicalizeLocalWorkspace?: (workspace: string) => Promise<string>;
  readonly id: () => string;
  readonly processFor: (binding: EffectiveTargetBinding) => SkillsProcess;
  readonly sshAccess?: OpenSshTargetAccess;
  readonly workspace: string;
}): SkillsTargets {
  const target: TargetDefinition = {
    connectionReference: null,
    dialectId: SKILLS_DIALECT_ID,
    executionBindingDigest: null,
    generation: 1,
    harnessIds: ["codex"],
    id: input.id(),
    kind: "local",
    label: "This device",
    registryDigest: HARNESS_REGISTRY_DIGEST,
    registryVersion: HARNESS_REGISTRY_VERSION,
    workspace: input.workspace,
    workspaceLabel: localWorkspaceLabel(input.workspace),
  };
  return createSkillsTargetsCatalog({
    canonicalizeLocalWorkspace: input.canonicalizeLocalWorkspace,
    id: input.id,
    initialTarget: target,
    legacyIdFor(definition) {
      if (definition.kind !== "local") return undefined;
      const workspaceIdentity = createHash("sha256")
        .update(definition.workspace)
        .digest("hex")
        .slice(0, 24);
      return `local-codex-${workspaceIdentity}`;
    },
    processFor: input.processFor,
    sshAccess: input.sshAccess,
  });
}
