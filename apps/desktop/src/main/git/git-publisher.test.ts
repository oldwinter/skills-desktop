import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PublicationRemote } from "@skills-desktop/skills-runtime";

import {
  createSystemGitPublisher,
  redactGitStderr,
  type GitInvocation,
  type GitOutcome,
  type PublicationWorkspace,
} from "./git-publisher.js";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const BASE = "a".repeat(40);
const CANDIDATE = "c".repeat(40);
const TREE = "7".repeat(40);
const BLOB = "b".repeat(40);
const remote: PublicationRemote = {
  host: "github.com",
  kind: "https",
  url: "https://github.com/acme/skills.git",
};
const ref = "refs/heads/main" as const;
const files = [
  {
    bytes: new TextEncoder().encode('{"skills":[]}\n'),
    path: ".well-known/agent-skills/index.json",
  },
  {
    bytes: new TextEncoder().encode("---\nname: hello\n---\n"),
    path: ".well-known/agent-skills/hello/SKILL.md",
  },
];

type Script = (
  subcommand: string,
  args: readonly string[],
  invocation: GitInvocation,
) => GitOutcome | undefined;

function fakeWorkspace() {
  const created: string[] = [];
  const removed: string[] = [];
  const written: string[] = [];
  let counter = 0;
  const workspace: PublicationWorkspace = {
    async create() {
      const root = `/owned/root-${++counter}`;
      created.push(root);
      return root;
    },
    join: (...segments) => segments.join("/"),
    async makeDirectory(path) {
      written.push(`dir:${path}`);
    },
    async remove(root) {
      removed.push(root);
    },
    async writeEmptyFile(path) {
      written.push(`file:${path}`);
    },
  };
  return { created, removed, workspace, written };
}

function fakeRunner(script: Script) {
  const invocations: GitInvocation[] = [];
  const ok = (stdout = ""): GitOutcome => ({ exitCode: 0, stderr: "", stdout });
  return {
    invocations,
    runner: {
      async run(invocation: GitInvocation) {
        invocations.push(invocation);
        const positional = invocation.args.filter(
          (arg, index, all) => arg !== "-c" && all[index - 1] !== "-c",
        );
        const [subcommand = "", ...rest] = positional;
        const scripted = script(subcommand, rest, invocation);
        if (scripted !== undefined) return scripted;
        switch (subcommand) {
          case "hash-object":
            return ok(`${BLOB}\n`);
          case "write-tree":
            return ok(`${TREE}\n`);
          case "commit-tree":
            return ok(`${CANDIDATE}\n`);
          case "rev-parse":
            return ok(`${BASE}\n`);
          default:
            return ok();
        }
      },
    },
  };
}

function subcommandsOf(invocations: readonly GitInvocation[]) {
  return invocations.map(
    (invocation) =>
      invocation.args.filter(
        (arg, index, all) => arg !== "-c" && all[index - 1] !== "-c",
      )[0],
  );
}

function publisherWith(script: Script, environment?: Record<string, string>) {
  const { runner, invocations } = fakeRunner(script);
  const ws = fakeWorkspace();
  const publisher = createSystemGitPublisher({
    clock: () => new Date("2026-09-15T10:00:00.000Z"),
    environment: environment ?? {
      GIT_DIR: "/home/user/.git",
      GIT_SSH_COMMAND: "evil",
      GIT_WORK_TREE: "/home/user",
      HOME: "/home/user",
      PATH: "/usr/bin",
      SECRET_TOKEN: "hidden",
      SSH_AUTH_SOCK: "/run/agent.sock",
    },
    runner,
    sha256Hex,
    workspace: ws.workspace,
  });
  return { invocations, publisher, ws };
}

