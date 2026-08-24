import { describe, expect, it } from "vitest";

import {
  decodeWireFrames,
  encodeWireFrame,
  WIRE_PROTOCOL_VERSION,
  type WireFrame,
} from "@skills-desktop/skills-runtime";
import {
  REMOTE_BOOTSTRAP_COMMAND,
  REMOTE_BOOTSTRAP_DIGEST,
} from "@skills-desktop/remote-bootstrap";

import {
  createSshSkillsProcess,
  SshTransportBoundaryError,
  type SshTransportInvocation,
  type SshTransportRunner,
} from "./ssh-skills-process.js";

const projectJson = JSON.stringify([
  {
    agents: ["Codex"],
    name: "project-skill",
    path: "/SECRET/project-skill",
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
    path: "/SECRET/global-skill",
    scope: "global",
    source: "example/skills",
    sourceType: "github",
    sourceUrl: "https://SECRET_TOKEN@example.test/repo",
  },
]);

function concat(...inputs: readonly Uint8Array[]) {
  const result = new Uint8Array(
    inputs.reduce((length, input) => length + input.byteLength, 0),
  );
  let offset = 0;
  for (const input of inputs) {
    result.set(input, offset);
    offset += input.byteLength;
  }
  return result;
}

function scriptedTransport(
  response?: (request: WireFrame) => Uint8Array,
): SshTransportRunner & { readonly invocations: SshTransportInvocation[] } {
  const invocations: SshTransportInvocation[] = [];
  return {
    invocations,
    async run(invocation) {
      invocations.push(invocation);
      const decoded = decodeWireFrames(invocation.input);
      if (!decoded.ok || decoded.value.length !== 1) throw new Error();
      const request = decoded.value[0]!;
      const stdout =
        response?.(request) ??
        concat(
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
            requestId: request.type === "request" ? request.requestId : "bad",
            type: "inventory",
          }),
        );
      return { exitCode: 0, stderrBytes: 23, stdout };
    },
  };
}

const binding = {
  generation: 3,
  harness: "Codex",
  kind: "ssh" as const,
  ssh: {
    bindingDigest: "b".repeat(64),
    connectionReference: "build-host",
    connectionConfig: [
      "Host build-host",
      "  HostName resolved.internal",
      "  User deploy",
      "  Port 2222",
      "  IdentityFile /SECRET/id_ed25519",
      "  ProxyJump jump-host",
      "Host jump-host",
      "  HostName jump.internal",
    ].join("\n"),
    hostKey: { algorithm: "ssh-ed25519", key: "AQIDBA==" },
    hostKeyIdentity: "[resolved.internal]:2222",
    hostname: "resolved.internal",
    port: 2222,
    trustStorePath: "/application/known_hosts",
    user: "deploy",
    wireDialect: {
      bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
      protocolVersion: WIRE_PROTOCOL_VERSION,
    },
  },
  targetId: "00000000-0000-4000-8000-000000000018",
  workspace: "/srv/workspace; printf unsafe",
};

