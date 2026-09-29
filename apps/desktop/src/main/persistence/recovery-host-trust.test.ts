import { describe, expect, it, vi } from "vitest";

import { createRecoveryHostTrustStore } from "./recovery-host-trust.js";
import {
  createMemoryRecoveryRecords,
  type RecoveryRecords,
  type RestoredRecoveryRecords,
} from "./recovery-records.js";

const keyMaterial = Buffer.from("ed25519 public key bytes").toString("base64");
const rsaKeyMaterial = Buffer.from("rsa public key bytes").toString("base64");

function restored(
  overrides: Partial<RestoredRecoveryRecords> = {},
): RestoredRecoveryRecords {
  return {
    failures: [],
    hostTrustRecords: [],
    inventorySnapshots: [],
    mutationGuards: [],
    targetDefinitions: [],
    ...overrides,
  };
}

describe("createRecoveryHostTrustStore", () => {
  it("round-trips lookups and replacements through recovery records", async () => {
    const records = createMemoryRecoveryRecords([], [], [], [
      { algorithm: "ssh-ed25519", identity: "seeded-host", key: keyMaterial },
    ]);
    const store = createRecoveryHostTrustStore({
      path: "/state/known_hosts",
      records,
    });

    expect(store.path).toBe("/state/known_hosts");
    expect(await store.lookup("seeded-host")).toEqual({
      algorithm: "ssh-ed25519",
      key: keyMaterial,
    });
    expect(await store.lookup("unknown-host")).toBeNull();

    await store.replace("new-host", {
      algorithm: "ssh-rsa",
      key: rsaKeyMaterial,
    });
    expect(await store.lookup("new-host")).toEqual({
      algorithm: "ssh-rsa",
      key: rsaKeyMaterial,
    });

    // A second store over the same records sees the committed write.
    const reloaded = createRecoveryHostTrustStore({
      path: "/state/known_hosts",
      records,
    });
    expect(await reloaded.lookup("new-host")).toEqual({
      algorithm: "ssh-rsa",
      key: rsaKeyMaterial,
    });
  });

  it("restores the record map once across repeated operations", async () => {
    const records = createMemoryRecoveryRecords([], [], [], [
      { algorithm: "ssh-ed25519", identity: "host-a", key: keyMaterial },
    ]);
    const restore = vi.spyOn(records, "restore");
    const store = createRecoveryHostTrustStore({
      path: "/state/known_hosts",
      records,
    });

    await store.lookup("host-a");
    await store.replace("host-b", {
      algorithm: "ssh-ed25519",
      key: keyMaterial,
    });
    await store.lookup("host-b");

    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("rejects lookups when the host-trust store failed to restore", async () => {
    const records: RecoveryRecords = {
      commit: vi.fn(),
      restore: async () =>
        restored({
          failures: [{ code: "corrupt_store", store: "hostTrustRecords" }],
        }),
    };
    const store = createRecoveryHostTrustStore({
      path: "/state/known_hosts",
      records,
    });

    await expect(store.lookup("host-a")).rejects.toThrow(
      "Host Trust Records are unavailable.",
    );
    await expect(
      store.replace("host-a", {
        algorithm: "ssh-ed25519",
        key: keyMaterial,
      }),
    ).rejects.toThrow("Host Trust Records are unavailable.");
  });

  it("ignores restore failures from unrelated stores", async () => {
    const records: RecoveryRecords = {
      commit: vi.fn(async () => ({ ok: true as const, value: undefined })),
      restore: async () =>
        restored({
          failures: [{ code: "corrupt_store", store: "targetDefinitions" }],
          hostTrustRecords: [
            {
              algorithm: "ssh-ed25519",
              identity: "host-a",
              key: keyMaterial,
            },
          ],
        }),
    };
    const store = createRecoveryHostTrustStore({
      path: "/state/known_hosts",
      records,
    });

    expect(await store.lookup("host-a")).toEqual({
      algorithm: "ssh-ed25519",
      key: keyMaterial,
    });
  });

  it("rejects replace when the durable commit fails", async () => {
    const records: RecoveryRecords = {
      commit: async () => ({
        error: {
          code: "persist_failed" as const,
          effects: "none" as const,
          message: "Disk is full.",
          phase: "persist",
          retryable: false,
        },
        ok: false as const,
      }),
      restore: async () => restored(),
    };
    const store = createRecoveryHostTrustStore({
      path: "/state/known_hosts",
      records,
    });

    await expect(
      store.replace("host-a", {
        algorithm: "ssh-ed25519",
        key: keyMaterial,
      }),
    ).rejects.toThrow("Host Trust Record could not be saved.");
  });
});
