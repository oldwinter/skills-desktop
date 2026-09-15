import {
  classifyPublicationReadback,
  isPublicationManagedPath,
  PUBLICATION_MANAGED_ROOT,
  type PublicError,
  type PublicationBase,
  type PublicationOutcomeStatus,
  type PublicationRemote,
  type Result,
} from "@skills-desktop/skills-runtime";

/**
 * Main-only Git publication (ADR 0020).
 *
 * The publisher accepts a sanitized remote, one exact `refs/heads/*` ref, the
 * managed well-known files as bytes, and nothing else: no working directory,
 * argv, config, hook, force flag, tag, delete, wildcard, or refspec. Every
 * Git invocation is an argument array against an application-owned 0700
 * temporary repository, with hooks, signing, attributes, filters, redirects,
 * prompts, and every transport except the sanitized one disabled per call.
 * System Git and OpenSSH keep credential authority; nothing here reads,
 * stores, or logs credentials.
 */

export interface GitInvocation {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin?: Uint8Array;
  readonly timeoutMs: number;
}

export interface GitOutcome {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

/** Narrow process port; `run` rejects only when Git itself cannot start. */
export interface GitToolRunner {
  run(invocation: GitInvocation): Promise<GitOutcome>;
}

export interface PublicationWorkspace {
  /** Creates a fresh 0700 application-owned root and returns its path. */
  create(): Promise<string>;
  /** Removes a root this workspace created; never anything else. */
  remove(root: string): Promise<void>;
  /** Writes an empty regular file under an owned root (attributes, excludes). */
  writeEmptyFile(path: string): Promise<void>;
  /** Creates an empty directory under an owned root (hooks path). */
  makeDirectory(path: string): Promise<void>;
  join(...segments: readonly string[]): string;
}

export interface PublicationFile {
  readonly bytes: Uint8Array;
  /** Forward-slash path inside the managed root. */
  readonly path: string;
}

export interface PublicationFileDigest {
  readonly digest: `sha256:${string}`;
  readonly path: string;
}

export interface PreparePublicationInput {
  readonly files: readonly PublicationFile[];
  readonly ref: `refs/heads/${string}`;
  readonly remote: PublicationRemote;
  readonly signal?: AbortSignal;
  /** Deterministic export tree digest, recorded in the commit message. */
  readonly treeDigest: `sha256:${string}`;
}

export interface PreparedPublication {
  readonly base: PublicationBase;
  readonly candidateCommit: string;
  readonly files: readonly PublicationFileDigest[];
  /** Application-owned temporary root; removed by `discard`. */
  readonly root: string;
}

export interface PushPublicationInput {
  readonly files: readonly PublicationFile[];
  readonly prepared: PreparedPublication;
  readonly ref: `refs/heads/${string}`;
  readonly remote: PublicationRemote;
  readonly signal?: AbortSignal;
}

export interface PublicationReadback {
  /** Remote ref after the attempt; `null` absent, `undefined` unreadable. */
  readonly observed: string | null | undefined;
  readonly status: PublicationOutcomeStatus;
}

export interface PushPublicationOutcome extends PublicationReadback {
  readonly pushExitCode: number;
}

export type GitPublisherErrorCode =
  | "git_unavailable"
  | "publication_drift"
  | "publication_invalid"
  | "remote_unreachable";

export type GitPublisherError = PublicError<GitPublisherErrorCode>;

export interface GitPublisher {
  discard(prepared: PreparedPublication): Promise<void>;
  prepare(
    input: PreparePublicationInput,
  ): Promise<Result<PreparedPublication, GitPublisherError>>;
  push(
    input: PushPublicationInput,
  ): Promise<Result<PushPublicationOutcome, GitPublisherError>>;
  readback(input: {
    readonly base: PublicationBase;
    readonly candidateCommit: string;
    readonly ref: `refs/heads/${string}`;
    readonly remote: PublicationRemote;
    readonly signal?: AbortSignal;
  }): Promise<PublicationReadback>;
}

export interface SystemGitPublisherOptions {
  readonly clock: () => Date;
  /** Inherited process environment; only an allowlist reaches Git. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly gitExecutable?: string;
  readonly runner: GitToolRunner;
  readonly sha256Hex: (bytes: Uint8Array) => string;
  readonly workspace: PublicationWorkspace;
}

const LOCAL_TIMEOUT_MS = 30_000;
const REMOTE_TIMEOUT_MS = 120_000;
const MAX_STDERR_EXCERPT = 512;
const SHA = /^[a-f0-9]{40}$/;

/**
 * Variables Git, credential helpers, and OpenSSH legitimately need. Every
 * `GIT_*` variable from the parent is dropped so no inherited GIT_DIR,
 * GIT_WORK_TREE, GIT_CONFIG_*, or GIT_SSH_COMMAND can redirect the run.
 */
const ENVIRONMENT_ALLOWLIST = [
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "HOME",
  "LANG",
  "PATH",
  "SSH_AGENT_PID",
  "SSH_AUTH_SOCK",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "XDG_CONFIG_HOME",
  "XDG_RUNTIME_DIR",
] as const;

function failure(
  code: GitPublisherErrorCode,
  message: string,
  phase: string,
  retryable = false,
): Result<never, GitPublisherError> {
  return {
    error: { code, effects: "none", message, phase, retryable },
    ok: false,
  };
}

/** Bounded, credential-free stderr excerpt for user-facing messages. */
export function redactGitStderr(stderr: string): string {
  return stderr
    .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@]+@/g, (match) =>
      match.replace(/\/\/[^\s/@]+@/, "//<redacted>@"),
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_STDERR_EXCERPT);
}

