import {
  HARNESS_REGISTRY,
  HARNESS_REGISTRY_VERSION,
  SKILLS_DIALECT_ID,
  type HarnessId,
} from "@skills-desktop/skills-runtime";

export interface HarnessCard {
  readonly id: HarnessId;
  readonly name: string;
  readonly initial: string;
  readonly globalSupported: boolean;
}

const featuredOrder: readonly HarnessId[] = [
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "github-copilot",
  "opencode",
  "windsurf",
  "cline",
  "amp",
  "goose",
  "kilo",
  "roo",
  "droid",
  "zed",
  "warp",
  "trae",
];

export const FEATURED_HARNESS_COUNT = featuredOrder.length;

/** Two-character tile label: first letters of the first two words, or the first two letters. */
export function tileLabel(name: string): string {
  const words = name.split(/[\s./-]+/).filter((word) => word.length > 0);
  const [first = "", second] = words;
  const label = second === undefined ? first.slice(0, 2) : `${first.charAt(0)}${second.charAt(0)}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function toCard(entry: (typeof HARNESS_REGISTRY)[number]): HarnessCard {
  const name = entry.displayAliases[0] ?? entry.cliId;
  return {
    globalSupported: entry.scopeSupport.global,
    id: entry.cliId,
    initial: tileLabel(name),
    name,
  };
}

const byId = new Map(HARNESS_REGISTRY.map((entry) => [entry.cliId, entry]));

export const FEATURED_HARNESSES: readonly HarnessCard[] = featuredOrder.map((id) => {
  const entry = byId.get(id);
  if (entry === undefined) {
    throw new Error(`Featured harness ${id} is missing from the pinned registry.`);
  }
  return toCard(entry);
});

const featured = new Set<HarnessId>(featuredOrder);

export const REMAINING_HARNESSES: readonly HarnessCard[] = HARNESS_REGISTRY.filter(
  (entry) => !featured.has(entry.cliId),
)
  .map(toCard)
  .sort((left, right) => left.name.localeCompare(right.name, "en"));

export const HARNESS_TOTAL = HARNESS_REGISTRY.length;

export const HARNESS_REGISTRY_LABEL = `registry v${HARNESS_REGISTRY_VERSION} · ${SKILLS_DIALECT_ID}`;
