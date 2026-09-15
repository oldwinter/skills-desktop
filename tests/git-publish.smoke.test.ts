import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  exportWellKnownTree,
  sanitizePublicationRemote,
  validatePublicationBranch,
  type PublicationRemote,
} from "@skills-desktop/skills-runtime";

import { createSystemGitPublisher } from "../apps/desktop/src/main/git/git-publisher.js";
import {
  createNodePublicationWorkspace,
  createSpawnGitRunner,
  sha256Hex,
} from "../apps/desktop/src/main/git/node-git-tools.js";
import { createNodeWellKnownCodec } from "../apps/desktop/src/main/adapters/node-well-known-codec.js";

/**
 * ADR 0024 mission surface: fixture-owned local bare Git served over loopback
 * smart HTTP (`git http-backend` behind a Node CGI bridge) and published to by
 * the production `GitPublisher` through system Git. The evidence is
 * Linux/localhost only; it says nothing about live hosting providers,
 * authentication, or network behaviour.
 *
 * Everything lives under one worker-owned temporary root: the bare
 * repository, the isolated HOME the publisher runs with, and the publisher's
 * own 0700 roots. The suite stops only the HTTP server it started.
 */

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) =>
              error === undefined ? resolve() : reject(error),
            ),
          ),
      ),
  );
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const encoder = new TextEncoder();

function fixtureEnvironment(home: string) {
  return {
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_AUTHOR_EMAIL: "fixture@localhost",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_EMAIL: "fixture@localhost",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_CONFIG_GLOBAL: join(home, "no-global-gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: home,
    PATH: process.env.PATH ?? "",
  };
}

async function fixtureGit(
  home: string,
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: fixtureEnvironment(home),
  });
  return stdout.trim();
}

interface Fixture {
  readonly bare: string;
  readonly home: string;
  readonly root: string;
  readonly seed: string;
}

/** Bare repository with `main` = README + a stale managed file. */
async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "skills-desktop-git-publish-"));
  temporaryDirectories.push(root);
  const home = join(root, "home");
  const bare = join(root, "fixture.git");
  const seed = join(root, "seed");
  await mkdir(home);
  await mkdir(seed);
  await fixtureGit(home, root, [
    "init",
    "--quiet",
    "--bare",
    "--initial-branch",
    "main",
    bare,
  ]);
  await fixtureGit(home, bare, ["config", "http.receivepack", "true"]);
  await fixtureGit(home, seed, ["init", "--quiet", "--initial-branch", "main"]);
  await writeFile(join(seed, "README.md"), "# Fixture\n", "utf8");
  await mkdir(join(seed, ".well-known", "agent-skills", "stale"), {
    recursive: true,
  });
  await writeFile(
    join(seed, ".well-known", "agent-skills", "stale", "SKILL.md"),
    "stale\n",
    "utf8",
  );
  await fixtureGit(home, seed, ["add", "."]);
  await fixtureGit(home, seed, ["commit", "--quiet", "-m", "seed"]);
  await fixtureGit(home, seed, [
    "push",
    "--quiet",
    bare,
    "main:refs/heads/main",
  ]);
  return { bare, home, root, seed };
}