describe("SSH SkillsProcess observation contract", () => {
  it("publishes one atomic Inventory through a fresh hardened SSH session", async () => {
    const runner = scriptedTransport();
    let requestNumber = 0;
    const skillsProcess = createSshSkillsProcess({
      binding,
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => `request-${++requestNumber}`,
      runner,
    });

    const first = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    const second = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });

    expect(first).toMatchObject({
      ok: true,
      value: {
        entries: [
          { name: "project-skill", scope: "project" },
          { name: "global-skill", scope: "global" },
        ],
        observedAt: "2026-08-22T10:00:00.000Z",
      },
    });
    expect(second.ok).toBe(true);
    expect(runner.invocations).toHaveLength(2);
    expect(runner.invocations[0]).toMatchObject({
      args: [
        "-T",
        "-x",
        "-o",
        "BatchMode=yes",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ControlMaster=no",
        "-o",
        "ControlPath=none",
        "-o",
        "ForwardAgent=no",
        "-o",
        "PermitLocalCommand=no",
        "-o",
        "RequestTTY=no",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        'UserKnownHostsFile="/application/known_hosts"',
        "-o",
        'GlobalKnownHostsFile="/application/known_hosts"',
        "-o",
        "CheckHostIP=no",
        "-o",
        "UpdateHostKeys=no",
        "-o",
        "KnownHostsCommand=none",
        "-o",
        "VerifyHostKeyDNS=no",
        "-o",
        "CanonicalizeHostname=no",
        "-o",
        "HostName=resolved.internal",
        "-o",
        "User=deploy",
        "-o",
        "Port=2222",
        "-o",
        "HostKeyAlias=[resolved.internal]:2222",
        "--",
        "build-host",
        REMOTE_BOOTSTRAP_COMMAND,
      ],
      configuration: binding.ssh.connectionConfig,
      executable: "ssh",
    });
    expect(runner.invocations[0]!.args).not.toContain(
      "skills-desktop-frozen-target",
    );
    expect(
      decodeWireFrames(runner.invocations[0]!.cancellationInput!),
    ).toEqual({
      ok: true,
      value: [
        {
          operation: "cancel",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "request-1",
          type: "request",
        },
      ],
    });
    expect(REMOTE_BOOTSTRAP_COMMAND).not.toMatch(
      /build-host|srv\/workspace|Codex|project-skill/,
    );
    expect(JSON.stringify(first)).not.toMatch(/resolved\.internal|deploy/);
  });

  it("prepares the same exact reviewed mutation locally without opening SSH", async () => {
    const runner = scriptedTransport();
    let nextId = 0;
    const skillsProcess = createSshSkillsProcess({
      binding,
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => `request-${++nextId}`,
      runner,
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");

    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: {
        names: ["project-skill"],
        scope: "project",
        type: "remove",
      },
      inventory: observed.value,
      inventoryId: "inventory-ssh-1",
    });

    expect(prepared).toMatchObject({
      ok: true,
      value: {
        commandPlan: {
          harness: "Codex",
          names: ["project-skill"],
          operation: "remove",
          preview: "npx skills@1.5.23 remove project-skill --agent codex --yes",
          schemaVersion: 1,
          scope: "project",
          source: null,
          targetId: binding.targetId,
          timeoutMs: 120_000,
        },
        expiresAt: "2026-08-22T10:10:00.000Z",
        id: "request-2",
        inventoryId: "inventory-ssh-1",
        targetGeneration: 3,
        targetId: binding.targetId,
      },
    });
    expect(prepared.ok && prepared.value.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(runner.invocations).toHaveLength(1);
  });

  it("executes one confirmed normalized mutation and verifies its atomic postflight", async () => {
    const runner = scriptedTransport((request) => {
      if (request.type !== "request") throw new Error("unexpected Wire frame");
      return concat(
        encodeWireFrame({
          bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          type: "hello",
        }),
        request.operation === "observe"
          ? encodeWireFrame({
              cliVersion: "1.5.23",
              globalJson,
              projectJson,
              protocolVersion: WIRE_PROTOCOL_VERSION,
              requestId: request.requestId,
              type: "inventory",
            })
          : encodeWireFrame({
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
            }),
      );
    });
    let nextId = 0;
    const skillsProcess = createSshSkillsProcess({
      binding,
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => `request-${++nextId}`,
      runner,
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: {
        names: ["project-skill"],
        scope: "project",
        type: "remove",
      },
      inventory: observed.value,
      inventoryId: "inventory-ssh-1",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");

    const executed = await skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.value.digest,
        preparedMutationId: prepared.value.id,
      },
      signal: new AbortController().signal,
    });

    expect(executed).toMatchObject({
      ok: true,
      value: {
        effects: { status: "verified" },
        inventory: {
          entries: [{ name: "global-skill", scope: "global" }],
          observedAt: "2026-08-22T10:00:00.000Z",
        },
        preparedMutationId: "request-2",
        process: {
          disposition: "completed",
          exitCode: 0,
          termination: "known",
        },
      },
    });
    expect(runner.invocations).toHaveLength(2);
    expect(decodeWireFrames(runner.invocations[1]!.input)).toEqual({
      ok: true,
      value: [
        {
          harness: "Codex",
          mutation: {
            names: ["project-skill"],
            scope: "project",
            type: "remove",
          },
          operation: "mutate",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "request-3",
          type: "request",
          workspace: binding.workspace,
        },
      ],
    });
    expect(JSON.stringify(runner.invocations[1])).not.toMatch(
      /args.*project-skill|preview|generic/i,
    );
  });

  it("uses a separate cancellation frame and accepts only cleanup-proven cancellation", async () => {
    let markMutationStarted!: () => void;
    const mutationStarted = new Promise<void>((resolve) => {
      markMutationStarted = resolve;
    });
    const runner: SshTransportRunner = {
      async run(invocation) {
        const decoded = decodeWireFrames(invocation.input);
        if (!decoded.ok || decoded.value[0]?.type !== "request") {
          throw new Error("invalid fixture request");
        }
        const request = decoded.value[0];
        if (request.operation === "observe") {
          return {
            exitCode: 0,
            stderrBytes: 0,
            stdout: concat(
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
            ),
          };
        }
        markMutationStarted();
        await new Promise<void>((resolve) =>
          invocation.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        expect(decodeWireFrames(invocation.cancellationInput!)).toEqual({
          ok: true,
          value: [
            {
              operation: "cancel",
              protocolVersion: WIRE_PROTOCOL_VERSION,
              requestId: request.requestId,
              type: "request",
            },
          ],
        });
        return {
          exitCode: 0,
          interruption: "cancelled",
          stderrBytes: 0,
          stdout: concat(
            encodeWireFrame({
              bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
              protocolVersion: WIRE_PROTOCOL_VERSION,
              type: "hello",
            }),
            encodeWireFrame({
              cliVersion: "1.5.23",
              globalJson,
              process: {
                cleanup: "confirmed",
                disposition: "cancelled",
                exitCode: null,
              },
              projectJson,
              protocolVersion: WIRE_PROTOCOL_VERSION,
              requestId: request.requestId,
              type: "mutation-result",
            }),
          ),
        };
      },
    };
    let nextId = 0;
    const skillsProcess = createSshSkillsProcess({
      binding,
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => `request-${++nextId}`,
      runner,
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: {
        names: ["project-skill"],
        scope: "project",
        type: "remove",
      },
      inventory: observed.value,
      inventoryId: "inventory-ssh-cancel",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");
    const controller = new AbortController();
    const executing = skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.value.digest,
        preparedMutationId: prepared.value.id,
      },
      signal: controller.signal,
    });
    await mutationStarted;

    controller.abort();

    await expect(executing).resolves.toMatchObject({
      ok: true,
      value: {
        effects: { status: "not-observed" },
        inventory: { entries: expect.any(Array) },
        process: {
          disposition: "cancelled",
          exitCode: null,
          termination: "known",
        },
      },
    });
  });

  it("does not start a confirmed mutation when its signal is already aborted", async () => {
    const runner = scriptedTransport();
    let nextId = 0;
    const skillsProcess = createSshSkillsProcess({
      binding,
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => `request-${++nextId}`,
      runner,
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: {
        names: ["project-skill"],
        scope: "project",
        type: "remove",
      },
      inventory: observed.value,
      inventoryId: "inventory-ssh-pre-aborted",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");
    const controller = new AbortController();
    controller.abort();

    const executed = await skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.value.digest,
        preparedMutationId: prepared.value.id,
      },
      signal: controller.signal,
    });

    expect(executed).toMatchObject({
      ok: true,
      value: {
        effects: { status: "not-observed" },
        inventory: null,
        preparedMutationId: prepared.value.id,
        process: {
          disposition: "cancelled",
          exitCode: null,
          termination: "known",
        },
      },
    });
    expect(runner.invocations).toHaveLength(1);
  });

  it("returns an uncertain outcome without postflight or retry when cleanup is unproven", async () => {
    let mutationInvocations = 0;
    let markMutationStarted!: () => void;
    const mutationStarted = new Promise<void>((resolve) => {
      markMutationStarted = resolve;
    });
    const observedTransport = scriptedTransport();
    const runner: SshTransportRunner = {
      async run(invocation) {
        const decoded = decodeWireFrames(invocation.input);
        if (
          decoded.ok &&
          decoded.value[0]?.type === "request" &&
          decoded.value[0].operation === "mutate"
        ) {
          mutationInvocations += 1;
          markMutationStarted();
          await new Promise<void>((resolve) =>
            invocation.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
          throw new SshTransportBoundaryError(
            "SECRET_HOST raw transport cleanup failure",
            "cancelled",
          );
        }
        return observedTransport.run(invocation);
      },
    };
    let nextId = 0;
    const skillsProcess = createSshSkillsProcess({
      binding,
      clock: () => new Date("2026-08-22T10:00:00.000Z"),
      id: () => `request-${++nextId}`,
      runner,
    });
    const observed = await skillsProcess.observeInventory({
      signal: new AbortController().signal,
    });
    if (!observed.ok) throw new Error("fixture observation failed");
    const prepared = await skillsProcess.prepareMutation({
      freshness: "fresh",
      intent: {
        names: ["project-skill"],
        scope: "project",
        type: "remove",
      },
      inventory: observed.value,
      inventoryId: "inventory-ssh-uncertain",
    });
    if (!prepared.ok) throw new Error("fixture preparation failed");
    const controller = new AbortController();
    const execution = skillsProcess.executeConfirmed({
      confirmation: {
        digest: prepared.value.digest,
        preparedMutationId: prepared.value.id,
      },
      signal: controller.signal,
    });
    await mutationStarted;
    controller.abort();
    const executed = await execution;

    expect(executed).toMatchObject({
      ok: true,
      value: {
        effects: { status: "possible" },
        inventory: null,
        process: {
          disposition: "cancelled",
          exitCode: null,
          termination: "unknown",
        },
      },
    });
    expect(mutationInvocations).toBe(1);
    expect(JSON.stringify(executed)).not.toContain("SECRET_HOST");
  });

  it.each([
    {
      name: "wrong bootstrap digest",
      response: (request: WireFrame) =>
        concat(
          encodeWireFrame({
            bootstrapDigest: "0".repeat(64),
            protocolVersion: WIRE_PROTOCOL_VERSION,
            type: "hello",
          }),
          encodeWireFrame({
            cliVersion: "1.5.23",
            globalJson,
            projectJson,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            requestId: request.type === "request" ? request.requestId : "bad",
            type: "inventory",
          }),
        ),
      code: "remote_protocol_mismatch",
    },
    {
      name: "protocol contamination",
      response: () => new Uint8Array([0, 0, 0, 2, 123, 125]),
      code: "remote_protocol_violation",
    },
    {
      name: "partial inventory",
      response: () =>
        encodeWireFrame({
          bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          type: "hello",
        }),
      code: "remote_protocol_violation",
    },
    {
      name: "missing remote runtime",
      response: () =>
        concat(
          encodeWireFrame({
            bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            type: "hello",
          }),
          encodeWireFrame({
            code: "remote_runtime_unavailable",
            message: "The remote runtime is unavailable.",
            phase: "version",
            protocolVersion: WIRE_PROTOCOL_VERSION,
            requestId: "request-1",
            type: "failure",
          }),
        ),
      code: "remote_runtime_unavailable",
      expectedPhase: "version",
    },
    {
      name: "failed remote version check",
      response: () =>
        concat(
          encodeWireFrame({
            bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            type: "hello",
          }),
          encodeWireFrame({
            code: "remote_operation_failed",
            message: "Remote runtime verification failed.",
            phase: "version",
            protocolVersion: WIRE_PROTOCOL_VERSION,
            requestId: "request-1",
            type: "failure",
          }),
        ),
      code: "process_failed",
      expectedMessage: "Remote runtime verification failed.",
      expectedPhase: "version",
    },
    {
      name: "oversized remote version output",
      response: () =>
        concat(
          encodeWireFrame({
            bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            type: "hello",
          }),
          encodeWireFrame({
            code: "output_limit_exceeded",
            message:
              "Remote runtime verification output exceeds its byte limit.",
            phase: "version",
            protocolVersion: WIRE_PROTOCOL_VERSION,
            requestId: "request-1",
            type: "failure",
          }),
        ),
      code: "process_failed",
      expectedMessage:
        "Remote runtime verification output exceeded its byte limit.",
      expectedPhase: "version",
    },
    {
      name: "bounded remote output",
      response: () =>
        concat(
          encodeWireFrame({
            bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            type: "hello",
          }),
          encodeWireFrame({
            code: "output_limit_exceeded",
            message: "Remote Inventory output exceeds its byte limit.",
            phase: "observe",
            protocolVersion: WIRE_PROTOCOL_VERSION,
            requestId: "request-1",
            type: "failure",
          }),
        ),
      code: "inventory_too_large",
    },
    {
      name: "stale remote failure",
      response: () =>
        concat(
          encodeWireFrame({
            bootstrapDigest: REMOTE_BOOTSTRAP_DIGEST,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            type: "hello",
          }),
          encodeWireFrame({
            code: "remote_operation_failed",
            message: "Remote Inventory observation failed.",
            phase: "observe",
            protocolVersion: WIRE_PROTOCOL_VERSION,
            requestId: "prior-request",
            type: "failure",
          }),
        ),
      code: "remote_protocol_violation",
    },
  ])(
    "fails atomically on $name",
    async ({ response, code, expectedMessage, expectedPhase }) => {
      const process = createSshSkillsProcess({
        binding,
        clock: () => new Date(),
        id: () => "request-1",
        runner: scriptedTransport(response),
      });

      expect(
        await process.observeInventory({
          signal: new AbortController().signal,
        }),
      ).toMatchObject({
        error: {
          code,
          effects: "none",
          ...(expectedMessage === undefined
            ? {}
            : { message: expectedMessage }),
          phase: expectedPhase ?? "observe",
        },
        ok: false,
      });
    },
  );

  it("does not manufacture a precise cause from OpenSSH exit 255 or raw stderr", async () => {
    const runner: SshTransportRunner = {
      async run() {
        return { exitCode: 255, stderrBytes: 4_096, stdout: new Uint8Array() };
      },
    };
    const process = createSshSkillsProcess({
      binding,
      clock: () => new Date(),
      id: () => "request-1",
      runner,
    });

    const observed = await process.observeInventory({
      signal: new AbortController().signal,
    });
    expect(observed).toMatchObject({
      error: {
        code: "transport_lost",
        message: "The SSH transport ended before a complete remote result.",
      },
      ok: false,
    });
    expect(JSON.stringify(observed)).not.toContain("authentication");
  });

  it("rejects complete-looking output when the SSH session exits nonzero", async () => {
    const successful = scriptedTransport();
    const runner: SshTransportRunner = {
      async run(invocation) {
        return { ...(await successful.run(invocation)), exitCode: 255 };
      },
    };
    const process = createSshSkillsProcess({
      binding,
      clock: () => new Date(),
      id: () => "request-1",
      runner,
    });

    await expect(
      process.observeInventory({ signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      error: { code: "transport_lost", effects: "none" },
      ok: false,
    });
  });

  it("cancels an in-flight SSH session without publishing partial output", async () => {
    const runner: SshTransportRunner = {
      run(invocation) {
        return new Promise((_resolve, reject) => {
          invocation.signal.addEventListener(
            "abort",
            () =>
              reject(
                new SshTransportBoundaryError(
                  "SSH transport was cancelled.",
                  "cancelled",
                ),
              ),
            { once: true },
          );
        });
      },
    };
    const process = createSshSkillsProcess({
      binding,
      clock: () => new Date(),
      id: () => "request-1",
      runner,
    });
    const controller = new AbortController();
    const observed = process.observeInventory({ signal: controller.signal });

    controller.abort();

    await expect(observed).resolves.toMatchObject({
      error: { code: "cancelled", effects: "none" },
      ok: false,
    });
  });
});
