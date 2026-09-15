import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WELL_KNOWN_EXPORT_PROFILE,
  describeSource,
  exportWellKnownTree,
  type WellKnownExport,
} from "@skills-desktop/skills-runtime";

import {
  createLocalSkillsProcess,
  createSpawnProcessRunner,
} from "../apps/desktop/src/main/adapters/local-skills-process.js";
import { createNodeWellKnownCodec } from "../apps/desktop/src/main/adapters/node-well-known-codec.js";

/**
 * ADR 0024 mission surface: ephemeral local HTTP serving the exact bytes the
 * deterministic exporter (ADR 0019) produced, read back by the real pinned
 * CLI through the production Local Adapter. The evidence is Linux/localhost
 * only; it says nothing about live hosting, TLS, CDNs, or external services.
 *
 * The server binds 127.0.0.1 on an OS-selected port, serves only from an
 * in-memory map, and is the only process this suite stops. HOME, workspace,
 * and the npm cache are worker-owned temporary roots.
 */

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

function skillMarkdown(name: string, description: string): Uint8Array {
  return encoder.encode(
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nLocalhost well-known smoke body.\n`,
  );
}

function exportFixture(): WellKnownExport {
  const exported = exportWellKnownTree(
    [
      {
        files: [
          {
            bytes: skillMarkdown(
              "single-file-skill",
              "One SKILL.md served as skill-md.",
            ),
            path: "SKILL.md",
          },
        ],
        name: "single-file-skill",
      },
      {
        files: [
          {
            bytes: skillMarkdown(
              "archive-skill",
              "Two files served as a deterministic archive.",
            ),
            path: "SKILL.md",
          },
          {
            bytes: encoder.encode("#!/bin/sh\necho archive-skill\n"),
            path: "scripts/run.sh",
          },
        ],
        name: "archive-skill",
      },
    ],
    createNodeWellKnownCodec(),
  );
  if (!exported.ok) throw new Error(exported.error.message);
  return exported.value;
}

interface EphemeralSite {
  readonly origin: string;
  readonly requests: readonly string[];
}

/**
 * Serves exactly the exported files (path-for-path, byte-for-byte) and
 * nothing else. No directory listing, no index fallback, no filesystem.
 */
async function serveExactBytes(
  files: ReadonlyMap<string, Uint8Array>,
): Promise<EphemeralSite> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    requests.push(`${request.method ?? "?"} ${path}`);
    const bytes = request.method === "GET" ? files.get(path) : undefined;
    if (bytes === undefined) {
      response.writeHead(404, { "content-length": "0" });
      response.end();
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": String(bytes.byteLength),
      "content-type": path.endsWith(".json")
        ? "application/json"
        : "application/octet-stream",
    });
    response.end(Buffer.from(bytes));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("The ephemeral HTTP server did not report a port.");
  }
  return { origin: `http://127.0.0.1:${address.port}`, requests };
}

function filesOf(exported: WellKnownExport): Map<string, Uint8Array> {
  return new Map(exported.files.map((file) => [`/${file.path}`, file.bytes]));
}

async function isolatedSkillsProcess() {
  const root = await mkdtemp(join(tmpdir(), "skills-desktop-well-known-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const skillsProcess = createLocalSkillsProcess({
    binding: {
      generation: 1,
      harness: "Codex",
      targetId: "00000000-0000-4000-8000-000000000001",
    },
    clock: () => new Date("2026-08-22T06:00:00.000Z"),
    environment: {
      HOME: root,
      NPM_CONFIG_CACHE: join(root, "npm-cache"),
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: root,
    },
    platform: process.platform,
    runner: createSpawnProcessRunner({ platform: process.platform }),
    workspace,
  });
  return { root, skillsProcess, workspace };
}

async function inspect(origin: string) {
  const { root, skillsProcess, workspace } = await isolatedSkillsProcess();
  const described = describeSource(origin);
  if (!described.ok) throw new Error(described.error.message);
  expect(described.value).toMatchObject({
    family: "well-known",
    locality: "portable",
    mutability: "mutable",
  });
  const inspected = await skillsProcess.inspectSource({
    descriptor: described.value,
    signal: new AbortController().signal,
  });
  // Read-only: the CLI never materialised a Skill anywhere we own.
  await expect(access(join(workspace, ".agents"))).rejects.toThrow();
  await expect(access(join(root, ".agents"))).rejects.toThrow();
  expect(await readdir(workspace)).toEqual([]);
  return inspected;
}

describe("ephemeral well-known HTTP readback through the pinned CLI (ADR 0019 / ADR 0024, #212)", () => {
  it("lists exactly the exported index from exact bytes served on an OS-selected port", async () => {
    const exported = exportFixture();
    const site = await serveExactBytes(filesOf(exported));

    const inspected = await inspect(site.origin);

    expect(inspected).toMatchObject({
      ok: true,
      value: {
        cliVersion: "1.5.23",
        descriptor: { family: "well-known", source: site.origin },
        targetGeneration: 1,
      },
    });
    if (!inspected.ok) throw new Error(inspected.error.message);
    expect(inspected.value.digest).toMatch(/^[a-f0-9]{64}$/);
    // The CLI's candidate list is the exporter's index, name for name and
    // description for description, in the exporter's byte order.
    expect(
      inspected.value.candidates.map(({ description, name }) => ({
        description,
        name,
      })),
    ).toEqual(
      exported.index.skills.map(({ description, name }) => ({
        description,
        name,
      })),
    );
    expect(exported.index.skills.map(({ type }) => type)).toEqual([
      "archive",
      "skill-md",
    ]);
    // The CLI fetched the pinned index path and then each referenced artefact.
    expect(site.requests).toContain(
      `GET /${WELL_KNOWN_EXPORT_PROFILE.indexPath}`,
    );
    for (const entry of exported.index.skills) {
      expect(site.requests).toContain(
        `GET /${WELL_KNOWN_EXPORT_PROFILE.rootDirectory}/${entry.url.slice(2)}`,
      );
    }
    expect(site.requests.every((line) => line.startsWith("GET "))).toBe(true);
  });

  it("drops an artefact whose served bytes no longer match the index digest", async () => {
    const exported = exportFixture();
    const files = filesOf(exported);
    const tamperedPath = `/${WELL_KNOWN_EXPORT_PROFILE.rootDirectory}/single-file-skill/SKILL.md`;
    const original = files.get(tamperedPath);
    if (original === undefined) throw new Error("fixture path missing");
    files.set(
      tamperedPath,
      encoder.encode(
        `${new TextDecoder().decode(original)}\nTampered after export.\n`,
      ),
    );
    const site = await serveExactBytes(files);

    const inspected = await inspect(site.origin);

    expect(inspected).toMatchObject({ ok: true });
    if (!inspected.ok) throw new Error(inspected.error.message);
    expect(inspected.value.candidates.map(({ name }) => name)).toEqual([
      "archive-skill",
    ]);
    expect(site.requests).toContain(`GET ${tamperedPath}`);
  });

  it("reports an origin without a discovery index as unsupported instead of inventing candidates", async () => {
    const site = await serveExactBytes(new Map());

    const inspected = await inspect(site.origin);

    expect(inspected).toMatchObject({
      ok: false,
      error: { effects: "none" },
    });
    expect(site.requests).toContain(
      `GET /${WELL_KNOWN_EXPORT_PROFILE.indexPath}`,
    );
  });
});