async function advanceRemote(fixture: Fixture, message: string) {
  await writeFile(join(fixture.seed, `${message}.txt`), `${message}\n`, "utf8");
  await fixtureGit(fixture.home, fixture.seed, ["add", "."]);
  await fixtureGit(fixture.home, fixture.seed, [
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  await fixtureGit(fixture.home, fixture.seed, [
    "push",
    "--quiet",
    fixture.bare,
    "main:refs/heads/main",
  ]);
  return fixtureGit(fixture.home, fixture.bare, [
    "rev-parse",
    "refs/heads/main",
  ]);
}

interface LoopbackGit {
  readonly remote: PublicationRemote;
  readonly requests: string[];
  /** When set, `GET .../info/refs` answers 503 so readback cannot see the ref. */
  failReads: boolean;
  /** Runs before the fixture handles a `git-receive-pack` POST. */
  beforeReceivePack?: () => Promise<void>;
  /** Runs after the fixture handled a `git-receive-pack` POST. */
  afterReceivePack?: () => Promise<void>;
}

/** Smart HTTP over loopback: each request is one `git http-backend` CGI run. */
async function serveLoopbackGit(fixture: Fixture): Promise<LoopbackGit> {
  const state: LoopbackGit = {
    failReads: false,
    remote: { host: "127.0.0.1", kind: "http-loopback", url: "" },
    requests: [],
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const line = `${request.method} ${url.pathname}${url.search}`;
    state.requests.push(line);
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        const body = Buffer.concat(chunks);
        const isReceive = url.pathname.endsWith("/git-receive-pack");
        if (state.failReads && request.method === "GET") {
          response.writeHead(503, { "content-length": "0" });
          response.end();
          return;
        }
        if (isReceive && state.beforeReceivePack !== undefined) {
          await state.beforeReceivePack();
        }
        const cgi = spawn("git", ["http-backend"], {
          env: {
            CONTENT_LENGTH: String(body.byteLength),
            CONTENT_TYPE: request.headers["content-type"] ?? "",
            GIT_HTTP_EXPORT_ALL: "1",
            GIT_PROJECT_ROOT: fixture.root,
            ...(request.headers["content-encoding"] === undefined
              ? {}
              : { HTTP_CONTENT_ENCODING: request.headers["content-encoding"] }),
            PATH: process.env.PATH ?? "",
            PATH_INFO: url.pathname,
            QUERY_STRING: url.search.slice(1),
            REMOTE_ADDR: "127.0.0.1",
            REQUEST_METHOD: request.method ?? "GET",
            SERVER_PROTOCOL: "HTTP/1.1",
          },
          stdio: ["pipe", "pipe", "inherit"],
        });
        const output: Buffer[] = [];
        cgi.stdout.on("data", (chunk: Buffer) => output.push(chunk));
        cgi.once("close", () => {
          void (async () => {
            const raw = Buffer.concat(output);
            const separator = raw.indexOf("\r\n\r\n");
            const headerText = raw.subarray(0, separator).toString("latin1");
            let status = 200;
            const headers: Record<string, string> = {};
            for (const header of headerText.split("\r\n")) {
              const colon = header.indexOf(":");
              if (colon < 0) continue;
              const name = header.slice(0, colon).trim().toLowerCase();
              const value = header.slice(colon + 1).trim();
              if (name === "status") status = Number.parseInt(value, 10);
              else headers[name] = value;
            }
            const responseBody = raw.subarray(separator + 4);
            response.writeHead(status, {
              ...headers,
              "content-length": String(responseBody.byteLength),
            });
            response.end(responseBody);
            if (isReceive && state.afterReceivePack !== undefined) {
              await state.afterReceivePack();
            }
          })();
        });
        cgi.stdin.end(body);
      })();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("The loopback Git server did not report a port.");
  }
  const sanitized = sanitizePublicationRemote(
    `http://127.0.0.1:${address.port}/fixture.git`,
  );
  if (!sanitized.ok) throw new Error(sanitized.error.message);
  return Object.assign(state, { remote: sanitized.value });
}

function exportedFiles() {
  const exported = exportWellKnownTree(
    [
      {
        files: [
          {
            bytes: encoder.encode(
              "---\nname: hello\ndescription: Published from the smoke.\n---\n\n# hello\n",
            ),
            path: "SKILL.md",
          },
        ],
        name: "hello",
      },
    ],
    createNodeWellKnownCodec(),
  );
  if (!exported.ok) throw new Error(exported.error.message);
  return exported.value;
}

async function publisherFor(fixture: Fixture) {
  const home = join(fixture.root, "publisher-home");
  await mkdir(home);
  return createSystemGitPublisher({
    clock: () => new Date("2026-09-15T10:00:00.000Z"),
    environment: {
      HOME: home,
      PATH: process.env.PATH,
      SECRET_SHOULD_NOT_LEAK: "1",
    },
    runner: createSpawnGitRunner(),
    sha256Hex,
    workspace: createNodePublicationWorkspace({ baseDirectory: fixture.root }),
  });
}

const branch = validatePublicationBranch("main");
if (!branch.ok) throw new Error("fixture branch invalid");
const ref = branch.value.ref;

