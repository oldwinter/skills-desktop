import type { HarnessId } from "@skills-desktop/skills-runtime";

/**
 * Illustrative data for the hero figure. It is marketing copy, not product state,
 * and it deliberately reuses nothing from the packaged inventory fixtures.
 */

export type InventoryScope = "project" | "global";

export interface IllustrativeSkill {
  readonly name: string;
  readonly scope: InventoryScope;
}

export interface IllustrativeHarness {
  readonly id: HarnessId;
  readonly label: string;
  readonly path: string;
}

export interface IllustrativeTarget {
  readonly id: string;
  readonly label: string;
  readonly workspace: string;
  readonly skills: readonly string[];
  readonly harnesses: readonly HarnessId[];
}

export const ILLUSTRATIVE_SKILLS: readonly IllustrativeSkill[] = [
  { name: "find-skills", scope: "global" },
  { name: "skill-creator", scope: "global" },
  { name: "project-context", scope: "project" },
  { name: "frontend-design", scope: "project" },
  { name: "react-best-practices", scope: "project" },
  { name: "adversarial-review", scope: "global" },
  { name: "brainstorming", scope: "global" },
  { name: "note-manager", scope: "project" },
];

export const ILLUSTRATIVE_HARNESSES: readonly IllustrativeHarness[] = [
  { id: "claude-code", label: "Claude Code", path: "~/.claude/skills" },
  { id: "codex", label: "Codex", path: "~/.codex/skills" },
  { id: "cursor", label: "Cursor", path: "~/.cursor/skills" },
  { id: "gemini-cli", label: "Gemini CLI", path: "~/.gemini/skills" },
  { id: "opencode", label: "OpenCode", path: "~/.config/opencode/skills" },
];

export const ILLUSTRATIVE_TARGETS: readonly IllustrativeTarget[] = [
  {
    harnesses: ["claude-code", "codex", "cursor"],
    id: "web-app",
    label: "web-app",
    skills: [
      "find-skills",
      "skill-creator",
      "project-context",
      "frontend-design",
      "react-best-practices",
      "adversarial-review",
    ],
    workspace: "~/code/web-app",
  },
  {
    harnesses: ["codex", "gemini-cli", "opencode"],
    id: "api",
    label: "api",
    skills: ["find-skills", "skill-creator", "project-context", "adversarial-review", "brainstorming"],
    workspace: "~/code/api",
  },
  {
    harnesses: ["claude-code", "cursor"],
    id: "notes",
    label: "notes",
    skills: ["find-skills", "brainstorming", "note-manager"],
    workspace: "~/notes",
  },
];

export function targetById(id: string): IllustrativeTarget {
  const target = ILLUSTRATIVE_TARGETS.find((candidate) => candidate.id === id);
  if (target === undefined) {
    throw new Error(`Unknown illustrative target ${id}.`);
  }
  return target;
}
