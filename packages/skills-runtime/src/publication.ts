import { z } from "zod";

import type { PublicError, Result } from "./result.js";
import { canonicalizeJson } from "./skillpack.js";
import { WELL_KNOWN_EXPORT_PROFILE } from "./well-known.js";

/**
 * Git publication (ADR 0020). Everything here is pure: it sanitizes the two
 * strings a user may type (remote and branch), decides which paths the
 * publisher is allowed to manage, and binds a `PublicationPlanV1` to exact
 * digests. No Git runs in this module.
 */

export const PUBLICATION_PLAN_SCHEMA_VERSION = 1 as const;
export const PUBLICATION_PLAN_TTL_MS = 10 * 60_000;
export const PUBLICATION_MAX_REMOTE_LENGTH = 512;
export const PUBLICATION_MAX_BRANCH_LENGTH = 200;
/** The only tree the publisher may add, replace, or remove on the branch. */
export const PUBLICATION_MANAGED_ROOT = WELL_KNOWN_EXPORT_PROFILE.rootDirectory;

export type PublicationRemoteKind = "https" | "http-loopback" | "ssh";

export interface PublicationRemote {
  readonly host: string;
  readonly kind: PublicationRemoteKind;
  /** Sanitized text handed to Git verbatim; never the raw user input. */
  readonly url: string;
}

export type PublicationInputErrorCode =
  "branch_unsupported" | "remote_unsupported";
export type PublicationInputError = PublicError<PublicationInputErrorCode>;

function unsupported(
  code: PublicationInputErrorCode,
  message: string,
): Result<never, PublicationInputError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "sanitize",
      retryable: false,
    },
    ok: false,
  };
}

// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f-\u009f]/;
const HOST =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SCP_LIKE = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):([A-Za-z0-9._/-]+)$/;
const SSH_USER = /^[A-Za-z0-9._-]+$/;
const URL_PATH = /^\/[A-Za-z0-9._~/-]*$/;

function hostIsValid(host: string): boolean {
  return host === "[::1]" || HOST.test(host);
}

/**
 * Accepts exactly: `https://host[:port]/path`, plain `http://` to loopback
 * only (fixture and localhost evidence), `ssh://[user@]host[:port]/path`, and
 * scp-like `user@host:path`. Credentials in the URL, query strings, fragments,
 * whitespace, control characters, option-shaped text, and every other scheme
 * (`file:`, `ext::`, `git:`, bare paths) are refused before Git sees them.
 */
