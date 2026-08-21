import { z } from "zod";

import type { PublicError, Result } from "./result.js";

export const WIRE_PROTOCOL_VERSION = 1 as const;
export const MAX_WIRE_FRAME_BYTES = 16 * 1024 * 1024 + 64 * 1024;

const boundedIdentifier = z.string().min(1).max(256);
const baseFrame = {
  protocolVersion: z.literal(WIRE_PROTOCOL_VERSION),
} as const;

export const wireFrameSchema = z.discriminatedUnion("type", [
  z
    .object({
      bootstrapDigest: z.string().regex(/^[a-f0-9]{64}$/),
      ...baseFrame,
      type: z.literal("hello"),
    })
    .strict(),
  z
    .object({
      harness: z.string().min(1).max(128),
      operation: z.literal("observe"),
      ...baseFrame,
      requestId: boundedIdentifier,
      type: z.literal("request"),
      workspace: z.string().min(1).max(4_096),
    })
    .strict(),
  z
    .object({
      cliVersion: z.literal("1.5.23"),
      globalJson: z.string().max(8 * 1024 * 1024),
      ...baseFrame,
      projectJson: z.string().max(8 * 1024 * 1024),
      requestId: boundedIdentifier,
      type: z.literal("inventory"),
    })
    .strict(),
  z
    .object({
      code: z.enum([
        "output_limit_exceeded",
        "remote_operation_failed",
        "remote_protocol_violation",
        "remote_runtime_unavailable",
      ]),
      message: z.string().min(1).max(512),
      ...baseFrame,
      requestId: boundedIdentifier.nullable(),
      type: z.literal("failure"),
    })
    .strict(),
]);

export type WireFrame = z.infer<typeof wireFrameSchema>;
export type WireProtocolError = PublicError<
  "frame_too_large" | "incomplete_frame" | "invalid_frame"
>;

function wireFailure(
  code: WireProtocolError["code"],
  message: string,
): Result<never, WireProtocolError> {
  return {
    error: {
      code,
      effects: "none",
      message,
      phase: "wire",
      retryable: false,
    },
    ok: false,
  };
}

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function decodeUtf8(input: Uint8Array): string {
  const chunks: string[] = [];
  const codePoints: number[] = [];
  const flush = () => {
    if (codePoints.length > 0) {
      chunks.push(String.fromCodePoint(...codePoints));
      codePoints.length = 0;
    }
  };
  for (let index = 0; index < input.length; ) {
    const first = input[index]!;
    let codePoint: number;
    let width: number;
    let minimum: number;
    if (first <= 0x7f) {
      codePoint = first;
      width = 1;
      minimum = 0;
    } else if (first >= 0xc2 && first <= 0xdf) {
      codePoint = first & 0x1f;
      width = 2;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint = first & 0x0f;
      width = 3;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint = first & 0x07;
      width = 4;
      minimum = 0x10000;
    } else {
      throw new TypeError("Invalid UTF-8 lead byte.");
    }
    if (index + width > input.length) throw new TypeError("Truncated UTF-8.");
    for (let offset = 1; offset < width; offset += 1) {
      const continuation = input[index + offset]!;
      if ((continuation & 0xc0) !== 0x80) {
        throw new TypeError("Invalid UTF-8 continuation byte.");
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    if (
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      throw new TypeError("Invalid UTF-8 code point.");
    }
    codePoints.push(codePoint);
    if (codePoints.length === 4_096) flush();
    index += width;
  }
  flush();
  return chunks.join("");
}

export function encodeWireFrame(frame: WireFrame): Uint8Array {
  const parsed = wireFrameSchema.parse(frame);
  const payload = encodeUtf8(JSON.stringify(parsed));
  if (payload.byteLength > MAX_WIRE_FRAME_BYTES) {
    throw new RangeError("Wire frame exceeds its byte limit.");
  }
  const framed = new Uint8Array(payload.byteLength + 4);
  new DataView(framed.buffer).setUint32(0, payload.byteLength, false);
  framed.set(payload, 4);
  return framed;
}

export function decodeWireFrames(
  input: Uint8Array,
): Result<readonly WireFrame[], WireProtocolError> {
  const frames: WireFrame[] = [];
  let offset = 0;
  while (offset < input.byteLength) {
    if (input.byteLength - offset < 4) {
      return wireFailure(
        "incomplete_frame",
        "Wire input ended before a complete frame header.",
      );
    }
    const length = new DataView(
      input.buffer,
      input.byteOffset + offset,
      4,
    ).getUint32(0, false);
    if (length > MAX_WIRE_FRAME_BYTES) {
      return wireFailure("frame_too_large", "Wire frame exceeds its byte limit.");
    }
    if (input.byteLength - offset - 4 < length) {
      return wireFailure(
        "incomplete_frame",
        "Wire input ended before a complete frame payload.",
      );
    }
    let decoded: unknown;
    try {
      const payload = input.subarray(offset + 4, offset + 4 + length);
      decoded = JSON.parse(decodeUtf8(payload));
    } catch {
      return wireFailure("invalid_frame", "Wire frame is not valid UTF-8 JSON.");
    }
    const parsed = wireFrameSchema.safeParse(decoded);
    if (!parsed.success) {
      return wireFailure(
        "invalid_frame",
        "Wire frame does not match the supported protocol.",
      );
    }
    frames.push(parsed.data);
    offset += 4 + length;
  }
  return { ok: true, value: frames };
}
