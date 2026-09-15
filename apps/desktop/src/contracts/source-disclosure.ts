import type { SourceFamily } from "@skills-desktop/skills-runtime";

import { createTranslator, type MessageKey } from "./i18n/translate.js";
import { DEFAULT_LOCALE, type Locale } from "./preferences.js";
import type { CommandPlanSource } from "./workspace.js";

export type SourceMutability = "mutable" | "pinned";

export interface SourceDisclosure {
  readonly family: SourceFamily;
  readonly familyLabel: string;
  readonly mutability: SourceMutability;
  readonly source: string;
  readonly summary: string;
  readonly title: string;
}

const FAMILY_KEYS: Readonly<Record<SourceFamily, MessageKey>> = {
  git: "source.family.git",
  github: "source.family.github",
  gitlab: "source.family.gitlab",
  "http-archive": "source.family.httpArchive",
  "http-skill": "source.family.httpSkill",
  "local-archive": "source.family.localArchive",
  "local-directory": "source.family.localDirectory",
  "skills-sh-pack": "source.family.skillsShPack",
  "well-known": "source.family.wellKnown",
};

/**
 * ADR 0015: discloses where an add Command Plan fetches from and whether that
 * content can still move before execution. Legacy GitHub sources are pinned
 * only when they carry an exact revision; inspected sources carry the
 * mutability the descriptor was classified with. The source text is shown
 * verbatim; only the surrounding prose is localized.
 */
export function describeCommandPlanSource(
  source: CommandPlanSource,
  locale: Locale = DEFAULT_LOCALE,
): SourceDisclosure {
  const { t } = createTranslator(locale);
  const family: SourceFamily =
    source.sourceType === "inspected" ? source.family : "github";
  const mutability: SourceMutability =
    source.sourceType === "inspected"
      ? source.mutability
      : source.revision === undefined
        ? "mutable"
        : "pinned";
  const text =
    source.sourceType === "github" && source.revision !== undefined
      ? `${source.source}@${source.revision}`
      : source.source;
  return {
    family,
    familyLabel: t(FAMILY_KEYS[family]),
    mutability,
    source: text,
    summary: t(
      mutability === "pinned"
        ? "source.mutability.pinned.summary"
        : "source.mutability.mutable.summary",
      { source: text },
    ),
    title: t(
      mutability === "pinned"
        ? "source.mutability.pinned.title"
        : "source.mutability.mutable.title",
    ),
  };
}
