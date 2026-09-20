import { describe, expect, it } from "vitest";

import { parseOpenSshPublicKey } from "./host-public-key.js";

const ed25519Key =
  "AAAAC3NzaC1lZDI1NTE5AAAAIOao6uNz5lhhBfl2cKSrUoykrQ3xbIHx9rzUugYiHiDn";
const ecdsaKey =
  "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBPZjvU7j/jh/WCI/i2Z+LNjq7PccmAnqUM+0LDF0U3xAASOhBPi7vWR2V+vJNZtH81MpfYBk3p7VkTA0BzAqn6U=";

describe("parseOpenSshPublicKey", () => {
  it("parses allowlisted algorithms from an authorized_keys line", () => {
    expect(parseOpenSshPublicKey(`ssh-ed25519 ${ed25519Key}`)).toEqual({
      algorithm: "ssh-ed25519",
      key: ed25519Key,
    });
    expect(parseOpenSshPublicKey(`ecdsa-sha2-nistp256 ${ecdsaKey}`)).toEqual({
      algorithm: "ecdsa-sha2-nistp256",
      key: ecdsaKey,
    });
    expect(parseOpenSshPublicKey(`rsa-sha2-512 ${ed25519Key}`)).toEqual({
      algorithm: "rsa-sha2-512",
      key: ed25519Key,
    });
  });

  it("tolerates surrounding whitespace and repeated separators", () => {
    expect(
      parseOpenSshPublicKey(`  ssh-ed25519   ${ed25519Key}  `),
    ).toEqual({ algorithm: "ssh-ed25519", key: ed25519Key });
  });

  it("rejects trailing comment fields", () => {
    expect(
      parseOpenSshPublicKey(`ssh-ed25519 ${ed25519Key} host@example`),
    ).toBeUndefined();
  });

  it("rejects algorithms outside the allowlist", () => {
    expect(parseOpenSshPublicKey(`ssh-dss ${ed25519Key}`)).toBeUndefined();
    expect(
      parseOpenSshPublicKey(`ssh-ed25519x ${ed25519Key}`),
    ).toBeUndefined();
  });

  it("rejects malformed or missing key material", () => {
    expect(parseOpenSshPublicKey("ssh-ed25519 !!!")).toBeUndefined();
    expect(parseOpenSshPublicKey("ssh-ed25519 A===B")).toBeUndefined();
    expect(parseOpenSshPublicKey("ssh-ed25519")).toBeUndefined();
    expect(parseOpenSshPublicKey("")).toBeUndefined();
    expect(parseOpenSshPublicKey("   ")).toBeUndefined();
  });
});
