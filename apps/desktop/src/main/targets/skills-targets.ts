import type { Result } from "@skills-desktop/skills-runtime";

import type {
  RendererError,
  TargetDraft,
} from "../../contracts/workspace.js";
import type { SkillsProcess } from "../adapters/local-skills-process.js";

export type TargetOpenError = Omit<RendererError, "code"> & {
  readonly code: "target_not_found" | "target_unavailable";
};

export interface TargetDefinition {
  readonly connectionReference?: string | null;
  readonly generation: number;
  readonly harness: string;
  readonly id: string;
  readonly kind: "local" | "ssh";
  readonly label: string;
  readonly workspace: string;
  readonly workspaceLabel: string;
}

export interface EffectiveTargetBinding {
  readonly generation: number;
  readonly harness: string;
  readonly kind: TargetDefinition["kind"];
  readonly targetId: string;
  readonly workspace: string;
}

export interface TargetSession {
  readonly binding: EffectiveTargetBinding;
  readonly process: SkillsProcess;
  readonly target: TargetDefinition;
}

export interface TargetDefinitionProposal {
  readonly definitions: readonly TargetDefinition[];
  readonly executionChanged: boolean;
  readonly target: TargetDefinition;
}

export interface SkillsTargets {
  readonly definitions: readonly TargetDefinition[];
  readonly primaryTarget: TargetDefinition;
  legacyIdFor(target: TargetDefinition): string | undefined;
  open(targetId: string): Promise<Result<TargetSession, TargetOpenError>>;
  proposeCreate(
    draft: TargetDraft,
  ): Promise<Result<TargetDefinitionProposal, RendererError>>;
  proposeDelete(
    targetId: string,
  ): Result<TargetDefinitionProposal, RendererError>;
  proposeUpdate(
    targetId: string,
    draft: TargetDraft,
  ): Promise<Result<TargetDefinitionProposal, RendererError>>;
  replaceDefinitions(definitions: readonly TargetDefinition[]): void;
}
