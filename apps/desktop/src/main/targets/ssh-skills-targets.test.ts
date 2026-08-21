import { describe, expect, it, vi } from "vitest";

import type { SkillsProcess } from "../adapters/local-skills-process.js";
import { WIRE_PROTOCOL_VERSION } from "@skills-desktop/skills-runtime";
import { REMOTE_BOOTSTRAP_DIGEST } from "@skills-desktop/remote-bootstrap";
import type {
  HostTrustChallenge,
  OpenSshEffectiveBinding,
  OpenSshTargetAccess,
} from "../ssh/openssh-target.js";
import { createSkillsTargetsCatalog } from "./local-skills-targets.js";
import type { TargetDefinition } from "./skills-targets.js";

const sshTarget: TargetDefinition = {
  connectionReference: "build-host",
  executionBindingDigest: null,
  generation: 1,
  harness: "Codex",
  id: "00000000-0000-4000-8000-000000000018",
  kind: "ssh",
  label: "Build host",
  workspace: "/srv/skills",
  workspaceLabel: "skills",
};
const challenge: HostTrustChallenge = {
  algorithm: "ssh-ed25519",
  expiresAt: "2026-08-22T10:05:00.000Z",
  fingerprint: "SHA256:reviewed",
  id: "challenge-1",
  identity: "deploy@resolved.internal:2222",
  kind: "first-use",
  targetGeneration: 2,
  targetId: sshTarget.id,
};
const sshBinding: OpenSshEffectiveBinding = {
  bindingDigest: "a".repeat(64),
  connectionConfig:
    "Host skills-desktop-frozen-target\n  HostName resolved.internal\n",
  connectionReference: "build-host",
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
};
const process: SkillsProcess = {
  async executeConfirmed() {
    return {
      error: {
        code: "confirmation_invalid",
        effects: "none",
        message: "not exercised",
        phase: "execute",
        retryable: false,
      },
      ok: false,
    };
  },
  async observeInventory() {
    return {
      error: {
        code: "transport_failed",
        effects: "none",
        message: "not exercised",
        phase: "observe",
        retryable: true,
      },
      ok: false,
    };
  },
  async prepareMutation() {
    return {
      error: {
        code: "mutation_ineligible",
        effects: "none",
        message: "not exercised",
        phase: "prepare",
        retryable: false,
      },
      ok: false,
    };
  },
};

describe("SSH SkillsTargets opening", () => {
  it("advances generation for binding and trust changes before returning a frozen session", async () => {
    let trusted = false;
    let currentBinding = sshBinding;
    const access: OpenSshTargetAccess = {
      async confirm() {
        trusted = true;
        return {
          ok: true,
          value: { bindingDigest: sshBinding.bindingDigest, kind: "first-use" },
        };
      },
      async inspect() {
        return trusted
          ? {
              ok: true,
              value: {
                binding: currentBinding,
                bindingDigest: currentBinding.bindingDigest,
                status: "ready",
              },
            }
          : {
              ok: true,
              value: {
                bindingDigest: sshBinding.bindingDigest,
                challenge,
                status: "trust-required",
              },
            };
      },
      pendingChallenge() {
        return trusted ? undefined : challenge;
      },
    };
    const processFor = vi.fn(() => process);
    const targets = createSkillsTargetsCatalog({
      id: () => "00000000-0000-4000-8000-000000000099",
      initialTarget: sshTarget,
      processFor,
      sshAccess: access,
    });

    const drifted = await targets.open(sshTarget.id);
    expect(drifted).toMatchObject({
      ok: true,
      value: {
        proposal: {
          executionChanged: true,
          target: {
            executionBindingDigest: sshBinding.bindingDigest,
            generation: 2,
          },
        },
        status: "binding-changed",
      },
    });
    if (
      !drifted.ok ||
      !("status" in drifted.value) ||
      drifted.value.status !== "binding-changed"
    )
      throw new Error();
    targets.replaceDefinitions(drifted.value.proposal.definitions);

    await expect(targets.open(sshTarget.id)).resolves.toMatchObject({
      ok: true,
      value: { challenge, status: "trust-required" },
    });
    expect(targets.pendingHostTrust(sshTarget.id)).toEqual(challenge);

    const trustedProposal = targets.proposeHostTrust(
      sshTarget.id,
      challenge.id,
    );
    expect(trustedProposal).toMatchObject({
      ok: true,
      value: {
        executionChanged: true,
        target: { generation: 3 },
      },
    });
    if (!trustedProposal.ok) throw new Error();
    expect(trusted).toBe(false);
    await expect(
      targets.commitHostTrust(
        sshTarget.id,
        challenge.id,
        challenge.targetGeneration,
      ),
    ).resolves.toMatchObject({ ok: true });
    targets.replaceDefinitions(trustedProposal.value.definitions);

    const opened = await targets.open(sshTarget.id);
    expect(opened).toMatchObject({
      ok: true,
      value: {
        binding: {
          generation: 3,
          kind: "ssh",
          ssh: sshBinding,
          targetId: sshTarget.id,
        },
        target: { generation: 3 },
      },
    });
    expect(processFor).toHaveBeenCalledWith(
      expect.objectContaining({ ssh: sshBinding }),
    );

    currentBinding = {
      ...sshBinding,
      bindingDigest: "c".repeat(64),
      port: 2200,
    };
    await expect(targets.open(sshTarget.id)).resolves.toMatchObject({
      ok: true,
      value: {
        proposal: {
          target: { executionBindingDigest: "c".repeat(64), generation: 4 },
        },
        status: "binding-changed",
      },
    });
  });
});
