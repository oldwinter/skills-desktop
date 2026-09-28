import { describe, expect, it } from "vitest";

import { parseOpenSshPublicKey } from "./host-public-key.js";

const ed25519Key = Buffer.from("ed25519 public key bytes").toString("base64");
const rsaKey = Buffer.from("rsa public key bytes".repeat(32)).toString(
  "base64",
);

describe("parseOpenSshPublicKey", () => {
  it("parses a canonical OpenSSH public key line", () => {
    expect(
      parseOpenSshPublicKey(`ssh-ed25519 ${ed25519Key}`),
    ).toEqual({ algorithm: "ssh-ed25519", key: ed25519Key });
    expect(parseOpenSshPublicKey(`  ssh-rsa   ${rsaKey}  `)).toEqual({
      algorithm: "ssh-rsa",
      key: rsaKey,
    });
    expect(
      parseOpenSshPublicKey(
        `ecdsa-sha2-nistp256 ${Buffer.from("ec bytes").toString("base64")}`,
      ),
    ).toMatchObject({ algorithm: "ecdsa-sha2-nistp256" });
    expect(
      parseOpenSshPublicKey(
        `rsa-sha2-512 ${Buffer.from("rsa-sha2 bytes").toString("base64")}`,
      ),
    ).toMatchObject({ algorithm: "rsa-sha2-512" });
  });

  it("rejects lines with trailing comment or extra tokens", () => {
    expect(
      parseOpenSshPublicKey(`ssh-ed25519 ${ed25519Key} user@host`),
    ).toBeUndefined();
    expect(
      parseOpenSshPublicKey(`ssh-ed25519 ${ed25519Key} ${rsaKey}`),
    ).toBeUndefined();
  });

  it("rejects unknown algorithms and missing fields", () => {
    expect(parseOpenSshPublicKey(`ssh-dss ${ed25519Key}`)).toBeUndefined();
    expect(
      parseOpenSshPublicKey(`ssh-ed25519-only ${ed25519Key}`),
    ).toBeUndefined();
    expect(parseOpenSshPublicKey("ssh-ed25519")).toBeUndefined();
    expect(parseOpenSshPublicKey("")).toBeUndefined();
    expect(parseOpenSshPublicKey("   ")).toBeUndefined();
  });

  it("rejects key material that is not canonical base64", () => {
    expect(parseOpenSshPublicKey("ssh-ed25519 !!!")).toBeUndefined();
    expect(parseOpenSshPublicKey("ssh-ed25519 ====")).toBeUndefined();
    expect(parseOpenSshPublicKey("ssh-ed25519 A")).toBeUndefined();
    expect(
      parseOpenSshPublicKey(`ssh-ed25519 ${ed25519Key}====`),
    ).toBeUndefined();
  });
});
