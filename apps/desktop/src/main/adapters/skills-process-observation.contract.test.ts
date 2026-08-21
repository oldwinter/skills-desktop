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
  let removed = false;
  const runner: ProcessRunner = {
    async run(invocation) {
      const packageIndex = invocation.args.indexOf(CLI_PACKAGE);
      const operation = invocation.args.slice(packageIndex + 1).join(" ");
      if (operation === "--version") {
        return { exitCode: 0, stderr: "", stdout: "1.5.23" };
      }
      if (operation === "list --json") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: removed ? "[]" : projectJson,
        };
      }
      if (operation === "list --global --json") {
        return { exitCode: 0, stderr: "", stdout: globalJson };
      }
      if (operation === "remove project-skill --agent codex --yes") {
        removed = true;
        return { exitCode: 0, stderr: "", stdout: "removed" };
      }
      throw new Error("Unexpected operation.");
    },
  };
  return createLocalSkillsProcess({
    binding: {
      generation: 2,
      harness: "Codex",
      targetId: "00000000-0000-4000-8000-000000000018",
    },
    clock: () => new Date("2026-08-22T10:00:00.000Z"),
    id: () => "prepared-local",
    platform: "linux",
    runner,
    workspace: "/workspace",
  });
}

function sshProcess(): SkillsProcess {
  let removed = false;
  const runner: SshTransportRunner = {
    async run(invocation) {
      const decoded = decodeWireFrames(invocation.input);
      if (!decoded.ok) throw new Error();
      const request = decoded.value[0] as Extract<
        WireFrame,
        { type: "request" }
      >;
      const frames = [
        encodeWireFrame({
          bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          type: "hello",
        }),
        request.operation === "mutate"
          ? encodeWireFrame({
              cliVersion: "1.5.23",
              globalJson,
              process: {
                cleanup: "confirmed",
                disposition: "completed",
                exitCode: 0,
              },
              projectJson: "[]",
              protocolVersion: WIRE_PROTOCOL_VERSION,
              requestId: request.requestId,
              type: "mutation-result",
            })
          : encodeWireFrame({
              cliVersion: "1.5.23",
              globalJson,
              projectJson: removed ? "[]" : projectJson,
              protocolVersion: WIRE_PROTOCOL_VERSION,
              requestId: request.requestId,
              type: "inventory",
            }),
      ];
      if (request.operation === "mutate") removed = true;
      const stdout = new Uint8Array(
        frames.reduce((length, frame) => length + frame.length, 0),
      );
      stdout.set(frames[0]!);
      stdout.set(frames[1]!, frames[0]!.length);
      return { exitCode: 0, stderrBytes: 0, stdout };
    },
  };
  let nextId = 0;
  return createSshSkillsProcess({
    binding: {
      generation: 2,
      harness: "Codex",
      kind: "ssh",
      ssh: {
        bindingDigest: "a".repeat(64),
        connectionReference: "build-host",
        connectionConfig: "Host build-host\n  HostName build.internal\n",
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
    id: () => `ssh-contract-${++nextId}`,
    runner,
  });
}

describe.each([
  ["Local", localProcess],
  ["scripted SSH", sshProcess],
] as const)(
  "SkillsProcess observation contract: %s",
  (_name, createProcess) => {
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

    it("prepares, executes, verifies, and consumes one exact mutation", async () => {
      const process = createProcess();
      const observed = await process.observeInventory({
        signal: new AbortController().signal,
      });
      if (!observed.ok) throw new Error("fixture observation failed");
      const prepared = await process.prepareMutation({
        freshness: "fresh",
        intent: {
          names: ["project-skill"],
          scope: "project",
          type: "remove",
        },
        inventory: observed.value,
        inventoryId: "contract-inventory",
      });
      if (!prepared.ok) throw new Error("fixture preparation failed");

      expect(prepared.value.commandPlan).toMatchObject({
        harness: "Codex",
        names: ["project-skill"],
        operation: "remove",
        scope: "project",
        targetId: "00000000-0000-4000-8000-000000000018",
      });
      await expect(
        process.executeConfirmed({
          confirmation: {
            digest: prepared.value.digest,
            preparedMutationId: prepared.value.id,
          },
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          effects: { status: "verified" },
          inventory: {
            entries: [{ name: "global-skill", scope: "global" }],
          },
          process: { disposition: "completed", termination: "known" },
        },
      });
      await expect(
        process.executeConfirmed({
          confirmation: {
            digest: prepared.value.digest,
            preparedMutationId: prepared.value.id,
          },
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({
        error: { code: "confirmation_invalid", effects: "none" },
        ok: false,
      });
    });

    it.each([
      {
        intent: {
          names: ["new-global-skill"],
          scope: "global" as const,
          source: {
            source: "example/skills",
            sourceType: "github" as const,
          },
          type: "add" as const,
        },
        plan: {
          names: ["new-global-skill"],
          operation: "add",
          scope: "global",
          source: { source: "example/skills", sourceType: "github" },
          timeoutMs: 600_000,
        },
      },
      {
        intent: {
          names: ["project-skill"],
          scope: "project" as const,
          type: "update" as const,
        },
        plan: {
          names: ["project-skill"],
          operation: "update",
          scope: "project",
          source: null,
          timeoutMs: 600_000,
        },
      },
      {
        intent: {
          scope: "project" as const,
          type: "update-all" as const,
        },
        plan: {
          names: ["project-skill"],
          operation: "update",
          scope: "project",
          source: null,
          timeoutMs: 600_000,
        },
      },
    ])(
      "prepares one exact $intent.type plan from Fresh Inventory",
      async ({ intent, plan }) => {
        const process = createProcess();
        const observed = await process.observeInventory({
          signal: new AbortController().signal,
        });
        if (!observed.ok) throw new Error("fixture observation failed");

        await expect(
          process.prepareMutation({
            freshness: "fresh",
            intent,
            inventory: observed.value,
            inventoryId: `contract-${intent.type}`,
          }),
        ).resolves.toMatchObject({
          ok: true,
          value: {
            commandPlan: plan,
            expiresAt: "2026-08-22T10:10:00.000Z",
            inventoryId: `contract-${intent.type}`,
            targetGeneration: 2,
          },
        });
      },
    );
  },
);