function compareBytewise(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createSystemGitPublisher(
  options: SystemGitPublisherOptions,
): GitPublisher {
  const git = options.gitExecutable ?? "git";
  const { runner, sha256Hex, workspace } = options;

  const environmentFor = (root: string): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const key of ENVIRONMENT_ALLOWLIST) {
      const value = options.environment?.[key];
      if (value !== undefined) env[key] = value;
    }
    const identity = "Skills Desktop";
    const email = "skills-desktop@localhost";
    const date = options.clock().toISOString();
    return {
      ...env,
      GIT_AUTHOR_DATE: date,
      GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_NAME: identity,
      GIT_CEILING_DIRECTORIES: root,
      GIT_COMMITTER_DATE: date,
      GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_NAME: identity,
      GIT_INDEX_FILE: workspace.join(root, "index"),
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    };
  };

  /** Per-invocation config overrides; never written to any config file. */
  const hardening = (root: string, remote?: PublicationRemote) => [
    "-c",
    `core.hooksPath=${workspace.join(root, "no-hooks")}`,
    "-c",
    `core.attributesFile=${workspace.join(root, "no-attributes")}`,
    "-c",
    `core.excludesFile=${workspace.join(root, "no-attributes")}`,
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.eol=lf",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "tag.gpgsign=false",
    "-c",
    "push.gpgsign=false",
    "-c",
    "push.default=nothing",
    "-c",
    "push.followTags=false",
    "-c",
    "http.followRedirects=false",
    "-c",
    "protocol.allow=never",
    ...(remote === undefined
      ? []
      : remote.kind === "https"
        ? ["-c", "protocol.https.allow=always"]
        : remote.kind === "http-loopback"
          ? ["-c", "protocol.http.allow=always"]
          : ["-c", "protocol.ssh.allow=always"]),
  ];

  const run = async (
    root: string,
    args: readonly string[],
    extra: {
      readonly remote?: PublicationRemote;
      readonly signal?: AbortSignal;
      readonly stdin?: Uint8Array;
      readonly timeoutMs?: number;
    } = {},
  ): Promise<GitOutcome> => {
    const invocation: GitInvocation = {
      args: [...hardening(root, extra.remote), ...args],
      cwd: workspace.join(root, "repo"),
      env: environmentFor(root),
      timeoutMs:
        extra.timeoutMs ??
        (extra.remote === undefined ? LOCAL_TIMEOUT_MS : REMOTE_TIMEOUT_MS),
      ...(extra.stdin === undefined ? {} : { stdin: extra.stdin }),
    };
    if (extra.signal?.aborted) {
      throw new GitUnavailableError("Publication was cancelled.");
    }
    return runner.run(invocation);
  };

  /** Exact ref readback; `undefined` when the remote could not be read. */
  const lsRemote = async (
    root: string,
    remote: PublicationRemote,
    ref: string,
    signal?: AbortSignal,
  ): Promise<string | null | undefined> => {
    const outcome = await run(
      root,
      ["ls-remote", "--exit-code", "--", remote.url, ref],
      { remote, ...(signal === undefined ? {} : { signal }) },
    );
    if (outcome.exitCode === 2) return null;
    if (outcome.exitCode !== 0) return undefined;
    const line = outcome.stdout
      .split("\n")
      .map((text) => text.trim())
      .find((text) => text.endsWith(`\t${ref}`));
    const sha = line?.split("\t")[0];
    return sha !== undefined && SHA.test(sha) ? sha : undefined;
  };

  const digestsFor = (
    files: readonly PublicationFile[],
  ): PublicationFileDigest[] =>
    [...files]
      .sort((left, right) => compareBytewise(left.path, right.path))
      .map((file) => ({
        digest: `sha256:${sha256Hex(file.bytes)}` as const,
        path: file.path,
      }));

  const sameDigests = (
    left: readonly PublicationFileDigest[],
    right: readonly PublicationFileDigest[],
  ) =>
    left.length === right.length &&
    left.every(
      (file, index) =>
        file.path === right[index]?.path && file.digest === right[index].digest,
    );

  const validateFiles = (files: readonly PublicationFile[]) => {
    if (files.length === 0) {
      return failure(
        "publication_invalid",
        "There is nothing to publish.",
        "validate",
      );
    }
    const seen = new Set<string>();
    for (const file of files) {
      if (!isPublicationManagedPath(file.path) || seen.has(file.path)) {
        return failure(
          "publication_invalid",
          `Only unique paths under ${PUBLICATION_MANAGED_ROOT}/ may be published.`,
          "validate",
        );
      }
      seen.add(file.path);
    }
    return undefined;
  };

  return {
    async discard(prepared) {
      await workspace.remove(prepared.root);
    },

    async prepare(input) {
      const invalid = validateFiles(input.files);
      if (invalid !== undefined) return invalid;
      const root = await workspace.create();
      const cleanup = async () => {
        await workspace.remove(root);
      };
      try {
        await workspace.makeDirectory(workspace.join(root, "no-hooks"));
        await workspace.writeEmptyFile(workspace.join(root, "no-attributes"));
        await workspace.makeDirectory(workspace.join(root, "repo"));
        const init = await run(root, ["init", "--quiet"]);
        if (init.exitCode !== 0) {
          await cleanup();
          return failure(
            "git_unavailable",
            `Git could not initialise the publication workspace: ${redactGitStderr(init.stderr)}`,
            "prepare",
          );
        }

        const observed = await lsRemote(
          root,
          input.remote,
          input.ref,
          input.signal,
        );
        if (observed === undefined) {
          await cleanup();
          return failure(
            "remote_unreachable",
            "The remote branch could not be read.",
            "fetch",
            true,
          );
        }
        let base: PublicationBase;
        if (observed === null) {
          base = { kind: "unborn" };
          const empty = await run(root, ["read-tree", "--empty"]);
          if (empty.exitCode !== 0) {
            await cleanup();
            return failure(
              "git_unavailable",
              "Git could not start an empty index.",
              "prepare",
            );
          }
        } else {
          const fetch = await run(
            root,
            [
              "fetch",
              "--quiet",
              "--no-tags",
              "--no-recurse-submodules",
              "--depth",
              "1",
              "--",
              input.remote.url,
              input.ref,
            ],
            {
              remote: input.remote,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            },
          );
          if (fetch.exitCode !== 0) {
            await cleanup();
            return failure(
              "remote_unreachable",
              `The reviewed base could not be fetched: ${redactGitStderr(fetch.stderr)}`,
              "fetch",
              true,
            );
          }
          const fetched = (
            await run(root, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"])
          ).stdout.trim();
          if (fetched !== observed) {
            await cleanup();
            return failure(
              "publication_drift",
              "The remote branch changed while it was being read.",
              "fetch",
              true,
            );
          }
          base = { commit: observed, kind: "commit" };
          const readTree = await run(root, ["read-tree", observed]);
          if (readTree.exitCode !== 0) {
            await cleanup();
            return failure(
              "git_unavailable",
              "Git could not read the base tree.",
              "prepare",
            );
          }
          const managed = await run(root, [
            "ls-files",
            "-z",
            "--",
            PUBLICATION_MANAGED_ROOT,
          ]);
          if (managed.stdout.length > 0) {
            const removed = await run(
              root,
              ["update-index", "--force-remove", "-z", "--stdin"],
              { stdin: new TextEncoder().encode(managed.stdout) },
            );
            if (removed.exitCode !== 0) {
              await cleanup();
              return failure(
                "git_unavailable",
                "Git could not clear the managed tree.",
                "prepare",
              );
            }
          }
        }

        const digests = digestsFor(input.files);
        for (const file of [...input.files].sort((left, right) =>
          compareBytewise(left.path, right.path),
        )) {
          const blob = await run(
            root,
            ["hash-object", "-w", "--no-filters", "--stdin"],
            { stdin: file.bytes },
          );
          const sha = blob.stdout.trim();
          if (blob.exitCode !== 0 || !SHA.test(sha)) {
            await cleanup();
            return failure(
              "git_unavailable",
              "Git could not store a managed file.",
              "prepare",
            );
          }
          const added = await run(root, [
            "update-index",
            "--add",
            "--cacheinfo",
            `100644,${sha},${file.path}`,
          ]);
          if (added.exitCode !== 0) {
            await cleanup();
            return failure(
              "git_unavailable",
              "Git could not index a managed file.",
              "prepare",
            );
          }
        }
        const tree = (await run(root, ["write-tree"])).stdout.trim();
        if (!SHA.test(tree)) {
          await cleanup();
          return failure(
            "git_unavailable",
            "Git could not write the candidate tree.",
            "prepare",
          );
        }
        const commit = await run(root, [
          "commit-tree",
          tree,
          ...(base.kind === "commit" ? ["-p", base.commit] : []),
          "-m",
          `Publish agent-skills export ${input.treeDigest}`,
        ]);
        const candidateCommit = commit.stdout.trim();
        if (commit.exitCode !== 0 || !SHA.test(candidateCommit)) {
          await cleanup();
          return failure(
            "git_unavailable",
            "Git could not create the candidate commit.",
            "prepare",
          );
        }
        return {
          ok: true,
          value: { base, candidateCommit, files: digests, root },
        };
      } catch (error) {
        await cleanup();
        return failure(
          "git_unavailable",
          error instanceof Error && error.message.length > 0
            ? `System Git is unavailable: ${redactGitStderr(error.message)}`
            : "System Git is unavailable.",
          "prepare",
        );
      }
    },

    async push(input) {
      const { prepared, ref, remote } = input;
      // Approval revalidates every byte against the plan before any transport.
      const invalid = validateFiles(input.files);
      if (invalid !== undefined) return invalid;
      if (!sameDigests(digestsFor(input.files), prepared.files)) {
        return failure(
          "publication_invalid",
          "The export bytes no longer match the reviewed plan.",
          "revalidate",
        );
      }
      try {
        const before = await lsRemote(prepared.root, remote, ref, input.signal);
        if (before === undefined) {
          return failure(
            "remote_unreachable",
            "The remote branch could not be read before publishing.",
            "fetch",
            true,
          );
        }
        const expected =
          prepared.base.kind === "commit" ? prepared.base.commit : null;
        if (before !== expected) {
          return failure(
            "publication_drift",
            "The remote branch moved since the plan was reviewed; nothing was pushed.",
            "fetch",
            true,
          );
        }
        // Exact fast-forward refspec: no force, no lease, no tags, no hooks.
        const push = await run(
          prepared.root,
          [
            "push",
            "--quiet",
            "--porcelain",
            "--no-verify",
            "--no-follow-tags",
            "--",
            remote.url,
            `${prepared.candidateCommit}:${ref}`,
          ],
          {
            remote,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        const observed = await lsRemote(prepared.root, remote, ref);
        return {
          ok: true,
          value: {
            observed,
            pushExitCode: push.exitCode,
            status: classifyPublicationReadback({
              base: prepared.base,
              candidateCommit: prepared.candidateCommit,
              observed,
            }),
          },
        };
      } catch (error) {
        return failure(
          "git_unavailable",
          error instanceof Error && error.message.length > 0
            ? `System Git is unavailable: ${redactGitStderr(error.message)}`
            : "System Git is unavailable.",
          "push",
        );
      }
    },

    async readback(input) {
      const root = await workspace.create();
      try {
        await workspace.makeDirectory(workspace.join(root, "no-hooks"));
        await workspace.writeEmptyFile(workspace.join(root, "no-attributes"));
        await workspace.makeDirectory(workspace.join(root, "repo"));
        const observed = await lsRemote(
          root,
          input.remote,
          input.ref,
          input.signal,
        );
        return {
          observed,
          status: classifyPublicationReadback({
            base: input.base,
            candidateCommit: input.candidateCommit,
            observed,
          }),
        };
      } catch {
        return { observed: undefined, status: "uncertain" };
      } finally {
        await workspace.remove(root);
      }
    },
  };
}

export class GitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitUnavailableError";
  }
}