describe("fixture-owned bare Git publication through system Git (ADR 0020 / ADR 0024, #207 #212)", () => {
  it("fast-forwards the exact export onto the reviewed base, replacing only the managed tree", async () => {
    const fixture = await createFixture();
    const site = await serveLoopbackGit(fixture);
    const publisher = await publisherFor(fixture);
    const exported = exportedFiles();
    const base = await fixtureGit(fixture.home, fixture.bare, [
      "rev-parse",
      "refs/heads/main",
    ]);

    const prepared = await publisher.prepare({
      files: exported.files,
      ref,
      remote: site.remote,
      treeDigest: exported.treeDigest,
    });
    expect(prepared).toMatchObject({
      ok: true,
      value: { base: { commit: base, kind: "commit" } },
    });
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(prepared.value.root.startsWith(fixture.root)).toBe(true);
    // Preparing pushes nothing.
    expect(
      await fixtureGit(fixture.home, fixture.bare, [
        "rev-parse",
        "refs/heads/main",
      ]),
    ).toBe(base);
    expect(
      site.requests.some((line) => line.includes("git-receive-pack")),
    ).toBe(false);

    const pushed = await publisher.push({
      files: exported.files,
      prepared: prepared.value,
      ref,
      remote: site.remote,
    });
    expect(pushed).toEqual({
      ok: true,
      value: {
        observed: prepared.value.candidateCommit,
        pushExitCode: 0,
        status: "published",
      },
    });
    expect(
      await fixtureGit(fixture.home, fixture.bare, [
        "rev-parse",
        "refs/heads/main",
      ]),
    ).toBe(prepared.value.candidateCommit);
    expect(
      await fixtureGit(fixture.home, fixture.bare, [
        "rev-parse",
        "refs/heads/main^",
      ]),
    ).toBe(base);
    expect(
      (
        await fixtureGit(fixture.home, fixture.bare, [
          "ls-tree",
          "-r",
          "--name-only",
          "refs/heads/main",
        ])
      )
        .split("\n")
        .sort(),
    ).toEqual([
      ".well-known/agent-skills/hello/SKILL.md",
      ".well-known/agent-skills/index.json",
      "README.md",
    ]);
    for (const file of exported.files) {
      const { stdout } = await execFileAsync(
        "git",
        ["cat-file", "blob", `refs/heads/main:${file.path}`],
        {
          cwd: fixture.bare,
          encoding: "buffer",
          env: fixtureEnvironment(fixture.home),
        },
      );
      expect(new Uint8Array(stdout)).toEqual(file.bytes);
    }
    expect(
      await fixtureGit(fixture.home, fixture.bare, [
        "log",
        "-1",
        "--format=%an <%ae> %s",
        "refs/heads/main",
      ]),
    ).toBe(
      `Skills Desktop <skills-desktop@localhost> Publish agent-skills export ${exported.treeDigest}`,
    );
    expect(
      await fixtureGit(fixture.home, fixture.bare, ["tag", "--list"]),
    ).toBe("");

    await publisher.discard(prepared.value);
    expect(
      (await readdir(fixture.root)).filter((name) =>
        name.startsWith("skills-desktop-publication-"),
      ),
    ).toEqual([]);
  });

  it("creates an unborn branch as a root commit holding only the managed tree", async () => {
    const fixture = await createFixture();
    const site = await serveLoopbackGit(fixture);
    const publisher = await publisherFor(fixture);
    const exported = exportedFiles();
    const unborn = validatePublicationBranch("skills/publish");
    if (!unborn.ok) throw new Error("branch invalid");

    const prepared = await publisher.prepare({
      files: exported.files,
      ref: unborn.value.ref,
      remote: site.remote,
      treeDigest: exported.treeDigest,
    });
    expect(prepared).toMatchObject({
      ok: true,
      value: { base: { kind: "unborn" } },
    });
    if (!prepared.ok) throw new Error(prepared.error.message);
    const pushed = await publisher.push({
      files: exported.files,
      prepared: prepared.value,
      ref: unborn.value.ref,
      remote: site.remote,
    });
    expect(pushed).toMatchObject({ ok: true, value: { status: "published" } });
    expect(
      (
        await fixtureGit(fixture.home, fixture.bare, [
          "ls-tree",
          "-r",
          "--name-only",
          unborn.value.ref,
        ])
      )
        .split("\n")
        .sort(),
    ).toEqual([
      ".well-known/agent-skills/hello/SKILL.md",
      ".well-known/agent-skills/index.json",
    ]);
    expect(
      await fixtureGit(fixture.home, fixture.bare, [
        "rev-list",
        "--count",
        unborn.value.ref,
      ]),
    ).toBe("1");
    await publisher.discard(prepared.value);
  });

  it("refuses to push when the remote moved after review, and classifies a raced rejection as diverged", async () => {
    const fixture = await createFixture();
    const site = await serveLoopbackGit(fixture);
    const publisher = await publisherFor(fixture);
    const exported = exportedFiles();

    const prepared = await publisher.prepare({
      files: exported.files,
      ref,
      remote: site.remote,
      treeDigest: exported.treeDigest,
    });
    if (!prepared.ok) throw new Error(prepared.error.message);
    const moved = await advanceRemote(fixture, "moved-after-review");

    expect(
      await publisher.push({
        files: exported.files,
        prepared: prepared.value,
        ref,
        remote: site.remote,
      }),
    ).toMatchObject({
      error: { code: "publication_drift", effects: "none" },
      ok: false,
    });
    expect(
      site.requests.some((line) => line.includes("git-receive-pack")),
    ).toBe(false);
    expect(
      await fixtureGit(fixture.home, fixture.bare, [
        "rev-parse",
        "refs/heads/main",
      ]),
    ).toBe(moved);
    await publisher.discard(prepared.value);

    // Race: the remote advances between the pre-push check and receive-pack.
    const racedPlan = await publisher.prepare({
      files: exported.files,
      ref,
      remote: site.remote,
      treeDigest: exported.treeDigest,
    });
    if (!racedPlan.ok) throw new Error(racedPlan.error.message);
    let racedTo = "";
    site.beforeReceivePack = async () => {
      racedTo = await advanceRemote(fixture, "raced");
    };
    const raced = await publisher.push({
      files: exported.files,
      prepared: racedPlan.value,
      ref,
      remote: site.remote,
    });
    site.beforeReceivePack = undefined;
    expect(raced).toMatchObject({
      ok: true,
      value: { observed: racedTo, status: "diverged" },
    });
    if (!raced.ok) throw new Error(raced.error.message);
    expect(raced.value.pushExitCode).not.toBe(0);
    expect(
      await fixtureGit(fixture.home, fixture.bare, [
        "rev-parse",
        "refs/heads/main",
      ]),
    ).toBe(racedTo);
    await publisher.discard(racedPlan.value);
  });

  it("reports uncertain when readback fails after the push and reconciles by readback only", async () => {
    const fixture = await createFixture();
    const site = await serveLoopbackGit(fixture);
    const publisher = await publisherFor(fixture);
    const exported = exportedFiles();

    const prepared = await publisher.prepare({
      files: exported.files,
      ref,
      remote: site.remote,
      treeDigest: exported.treeDigest,
    });
    if (!prepared.ok) throw new Error(prepared.error.message);
    site.afterReceivePack = async () => {
      site.failReads = true;
    };
    const pushed = await publisher.push({
      files: exported.files,
      prepared: prepared.value,
      ref,
      remote: site.remote,
    });
    expect(pushed).toEqual({
      ok: true,
      value: { observed: undefined, pushExitCode: 0, status: "uncertain" },
    });
    // The push did reach the fixture; only the readback was dark.
    expect(
      await fixtureGit(fixture.home, fixture.bare, [
        "rev-parse",
        "refs/heads/main",
      ]),
    ).toBe(prepared.value.candidateCommit);
    expect(
      await publisher.readback({
        base: prepared.value.base,
        candidateCommit: prepared.value.candidateCommit,
        ref,
        remote: site.remote,
      }),
    ).toEqual({ observed: undefined, status: "uncertain" });

    site.failReads = false;
    const receivePacks = site.requests.filter((line) =>
      line.includes("git-receive-pack"),
    ).length;
    expect(
      await publisher.readback({
        base: prepared.value.base,
        candidateCommit: prepared.value.candidateCommit,
        ref,
        remote: site.remote,
      }),
    ).toEqual({
      observed: prepared.value.candidateCommit,
      status: "published",
    });
    // Reconciliation never pushes.
    expect(
      site.requests.filter((line) => line.includes("git-receive-pack")).length,
    ).toBe(receivePacks);
    await publisher.discard(prepared.value);
  });
});
