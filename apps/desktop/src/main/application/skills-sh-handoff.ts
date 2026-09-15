import { createHash } from "node:crypto";

import type { PublicInventoryEntry } from "../../contracts/workspace.js";

/**
 * ADR 0021: the skills.sh integration ends at a bounded publication-data
 * projection plus one main-generated, allowlisted HTTPS URL. The renderer
 * never supplies a URL; it names a record that main derived from reviewed
 * evidence, and main decides whether a browser launch is allowed.
 */

export const SKILLS_SH_HOST = "skills.sh";
export const SKILLS_SH_MAX_URL_LENGTH = 2_048;

/** GitHub owner: 1–39 alphanumerics or hyphens, no leading/trailing hyphen. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
/** GitHub repository name; `.` and `..` are excluded separately. */
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
/** skills.sh skill slug: the pinned CLI's skill-name grammar. */
const SKILL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

export interface SkillsShPublicationData {
  readonly owner: string;
  readonly repository: string;
  /** `null` opens the repository page instead of one skill page. */
  readonly skill: string | null;
}

export interface SkillsShHandoffRecord extends SkillsShPublicationData {
  /** Opaque, session-bound; recomputed from evidence, never persisted. */
  readonly id: string;
  readonly kind: "skills-sh";
  readonly sourceEntry: { readonly name: string; readonly scope: "global" | "project" };
}

export type SkillsShHandoffError =
  | { readonly code: "invalid_publication_data"; readonly message: string }
  | { readonly code: "url_not_allowlisted"; readonly message: string };

export type SkillsShHandoffResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SkillsShHandoffError };

/** Something main may hand a validated URL to. The recorder adapter in tests records instead. */
export interface ExternalBrowser {
  openExternal(url: string): Promise<void>;
}

function hasControlOrSpace(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function invalid(message: string): SkillsShHandoffResult<never> {
  return { error: { code: "invalid_publication_data", message }, ok: false };
}

export function validateSkillsShPublicationData(
  data: SkillsShPublicationData,
): SkillsShHandoffResult<SkillsShPublicationData> {
  const { owner, repository, skill } = data;
  if (hasControlOrSpace(owner) || !OWNER_PATTERN.test(owner)) {
    return invalid("The GitHub owner is not a valid skills.sh path segment.");
  }
  if (
    hasControlOrSpace(repository) ||
    !REPOSITORY_PATTERN.test(repository) ||
    repository === "." ||
    repository === ".." ||
    repository.toLowerCase().endsWith(".git")
  ) {
    return invalid(
      "The GitHub repository is not a valid skills.sh path segment.",
    );
  }
  if (
    skill !== null &&
    (hasControlOrSpace(skill) ||
      !SKILL_SLUG_PATTERN.test(skill) ||
      skill === "." ||
      skill === "..")
  ) {
    return invalid("The skill slug is not a valid skills.sh path segment.");
  }
  return { ok: true, value: { owner, repository, skill } };
}

/** Builds the only URL shape this application opens: `https://skills.sh/{owner}/{repository}[/{skill}]`. */
export function buildSkillsShUrl(
  data: SkillsShPublicationData,
): SkillsShHandoffResult<string> {
  const validated = validateSkillsShPublicationData(data);
  if (!validated.ok) return validated;
  const segments = [validated.value.owner, validated.value.repository];
  if (validated.value.skill !== null) segments.push(validated.value.skill);
  const url = `https://${SKILLS_SH_HOST}/${segments.join("/")}`;
  return assertAllowlistedSkillsShUrl(url);
}

/**
 * Independent allowlist check applied to the final string, so a future
 * builder bug cannot widen what leaves the process: exact https scheme and
 * host, no credentials, port, query, or fragment, two or three plain path
 * segments, and a bounded length.
 */
export function assertAllowlistedSkillsShUrl(
  url: string,
): SkillsShHandoffResult<string> {
  const refuse = (message: string): SkillsShHandoffResult<never> => ({
    error: { code: "url_not_allowlisted", message },
    ok: false,
  });
  if (url.length > SKILLS_SH_MAX_URL_LENGTH) {
    return refuse("The skills.sh URL exceeds the allowed length.");
  }
  if (hasControlOrSpace(url)) {
    return refuse("The skills.sh URL contains control characters or spaces.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse("The skills.sh URL could not be parsed.");
  }
  if (parsed.protocol !== "https:") {
    return refuse("Only https skills.sh URLs may be opened.");
  }
  if (parsed.hostname !== SKILLS_SH_HOST || parsed.host !== SKILLS_SH_HOST) {
    return refuse("Only the skills.sh host may be opened.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return refuse("The skills.sh URL must not carry credentials.");
  }
  if (parsed.search !== "" || parsed.hash !== "" || url.includes("?") || url.includes("#")) {
    return refuse("The skills.sh URL must not carry a query or fragment.");
  }
  const segments = parsed.pathname.split("/").slice(1);
  if (segments.length < 2 || segments.length > 3) {
    return refuse("The skills.sh URL must name a repository or one skill.");
  }
  const [owner, repository, skill] = segments;
  const data = validateSkillsShPublicationData({
    owner: owner ?? "",
    repository: repository ?? "",
    skill: skill ?? null,
  });
  if (!data.ok) return refuse(data.error.message);
  if (parsed.href !== url) {
    return refuse("The skills.sh URL is not in canonical form.");
  }
  return { ok: true, value: url };
}

/** Splits a pinned-CLI declared GitHub source (`owner/repository`) into publication data, or `null` when it is not one. */
export function publicationDataFromDeclaredSource(
  entry: Pick<PublicInventoryEntry, "declaredSource" | "name">,
): SkillsShPublicationData | null {
  if (entry.declaredSource.sourceType !== "github") return null;
  const source = entry.declaredSource.source;
  if (source === null) return null;
  const parts = source.split("/");
  if (parts.length !== 2) return null;
  const data = validateSkillsShPublicationData({
    owner: parts[0] ?? "",
    repository: parts[1] ?? "",
    skill: entry.name,
  });
  return data.ok ? data.value : null;
}

/**
 * Derives the session's handoff records from Fresh Inventory evidence. The id
 * binds the session epoch and Target so a record cannot be replayed into a
 * different session, and it is deterministic so the renderer can hold it
 * across Snapshot republishes.
 */
export function deriveSkillsShHandoffRecords(input: {
  readonly entries: readonly PublicInventoryEntry[];
  readonly sessionEpoch: string;
  readonly targetId: string;
}): readonly SkillsShHandoffRecord[] {
  const records: SkillsShHandoffRecord[] = [];
  for (const entry of input.entries) {
    const data = publicationDataFromDeclaredSource(entry);
    if (data === null) continue;
    const id = createHash("sha256")
      .update(
        [
          "skills-sh-handoff",
          input.sessionEpoch,
          input.targetId,
          entry.scope,
          entry.name,
          data.owner,
          data.repository,
          data.skill ?? "",
        ].join("\0"),
      )
      .digest("hex");
    records.push({
      ...data,
      id,
      kind: "skills-sh",
      sourceEntry: { name: entry.name, scope: entry.scope },
    });
  }
  return records;
}

/** Records every URL instead of launching a browser; used by contract tests and acceptance runs. */
export function createRecordingExternalBrowser(): ExternalBrowser & {
  readonly opened: readonly string[];
} {
  const opened: string[] = [];
  return {
    opened,
    async openExternal(url) {
      opened.push(url);
    },
  };
}
