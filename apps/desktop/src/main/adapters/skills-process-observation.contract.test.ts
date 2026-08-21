import { describe, expect, it } from "vitest";

import {
  CLI_PACKAGE,
  decodeWireFrames,
  encodeWireFrame,
  WIRE_PROTOCOL_VERSION,
  type WireFrame,
} from "@skills-desktop/skills-runtime";
import { REMOTE_BOOTSTRAP_DIGEST } from "@skills-desktop/remote-bootstrap";

import {
  createLocalSkillsProcess,
  type ProcessRunner,
  type SkillsProcess,
} from "./local-skills-process.js";
import {
  createSshSkillsProcess,
  type SshTransportRunner,
} from "./ssh-skills-process.js";

const projectJson = JSON.stringify([
  {
    agents: ["Codex"],
    name: "project-skill",
    path: "/private/project",
    scope: "project",
    source: null,
    sourceType: null,
    sourceUrl: null,
  },
]);
const globalJson = JSON.stringify([
  {
    agents: ["Codex"],
    name: "global-skill",
    path: "/private/global",
    scope: "global",
    source: null,
    sourceType: null,
    sourceUrl: null,
  },
]);

function localProcess(): SkillsProcess {
  const runner: ProcessRunner = {
    async run(invocation) {
      const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
      const operation = invocation.args.slice(packageIndex + 1).join(" ");
      if (operation === "--version") {
        return { exitCode: 0, stderr: "", stdout: "1.5.23" };
      }
      if (operation === "list --json") {
        return { exitCode: 0, stderr: "", stdout: projectJson };
      }
      if (operation === "list --global --json") {
        return { exitCode: 0, stderr: "", stdout: globalJson };
      }
      throw new Error("Unexpected operation.");
    },
  };
  return createLocalSkillsProcess({
    clock: () => new Date("2026-08-22T10:00:00.000Z"),
    platform: "linux",
    runner,
    workspace: "/workspace",
  });
}

function sshProcess(): SkillsProcess {
  const runner: SshTransportRunner = {
    async run(invocation) {
      const decoded = decodeWireFrames(invocation.input);
      if (!decoded.ok) throw new Error();
      const request = decoded.value[0] as Extract<WireFrame, { type: "request" }>;
      const frames = [
        encodeWireFrame({
          bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          type: "hello",
        }),
        encodeWireFrame({
          cliVersion: "1.5.23",
          globalJson,
          projectJson,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: request.requestId,
          type: "inventory",
        }),
      ];
      const stdout = new Uint8Array(
        frames.reduce((length, frame) => length + frame.length, 0),
      );
      stdout.set(frames[0]!);
      stdout.set(frames[1]!, frames[0]!.length);
      return { exitCode: 0, stderrBytes: 0, stdout };
    },
  };
  return createSshSkillsProcess({
    binding: {
      generation: 2,
      harness: "Codex",
      kind: "ssh",
      ssh: {
        bindingDigest: "a".repeat(64),
        connectionReference: "build-host",
        hostKey: { algorithm: "ssh-ed25519", key: "AQIDBA==" },
        hostKeyIdentity: "build.internal",
        hostname: "build.internal",
        port: 22,
        trustStorePath: "/application/known_hosts",
        user: "deploy",
        wireDialect: {
          bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
          protocolVersion: WIRE_PROTOCOL_VERSION,
        },
      },
      targetId: "00000000-0000-4000-8000-000000000018",
      workspace: "/workspace",
    },
    clock: () => new Date("2026-08-22T10:00:00.000Z"),
    id: () => "observe-1",
    runner,
  });
}

describe.each([
  ["Local", localProcess],
  ["scripted SSH", sshProcess],
] as const)("SkillsProcess observation contract: %s", (_name, createProcess) => {
  it("publishes one complete project-and-global Inventory", async () => {
    await expect(
      createProcess().observeInventory({
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        entries: [
          { name: "project-skill", scope: "project" },
          { name: "global-skill", scope: "global" },
        ],
        observedAt: "2026-08-22T10:00:00.000Z",
      },
    });
  });

  it("cancels before work without publishing partial state", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createProcess().observeInventory({ signal: controller.signal }),
    ).resolves.toMatchObject({
      error: { code: "cancelled", effects: "none" },
      ok: false,
    });
  });
});
