import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { exportWellKnownTree, wrapGzip } from "@skills-desktop/skills-runtime";
import { describe, expect, it } from "vitest";

import { createNodeWellKnownCodec } from "./node-well-known-codec.js";

const text = (value: string) => new TextEncoder().encode(value);

describe("node well-known codec", () => {
  it("hashes with SHA-256 and produces gunzip-compatible raw deflate", () => {
    const codec = createNodeWellKnownCodec();
    const payload = text("hello well-known");
    expect(codec.sha256Hex(payload)).toBe(
      createHash("sha256").update(payload).digest("hex"),
    );
    const framed = wrapGzip(payload, codec.deflateRaw(payload));
    expect(new Uint8Array(gunzipSync(framed))).toEqual(payload);
    expect(codec.deflateRaw(payload)).toEqual(codec.deflateRaw(payload));
  });

  it("drives a full export deterministically", () => {
    const codec = createNodeWellKnownCodec();
    const skill = {
      files: [
        { bytes: text("---\nname: demo\ndescription: Demo.\n---\n"), path: "SKILL.md" },
        { bytes: text("data"), path: "assets/data.txt" },
      ],
      name: "demo",
    };
    const first = exportWellKnownTree([skill], codec);
    const second = exportWellKnownTree([skill], codec);
    expect(first.ok && second.ok && first.value.treeDigest === second.value.treeDigest).toBe(
      true,
    );
  });
});
