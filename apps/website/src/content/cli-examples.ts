import { CLI_PACKAGE, CLI_VERSION } from "@skills-desktop/skills-runtime";

export type CliExampleId = "verify" | "list" | "add" | "remove" | "update";

export interface CliExample {
  readonly id: CliExampleId;
  /** Exact argument array the main process hands to `npx` (never a shell string). */
  readonly args: readonly string[];
}

/**
 * These mirror the closed operation set planned by the desktop main process.
 * Skill names, sources and harness ids are illustrative; flags are exact.
 */
export const CLI_EXAMPLES: readonly CliExample[] = [
  { args: ["--yes", CLI_PACKAGE, "--version"], id: "verify" },
  { args: ["--yes", CLI_PACKAGE, "list", "--global", "--json"], id: "list" },
  {
    args: [
      "--yes",
      CLI_PACKAGE,
      "add",
      "vercel-labs/skills",
      "--skill",
      "find-skills",
      "--agent",
      "codex",
      "--agent",
      "cursor",
      "--yes",
    ],
    id: "add",
  },
  {
    args: ["--yes", CLI_PACKAGE, "remove", "find-skills", "--agent", "codex", "--global", "--yes"],
    id: "remove",
  },
  {
    args: ["--yes", CLI_PACKAGE, "update", "find-skills", "--project", "--yes"],
    id: "update",
  },
];

export const PINNED_CLI_VERSION = CLI_VERSION;

export function formatArgumentArray(args: readonly string[]): string {
  return `[${args.map((argument) => JSON.stringify(argument)).join(", ")}]`;
}

/** Human-readable preview line. Explanatory output only, never executable input. */
export function formatPreview(args: readonly string[]): string {
  return ["npx", ...args].join(" ");
}