export function sanitizePublicationRemote(
  input: unknown,
): Result<PublicationRemote, PublicationInputError> {
  if (typeof input !== "string") {
    return unsupported("remote_unsupported", "Remote must be text.");
  }
  if (input.length === 0 || input.length > PUBLICATION_MAX_REMOTE_LENGTH) {
    return unsupported("remote_unsupported", "Remote is empty or too long.");
  }
  if (CONTROL_OR_SPACE.test(input)) {
    return unsupported(
      "remote_unsupported",
      "Remote must not contain whitespace or control characters.",
    );
  }
  if (input.startsWith("-")) {
    return unsupported(
      "remote_unsupported",
      "Remote must not look like an option.",
    );
  }
  const scpLike = SCP_LIKE.exec(input);
  if (scpLike !== null) {
    const [, user, host, path] = scpLike;
    if (!hostIsValid(host!) || path!.includes("..") || path!.startsWith("/")) {
      return unsupported(
        "remote_unsupported",
        "SSH remote host or path is not supported.",
      );
    }
    return {
      ok: true,
      value: { host: host!, kind: "ssh", url: `${user}@${host}:${path}` },
    };
  }
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//
    .exec(input)?.[1]
    ?.toLowerCase();
  if (scheme === undefined) {
    return unsupported(
      "remote_unsupported",
      "Remote must be an https://, ssh:// or user@host:path Git remote.",
    );
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return unsupported("remote_unsupported", "Remote URL could not be parsed.");
  }
  if (url.username !== "" && scheme !== "ssh") {
    return unsupported(
      "remote_unsupported",
      "Remote must not embed credentials.",
    );
  }
  if (url.password !== "") {
    return unsupported(
      "remote_unsupported",
      "Remote must not embed credentials.",
    );
  }
  if (
    url.search !== "" ||
    url.hash !== "" ||
    input.includes("?") ||
    input.includes("#")
  ) {
    return unsupported(
      "remote_unsupported",
      "Remote must not carry a query or fragment.",
    );
  }
  const host = url.hostname;
  if (host === "" || !hostIsValid(host)) {
    return unsupported("remote_unsupported", "Remote host is not supported.");
  }
  const path = url.pathname;
  if (!URL_PATH.test(path) || path.includes("..") || path === "/") {
    return unsupported("remote_unsupported", "Remote path is not supported.");
  }
  const port = url.port === "" ? "" : `:${url.port}`;
  // Git receives exactly what the user reviewed: any normalisation the URL
  // parser applied (dot segments, case, default ports, percent-encoding) is
  // a refusal rather than a silent rewrite.
  const exact = (
    kind: PublicationRemoteKind,
    rebuilt: string,
  ): Result<PublicationRemote, PublicationInputError> =>
    rebuilt === input
      ? { ok: true, value: { host, kind, url: rebuilt } }
      : unsupported(
          "remote_unsupported",
          "Remote must be written in its canonical form.",
        );
  if (scheme === "https") {
    return exact("https", `https://${host}${port}${path}`);
  }
  if (scheme === "http") {
    if (!LOOPBACK_HOSTS.has(host)) {
      return unsupported(
        "remote_unsupported",
        "Plain http:// remotes are only accepted for loopback hosts.",
      );
    }
    return exact("http-loopback", `http://${host}${port}${path}`);
  }
  if (scheme === "ssh") {
    if (url.username !== "" && !SSH_USER.test(url.username)) {
      return unsupported("remote_unsupported", "SSH user is not supported.");
    }
    const user = url.username === "" ? "" : `${url.username}@`;
    return exact("ssh", `ssh://${user}${host}${port}${path}`);
  }
  return unsupported(
    "remote_unsupported",
    `The ${scheme}:// scheme is not supported.`,
  );
}

const BRANCH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * One exact branch under `refs/heads/`. Rejects `refs/` prefixes, wildcards,
 * `..`, `@{`, `.lock`, leading dots/dashes, empty segments, and anything Git's
 * check-ref-format would refuse; never a tag, HEAD, or remote-tracking ref.
 */
export function validatePublicationBranch(
  input: unknown,
): Result<
  { readonly branch: string; readonly ref: `refs/heads/${string}` },
  PublicationInputError
> {
  if (typeof input !== "string") {
    return unsupported("branch_unsupported", "Branch must be text.");
  }
  if (input.length === 0 || input.length > PUBLICATION_MAX_BRANCH_LENGTH) {
    return unsupported("branch_unsupported", "Branch is empty or too long.");
  }
  if (CONTROL_OR_SPACE.test(input)) {
    return unsupported(
      "branch_unsupported",
      "Branch must not contain whitespace or control characters.",
    );
  }
  if (
    input.startsWith("refs/") ||
    input === "HEAD" ||
    input.includes("..") ||
    input.includes("@{") ||
    input.includes("*") ||
    input.includes("\\") ||
    input.includes("~") ||
    input.includes("^") ||
    input.includes(":") ||
    input.includes("?") ||
    input.includes("[") ||
    input.endsWith(".") ||
    input.endsWith("/") ||
    input.endsWith(".lock")
  ) {
    return unsupported(
      "branch_unsupported",
      "Branch name is not a plain refs/heads name.",
    );
  }
  const segments = input.split("/");
  if (
    segments.some(
      (segment) => !BRANCH_SEGMENT.test(segment) || segment.endsWith(".lock"),
    )
  ) {
    return unsupported(
      "branch_unsupported",
      "Branch segments are not supported.",
    );
  }
  return { ok: true, value: { branch: input, ref: `refs/heads/${input}` } };
}

