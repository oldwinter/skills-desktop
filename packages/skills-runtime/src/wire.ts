import { z } from "zod";

import type { PublicError, Result } from "./result.js";

export const WIRE_PROTOCOL_VERSION = 2 as const;
export const MAX_WIRE_FRAME_BYTES = 16 * 1024 * 1024 + 64 * 1024;
export const MAX_WIRE_INVENTORY_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_WIRE_REQUEST_BYTES = 64 * 1024;
export const MAX_WIRE_HARNESS_LENGTH = 128;
export const MAX_WIRE_REQUEST_ID_LENGTH = 256;
export const MAX_WIRE_WORKSPACE_LENGTH = 4_096;

export interface WireObservationRequest {
  readonly harness: string;
  readonly operation: "observe";
  readonly protocolVersion: typeof WIRE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: "request";
  readonly workspace: string;
}

export type WireMutation =
  | {
      readonly names: readonly string[];
      readonly scope: "global" | "project";
      readonly source: {
        readonly source: string;
        readonly sourceType: "github";
      };
      readonly type: "add";
    }
  | {
      readonly names: readonly string[];
      readonly scope: "global" | "project";
      readonly type: "remove" | "update";
    };

export interface WireMutationRequest {
  readonly harness: string;
  readonly mutation: WireMutation;
  readonly operation: "mutate";
  readonly protocolVersion: typeof WIRE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: "request";
  readonly workspace: string;
}

export interface WireCancellationRequest {
  readonly operation: "cancel";
  readonly protocolVersion: typeof WIRE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: "request";
}

export type WireRequest =
  WireCancellationRequest | WireMutationRequest | WireObservationRequest;

export function validateWireObservationRequest(
  value: unknown,
  protocolVersion: number,
  maxHarnessLength: number,
  maxRequestIdLength: number,
  maxWorkspaceLength: number,
): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 6 ||
    keys[0] !== "harness" ||
    keys[1] !== "operation" ||
    keys[2] !== "protocolVersion" ||
    keys[3] !== "requestId" ||
    keys[4] !== "type" ||
    keys[5] !== "workspace"
  ) {
    return false;
  }
  const request = value as Record<string, unknown>;
  if (
    request.type !== "request" ||
    request.operation !== "observe" ||
    request.protocolVersion !== protocolVersion ||
    typeof request.harness !== "string" ||
    request.harness.length === 0 ||
    request.harness.length > maxHarnessLength ||
    typeof request.requestId !== "string" ||
    request.requestId.length === 0 ||
    request.requestId.length > maxRequestIdLength ||
    typeof request.workspace !== "string" ||
    request.workspace.length === 0 ||
    request.workspace.length > maxWorkspaceLength ||
    request.workspace.includes("\0") ||
    !request.workspace.startsWith("/")
  ) {
    return false;
  }
  if (request.workspace === "/") return true;
  const segments = request.workspace.slice(1).split("/");
  return !segments.some(
    (segment, index) =>
      segment === "." ||
      segment === ".." ||
      (segment === "" && index !== segments.length - 1),
  );
}

export function isWireObservationRequest(
  value: unknown,
): value is WireObservationRequest {
  return validateWireObservationRequest(
    value,
    WIRE_PROTOCOL_VERSION,
    MAX_WIRE_HARNESS_LENGTH,
    MAX_WIRE_REQUEST_ID_LENGTH,
    MAX_WIRE_WORKSPACE_LENGTH,
  );
}

export function validateWireRequest(
  value: unknown,
  protocolVersion: number,
  maxHarnessLength: number,
  maxRequestIdLength: number,
  maxWorkspaceLength: number,
): boolean {
  const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate);
  const exactKeys = (
    candidate: Record<string, unknown>,
    expected: string[],
  ) => {
    const keys = Object.keys(candidate).sort();
    const sortedExpected = [...expected].sort();
    return (
      keys.length === sortedExpected.length &&
      keys.every((key, index) => key === sortedExpected[index])
    );
  };
  const boundedIdentifier = (candidate: unknown) =>
    typeof candidate === "string" &&
    candidate.length > 0 &&
    candidate.length <= maxRequestIdLength;
  const canonicalWorkspace = (candidate: unknown) => {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.length > maxWorkspaceLength ||
      candidate.includes("\0") ||
      !candidate.startsWith("/")
    ) {
      return false;
    }
    if (candidate === "/") return true;
    const segments = candidate.slice(1).split("/");
    return !segments.some(
      (segment, index) =>
        segment === "." ||
        segment === ".." ||
        (segment === "" && index !== segments.length - 1),
    );
  };
  const skillName = (candidate: unknown) =>
    typeof candidate === "string" &&
    candidate.length > 0 &&
    candidate.length <= 256 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate);
  const names = (candidate: unknown) =>
    Array.isArray(candidate) &&
    candidate.length > 0 &&
    candidate.length <= 128 &&
    candidate.every(skillName) &&
    new Set(candidate).size === candidate.length &&
    candidate.reduce(
      (size, name) => size + (typeof name === "string" ? name.length : 0),
      0,
    ) <= 8_192;
  const githubSource = (candidate: unknown) => {
    if (
      !isRecord(candidate) ||
      !exactKeys(candidate, ["source", "sourceType"])
    ) {
      return false;
    }
    return (
      candidate.sourceType === "github" &&
      typeof candidate.source === "string" &&
      candidate.source.length >= 3 &&
      candidate.source.length <= 256 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/.test(
        candidate.source,
      )
    );
  };
  const mutation = (candidate: unknown) => {
    if (!isRecord(candidate)) return false;
    if (
      candidate.type !== "add" &&
      candidate.type !== "remove" &&
      candidate.type !== "update"
    ) {
      return false;
    }
    const expectedKeys =
      candidate.type === "add"
        ? ["names", "scope", "source", "type"]
        : ["names", "scope", "type"];
    return (
      exactKeys(candidate, expectedKeys) &&
      names(candidate.names) &&
      (candidate.scope === "global" || candidate.scope === "project") &&
      (candidate.type !== "add" || githubSource(candidate.source))
    );
  };

  if (!isRecord(value) || value.type !== "request") return false;
  if (
    value.protocolVersion !== protocolVersion ||
    !boundedIdentifier(value.requestId)
  ) {
    return false;
  }
  if (value.operation === "cancel") {
    return exactKeys(value, [
      "operation",
      "protocolVersion",
      "requestId",
      "type",
    ]);
  }
  const commonRequestValid =
    typeof value.harness === "string" &&
    value.harness.length > 0 &&
    value.harness.length <= maxHarnessLength &&
    canonicalWorkspace(value.workspace);
  if (value.operation === "observe") {
    return (
      commonRequestValid &&
      exactKeys(value, [
        "harness",
        "operation",
        "protocolVersion",
        "requestId",
        "type",
        "workspace",
      ])
    );
  }
  return (
    value.operation === "mutate" &&
    commonRequestValid &&
    mutation(value.mutation) &&
    exactKeys(value, [
      "harness",
      "mutation",
      "operation",
      "protocolVersion",
      "requestId",
      "type",
      "workspace",
    ])
  );
}