describe("createSystemGitPublisher (ADR 0020)", () => {
  it("prepares a candidate on top of the exact fetched base using plumbing only", async () => {
    const { invocations, publisher, ws } = publisherWith((sub, args) => {
      if (sub === "ls-remote")
        return { exitCode: 0, stderr: "", stdout: `${BASE}\t${ref}\n` };
      if (sub === "ls-files")
        return {
          exitCode: 0,
          stderr: "",
          stdout:
            ".well-known/agent-skills/old/SKILL.md\0.well-known/agent-skills/index.json\0",
        };
      if (sub === "fetch") {
        expect(args).toEqual([
          "--quiet",
          "--no-tags",
          "--no-recurse-submodules",
          "--depth",
          "1",
          "--",
          remote.url,
          ref,
        ]);
      }
      return undefined;
    });

    const prepared = await publisher.prepare({
      files,
      ref,
      remote,
      treeDigest: `sha256:${"d".repeat(64)}`,
    });

    expect(prepared).toEqual({
      ok: true,
      value: {
        base: { commit: BASE, kind: "commit" },
        candidateCommit: CANDIDATE,
        files: [
          {
            digest: `sha256:${sha256Hex(files[1]!.bytes)}`,
            path: ".well-known/agent-skills/hello/SKILL.md",
          },
          {
            digest: `sha256:${sha256Hex(files[0]!.bytes)}`,
            path: ".well-known/agent-skills/index.json",
          },
        ],
        root: "/owned/root-1",
      },
    });
    expect(subcommandsOf(invocations)).toEqual([
      "init",
      "ls-remote",
      "fetch",
      "rev-parse",
      "read-tree",
      "ls-files",
      "update-index",
      "hash-object",
      "update-index",
      "hash-object",
      "update-index",
      "write-tree",
      "commit-tree",
    ]);
    // The managed tree is replaced wholesale; nothing outside it is touched.
    const removal = invocations.find((invocation) =>
      invocation.args.includes("--force-remove"),
    );
    expect(new TextDecoder().decode(removal?.stdin)).toBe(
      ".well-known/agent-skills/old/SKILL.md\0.well-known/agent-skills/index.json\0",
    );
    expect(
      invocations
        .filter((invocation) => invocation.args.includes("--cacheinfo"))
        .map((invocation) => invocation.args.at(-1)),
    ).toEqual([
      `100644,${BLOB},.well-known/agent-skills/hello/SKILL.md`,
      `100644,${BLOB},.well-known/agent-skills/index.json`,
    ]);
    const commit = invocations.find((invocation) =>
      invocation.args.includes("commit-tree"),
    );
    expect(commit?.args.slice(-5)).toEqual([
      TREE,
      "-p",
      BASE,
      "-m",
      `Publish agent-skills export sha256:${"d".repeat(64)}`,
    ]);
    expect(ws.created).toEqual(["/owned/root-1"]);
    expect(ws.removed).toEqual([]);
    expect(ws.written).toEqual([
      "dir:/owned/root-1/no-hooks",
      "file:/owned/root-1/no-attributes",
      "dir:/owned/root-1/repo",
    ]);
  });

  it("hardens every invocation: allowlisted env, no GIT_* leakage, hooks/signing/filters/redirects off, one transport", async () => {
    const { invocations, publisher } = publisherWith((sub) =>
      sub === "ls-remote" ? { exitCode: 2, stderr: "", stdout: "" } : undefined,
    );
    await publisher.prepare({
      files,
      ref,
      remote,
      treeDigest: `sha256:${"d".repeat(64)}`,
    });
    for (const invocation of invocations) {
      expect(invocation.cwd).toBe("/owned/root-1/repo");
      expect(
        Object.keys(invocation.env)
          .filter((key) => key.startsWith("GIT_"))
          .sort(),
      ).toEqual([
        "GIT_AUTHOR_DATE",
        "GIT_AUTHOR_EMAIL",
        "GIT_AUTHOR_NAME",
        "GIT_CEILING_DIRECTORIES",
        "GIT_COMMITTER_DATE",
        "GIT_COMMITTER_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_INDEX_FILE",
        "GIT_TERMINAL_PROMPT",
      ]);
      expect(invocation.env).toMatchObject({
        GIT_AUTHOR_DATE: "2026-09-15T10:00:00.000Z",
        GIT_CEILING_DIRECTORIES: "/owned/root-1",
        GIT_INDEX_FILE: "/owned/root-1/index",
        GIT_TERMINAL_PROMPT: "0",
        HOME: "/home/user",
        LC_ALL: "C",
        PATH: "/usr/bin",
        SSH_AUTH_SOCK: "/run/agent.sock",
      });
      expect(invocation.env).not.toHaveProperty("SECRET_TOKEN");
      expect(invocation.env).not.toHaveProperty("GIT_SSH_COMMAND");
      const config = invocation.args
        .map((arg, index, all) => (all[index - 1] === "-c" ? arg : undefined))
        .filter((value): value is string => value !== undefined);
      expect(config).toEqual(
        expect.arrayContaining([
          "core.hooksPath=/owned/root-1/no-hooks",
          "core.attributesFile=/owned/root-1/no-attributes",
          "commit.gpgsign=false",
          "push.gpgsign=false",
          "http.followRedirects=false",
          "protocol.allow=never",
        ]),
      );
      expect(
        config.some(
          (entry) => entry.startsWith("protocol.") && entry.endsWith("=always"),
        ),
      ).toBe(
        invocation.args.includes("ls-remote") ||
          invocation.args.includes("fetch") ||
          invocation.args.includes("push"),
      );
      expect(config).not.toContain("protocol.file.allow=always");
      expect(config).not.toContain("protocol.ssh.allow=always");
    }
    // Unborn remote: an empty index, no fetch, root commit.
    expect(subcommandsOf(invocations)).toEqual([
      "init",
      "ls-remote",
      "read-tree",
      "hash-object",
      "update-index",
      "hash-object",
      "update-index",
      "write-tree",
      "commit-tree",
    ]);
    expect(
      invocations.find((i) => i.args.includes("commit-tree"))?.args,
    ).not.toContain("-p");
  });

  it("refuses files outside the managed root and unreachable or drifting remotes without leaving a root behind", async () => {
    const { publisher, ws } = publisherWith((sub) =>
      sub === "ls-remote"
        ? { exitCode: 128, stderr: "fatal: unable to access", stdout: "" }
        : undefined,
    );
    expect(
      await publisher.prepare({
        files: [{ bytes: new Uint8Array([1]), path: "README.md" }],
        ref,
        remote,
        treeDigest: `sha256:${"d".repeat(64)}`,
      }),
    ).toMatchObject({ error: { code: "publication_invalid" }, ok: false });
    expect(
      await publisher.prepare({
        files,
        ref,
        remote,
        treeDigest: `sha256:${"d".repeat(64)}`,
      }),
    ).toMatchObject({
      error: { code: "remote_unreachable", retryable: true },
      ok: false,
    });
    expect(ws.removed).toEqual(["/owned/root-1"]);

    const drifting = publisherWith((sub) => {
      if (sub === "ls-remote")
        return { exitCode: 0, stderr: "", stdout: `${BASE}\t${ref}\n` };
      if (sub === "rev-parse")
        return { exitCode: 0, stderr: "", stdout: `${"e".repeat(40)}\n` };
      return undefined;
    });
    expect(
      await drifting.publisher.prepare({
        files,
        ref,
        remote,
        treeDigest: `sha256:${"d".repeat(64)}`,
      }),
    ).toMatchObject({ error: { code: "publication_drift" }, ok: false });
    expect(drifting.ws.removed).toEqual(["/owned/root-1"]);
  });

  it("pushes one exact fast-forward refspec only after revalidating bytes and the reviewed base", async () => {
    let lsRemoteCalls = 0;
    const { invocations, publisher } = publisherWith((sub) => {
      if (sub === "ls-remote") {
        lsRemoteCalls += 1;
        return {
          exitCode: 0,
          stderr: "",
          stdout: `${lsRemoteCalls === 1 ? BASE : CANDIDATE}\t${ref}\n`,
        };
      }
      return undefined;
    });
    const prepared = {
      base: { commit: BASE, kind: "commit" } as const,
      candidateCommit: CANDIDATE,
      files: [
        {
          digest: `sha256:${sha256Hex(files[1]!.bytes)}` as const,
          path: files[1]!.path,
        },
        {
          digest: `sha256:${sha256Hex(files[0]!.bytes)}` as const,
          path: files[0]!.path,
        },
      ],
      root: "/owned/root-9",
    };

    expect(
      await publisher.push({
        files: [files[0]!, { ...files[1]!, bytes: new Uint8Array([9]) }],
        prepared,
        ref,
        remote,
      }),
    ).toMatchObject({ error: { code: "publication_invalid" }, ok: false });
    expect(invocations).toEqual([]);

    const pushed = await publisher.push({ files, prepared, ref, remote });
    expect(pushed).toEqual({
      ok: true,
      value: { observed: CANDIDATE, pushExitCode: 0, status: "published" },
    });
    expect(subcommandsOf(invocations)).toEqual([
      "ls-remote",
      "push",
      "ls-remote",
    ]);
    const push = invocations[1]!;
    const positional = push.args.filter(
      (arg, index, all) => arg !== "-c" && all[index - 1] !== "-c",
    );
    expect(positional).toEqual([
      "push",
      "--quiet",
      "--porcelain",
      "--no-verify",
      "--no-follow-tags",
      "--",
      remote.url,
      `${CANDIDATE}:${ref}`,
    ]);
    expect(push.args.join(" ")).not.toMatch(
      /--force|\+refs|--delete|--tags|--mirror|--all/,
    );
    expect(push.cwd).toBe("/owned/root-9/repo");
  });

  it("never pushes onto a remote that moved since review and classifies readback exactly", async () => {
    const moved = "f".repeat(40);
    const drifted = publisherWith((sub) =>
      sub === "ls-remote"
        ? { exitCode: 0, stderr: "", stdout: `${moved}\t${ref}\n` }
        : undefined,
    );
    const prepared = {
      base: { commit: BASE, kind: "commit" } as const,
      candidateCommit: CANDIDATE,
      files: [
        {
          digest: `sha256:${sha256Hex(files[1]!.bytes)}` as const,
          path: files[1]!.path,
        },
        {
          digest: `sha256:${sha256Hex(files[0]!.bytes)}` as const,
          path: files[0]!.path,
        },
      ],
      root: "/owned/root-9",
    };
    expect(
      await drifted.publisher.push({ files, prepared, ref, remote }),
    ).toMatchObject({
      error: { code: "publication_drift", effects: "none" },
      ok: false,
    });
    expect(subcommandsOf(drifted.invocations)).toEqual(["ls-remote"]);

    // Rejected non-fast-forward after the check: the readback says diverged.
    let calls = 0;
    const raced = publisherWith((sub) => {
      if (sub === "ls-remote") {
        calls += 1;
        return {
          exitCode: 0,
          stderr: "",
          stdout: `${calls === 1 ? BASE : moved}\t${ref}\n`,
        };
      }
      if (sub === "push")
        return {
          exitCode: 1,
          stderr: "! [rejected] non-fast-forward",
          stdout: "",
        };
      return undefined;
    });
    expect(
      await raced.publisher.push({ files, prepared, ref, remote }),
    ).toEqual({
      ok: true,
      value: { observed: moved, pushExitCode: 1, status: "diverged" },
    });

    // Unreadable after the push: uncertain, never retried here.
    let attempts = 0;
    const dark = publisherWith((sub) => {
      if (sub === "ls-remote") {
        attempts += 1;
        return attempts === 1
          ? { exitCode: 0, stderr: "", stdout: `${BASE}\t${ref}\n` }
          : { exitCode: 128, stderr: "fatal: unable to access", stdout: "" };
      }
      return undefined;
    });
    expect(await dark.publisher.push({ files, prepared, ref, remote })).toEqual(
      {
        ok: true,
        value: { observed: undefined, pushExitCode: 0, status: "uncertain" },
      },
    );
    expect(subcommandsOf(dark.invocations)).toEqual([
      "ls-remote",
      "push",
      "ls-remote",
    ]);

    // Reconciliation is readback only and cleans up its scratch root.
    const readback = publisherWith((sub) =>
      sub === "ls-remote"
        ? { exitCode: 0, stderr: "", stdout: `${CANDIDATE}\t${ref}\n` }
        : undefined,
    );
    expect(
      await readback.publisher.readback({
        base: prepared.base,
        candidateCommit: CANDIDATE,
        ref,
        remote,
      }),
    ).toEqual({ observed: CANDIDATE, status: "published" });
    expect(subcommandsOf(readback.invocations)).toEqual(["ls-remote"]);
    expect(readback.ws.removed).toEqual(["/owned/root-1"]);
  });

  it("reports a missing Git binary as unavailable and redacts credentials from excerpts", async () => {
    const missing = publisherWith(() => {
      throw new Error("System Git was not found on PATH.");
    });
    expect(
      await missing.publisher.prepare({
        files,
        ref,
        remote,
        treeDigest: `sha256:${"d".repeat(64)}`,
      }),
    ).toMatchObject({ error: { code: "git_unavailable" }, ok: false });
    expect(missing.ws.removed).toEqual(["/owned/root-1"]);
    expect(
      redactGitStderr("fatal: https://user:tok3n@example.com/x.git\n  denied"),
    ).toBe("fatal: https://<redacted>@example.com/x.git denied");
    expect(redactGitStderr("x".repeat(2_000))).toHaveLength(512);
  });
});
