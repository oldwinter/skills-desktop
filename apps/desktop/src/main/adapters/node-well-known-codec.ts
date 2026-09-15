import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import type { WellKnownCodec } from "@skills-desktop/skills-runtime";

/**
 * Node primitives for the runtime-neutral well-known exporter. Level 9 raw
 * deflate keeps the compressed bytes stable for identical input on the same
 * zlib build; the gzip header and trailer are fixed by the runtime.
 */
export function createNodeWellKnownCodec(): WellKnownCodec {
  return {
    deflateRaw(bytes) {
      return new Uint8Array(deflateRawSync(bytes, { level: 9 }));
    },
    sha256Hex(bytes) {
      return createHash("sha256").update(bytes).digest("hex");
    },
  };
}
