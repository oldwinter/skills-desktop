import { createHash } from "node:crypto";
import { basename, isAbsolute, normalize, posix } from "node:path";

import { z } from "zod";

import type { Result } from "@skills-desktop/skills-runtime";

import type { RendererError, TargetDraft } from "../../contracts/workspace.js";
import type { SkillsProcess } from "../adapters/local-skills-process.js";
import type {
  EffectiveTargetBinding,
  SkillsTargets,
  TargetDefinition,
  TargetDefinitionProposal,
} from "./skills-targets.js";

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
    draft.harness.trim().length === 0 ||
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
  return {
    ok: true,
    value: {
      connectionReference,
      harness: draft.harness.trim(),
      kind: draft.kind,
      label: draft.label.trim(),
      workspace,
      workspaceLabel:
        draft.kind === "ssh"
          ? posix.basename(workspace) || workspace
          : basename(workspace),
    },
  };
}

export function createSkillsTargetsCatalog(input: {
  readonly canonicalizeLocalWorkspace?: (workspace: string) => Promise<string>;
  readonly id: () => string;
  readonly initialTarget: TargetDefinition;
  readonly legacyIdFor?: (target: TargetDefinition) => string | undefined;
  readonly processFor: (binding: EffectiveTargetBinding) => SkillsProcess;
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
        existing.harness !== normalized.value.harness ||
        (existing.connectionReference ?? null) !==
          normalized.value.connectionReference);
    const target: TargetDefinition = {
      ...normalized.value,
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
        return definitionError(
          "target_unavailable",
          "SSH Target refresh is not available in this build.",
          "open",
        );
      }
      const binding: EffectiveTargetBinding = {
        generation: selected.generation,
        harness: selected.harness,
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
  readonly workspace: string;
  readonly workspaceLabel: string;
}): SkillsTargets {
  const target: TargetDefinition = {
    connectionReference: null,
    generation: 1,
    harness: "Codex",
    id: input.id(),
    kind: "local",
    label: "This device",
    workspace: input.workspace,
    workspaceLabel: input.workspaceLabel,
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
  });
}
