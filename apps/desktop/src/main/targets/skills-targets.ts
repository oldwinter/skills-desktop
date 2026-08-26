import type { Result } from "@skills-desktop/skills-runtime";

import type {
  RendererError,
  TargetDraft,
  TargetDefinition as PublicTargetDefinition,
} from "../../contracts/workspace.js";
import type { SkillsProcess } from "../adapters/skills-process.js";
import type {
  HostTrustChallenge,
  OpenSshAccessError,
  OpenSshEffectiveBinding,
} from "../ssh/openssh-target.js";

export type TargetOpenError = Omit<RendererError, "code"> & {
  readonly code:
    | "target_not_found"
    | "target_unavailable"
    | OpenSshAccessError["code"];
};

export type TargetDefinition = PublicTargetDefinition;

export interface EffectiveTargetBinding {
  readonly generation: number;
  readonly harnessIds: readonly string[];
  readonly kind: TargetDefinition["kind"];
  readonly ssh?: OpenSshEffectiveBinding;
  readonly targetId: string;
  readonly workspace: string;
}

export type TargetOpenValue =
  | TargetSession
  | {
      readonly proposal: TargetDefinitionProposal;
      readonly status: "binding-changed";
    }
  | {
      readonly challenge: HostTrustChallenge;
      readonly status: "trust-required";
    };

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
  commitHostTrust(
    targetId: string,
    challengeId: string,
    expectedGeneration: number,
  ): Promise<Result<TargetDefinitionProposal, RendererError>>;
  open(targetId: string): Promise<Result<TargetOpenValue, TargetOpenError>>;
  pendingHostTrust(targetId: string): HostTrustChallenge | undefined;
  proposeHostTrust(
    targetId: string,
    challengeId: string,
  ): Result<TargetDefinitionProposal, RendererError>;
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