export function isWireRequest(value: unknown): value is WireRequest {
  return validateWireRequest(
    value,
    WIRE_PROTOCOL_VERSION,
    MAX_WIRE_HARNESS_LENGTH,
    MAX_WIRE_REQUEST_ID_LENGTH,
    MAX_WIRE_WORKSPACE_LENGTH,
  );
}

export function encodeWireFramePayload(
  value: unknown,
  maxFrameBytes: number,
): Uint8Array {
  const bytes: number[] = [];
  for (const character of JSON.stringify(value)) {
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
  const payload = Uint8Array.from(bytes);
  if (payload.byteLength > maxFrameBytes) {
    throw new RangeError("Wire frame exceeds its byte limit.");
  }
  const framed = new Uint8Array(payload.byteLength + 4);
  new DataView(framed.buffer).setUint32(0, payload.byteLength, false);
  framed.set(payload, 4);
  return framed;
}

export function decodeSingleWireFramePayload(
  input: Uint8Array,
  maxPayloadBytes: number,
): Uint8Array | undefined {
  if (input.byteLength < 4) return undefined;
  const length = new DataView(input.buffer, input.byteOffset, 4).getUint32(
    0,
    false,
  );
  if (length > maxPayloadBytes || input.byteLength !== length + 4) {
    return undefined;
  }
  return input.subarray(4);
}

export const WIRE_OBSERVATION_REQUEST_VALIDATOR_SOURCE =
  validateWireObservationRequest.toString();
export const WIRE_REQUEST_VALIDATOR_SOURCE = validateWireRequest.toString();
export const WIRE_FRAME_ENCODER_SOURCE = encodeWireFramePayload.toString();
export const WIRE_SINGLE_FRAME_DECODER_SOURCE =
  decodeSingleWireFramePayload.toString();

const boundedIdentifier = z.string().min(1).max(MAX_WIRE_REQUEST_ID_LENGTH);
const baseFrame = {
  protocolVersion: z.literal(WIRE_PROTOCOL_VERSION),
} as const;

export const wireFrameSchema = z.union([
  z
    .object({
      bootstrapDigest: z.string().regex(/^[a-f0-9]{64}$/),
      ...baseFrame,
      type: z.literal("hello"),
    })
    .strict(),
  z.custom<WireRequest>(isWireRequest),
  z
    .object({
      cliVersion: z.literal("1.5.23"),
      globalJson: z.string().max(MAX_WIRE_INVENTORY_JSON_BYTES),
      ...baseFrame,
      projectJson: z.string().max(MAX_WIRE_INVENTORY_JSON_BYTES),
      requestId: boundedIdentifier,
      type: z.literal("inventory"),
    })
    .strict(),
  z
    .object({
      cliVersion: z.literal("1.5.23"),
      globalJson: z.string().max(MAX_WIRE_INVENTORY_JSON_BYTES),
      process: z
        .object({
          cleanup: z.literal("confirmed"),
          disposition: z.enum([
            "cancelled",
            "completed",
            "failed",
            "timed-out",
          ]),
          exitCode: z.number().int().nullable(),
        })
        .strict(),
      ...baseFrame,
      projectJson: z.string().max(MAX_WIRE_INVENTORY_JSON_BYTES),
      requestId: boundedIdentifier,
      type: z.literal("mutation-result"),
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
      phase: z.enum(["mutation", "observe", "postflight", "version", "wire"]),
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

function decodeUtf8(input: Uint8Array): string {
  const chunks: string[] = [];
  const codePoints: number[] = [];
  const flush = () => {
    if (codePoints.length > 0) {
      chunks.push(String.fromCodePoint(...codePoints));
      codePoints.length = 0;
    }
  };
  for (let index = 0; index < input.length;) {
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
  return encodeWireFramePayload(parsed, MAX_WIRE_FRAME_BYTES);
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
      return wireFailure(
        "frame_too_large",
        "Wire frame exceeds its byte limit.",
      );
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
      return wireFailure(
        "invalid_frame",
        "Wire frame is not valid UTF-8 JSON.",
      );
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