/** Publication may only touch files inside the well-known export root. */
export function isPublicationManagedPath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0"))
    return false;
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return false;
  }
  return path.startsWith(`${PUBLICATION_MANAGED_ROOT}/`);
}

const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const publicationRemoteSchema = z
  .object({
    host: z.string().min(1).max(253),
    kind: z.enum(["https", "http-loopback", "ssh"]),
    url: z.string().min(1).max(PUBLICATION_MAX_REMOTE_LENGTH),
  })
  .strict();

export const publicationBaseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unborn") }).strict(),
  z.object({ commit: shaSchema, kind: z.literal("commit") }).strict(),
]);

const managedFileSchema = z
  .object({
    digest: digestSchema,
    path: z
      .string()
      .min(1)
      .max(1_024)
      .refine(isPublicationManagedPath, "Path is outside the managed root."),
  })
  .strict();

const publicationPlanBodySchema = z
  .object({
    base: publicationBaseSchema,
    branch: z.string().min(1).max(PUBLICATION_MAX_BRANCH_LENGTH),
    candidateCommit: shaSchema,
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    exporterVersion: z.literal(WELL_KNOWN_EXPORT_PROFILE.exporterVersion),
    files: z.array(managedFileSchema).min(1).max(2_048),
    id: z.string().min(1).max(256),
    ref: z.string().regex(/^refs\/heads\/.+$/),
    remote: publicationRemoteSchema,
    schemaVersion: z.literal(PUBLICATION_PLAN_SCHEMA_VERSION),
    skills: z.array(z.string().min(1).max(64)).min(1).max(128),
    /** Deterministic export tree digest (ADR 0019), not the Git tree id. */
    treeDigest: digestSchema,
  })
  .strict();

export const publicationPlanV1Schema = publicationPlanBodySchema
  .extend({ planDigest: digestSchema })
  .strict();

export type PublicationPlanBody = z.infer<typeof publicationPlanBodySchema>;
export type PublicationPlanV1 = z.infer<typeof publicationPlanV1Schema>;
export type PublicationBase = z.infer<typeof publicationBaseSchema>;

/** SHA-256 over the RFC 8785 canonical body, so the digest never includes itself. */
export function computePublicationPlanDigest(
  body: PublicationPlanBody,
  sha256Hex: (bytes: Uint8Array) => string,
): `sha256:${string}` {
  const canonical = new TextEncoder().encode(canonicalizeJson(body));
  return `sha256:${sha256Hex(canonical)}`;
}

export function sealPublicationPlan(
  body: PublicationPlanBody,
  sha256Hex: (bytes: Uint8Array) => string,
): PublicationPlanV1 {
  const parsed = publicationPlanBodySchema.parse(body);
  return {
    ...parsed,
    planDigest: computePublicationPlanDigest(parsed, sha256Hex),
  };
}

/** True only when every fact and the digest still agree. */
export function verifyPublicationPlan(
  plan: unknown,
  sha256Hex: (bytes: Uint8Array) => string,
): plan is PublicationPlanV1 {
  const parsed = publicationPlanV1Schema.safeParse(plan);
  if (!parsed.success) return false;
  const { planDigest, ...body } = parsed.data;
  return computePublicationPlanDigest(body, sha256Hex) === planDigest;
}

/**
 * Exact readback classification (ADR 0020). `observed` is the remote ref
 * after the push attempt, `null` when the ref does not exist.
 */
export type PublicationOutcomeStatus =
  "diverged" | "not-published" | "published" | "uncertain";

export function classifyPublicationReadback(input: {
  readonly base: PublicationBase;
  readonly candidateCommit: string;
  readonly observed: string | null | undefined;
}): PublicationOutcomeStatus {
  if (input.observed === undefined) return "uncertain";
  if (input.observed === input.candidateCommit) return "published";
  if (input.base.kind === "unborn") {
    return input.observed === null ? "not-published" : "diverged";
  }
  return input.observed === input.base.commit ? "not-published" : "diverged";
}
