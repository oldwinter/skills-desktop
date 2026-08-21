import { describe, expect, it } from "vitest";

import {
  decodeWireFrames,
  encodeWireFrame,
  WIRE_PROTOCOL_VERSION,
} from "./wire.js";

describe("Remote Bootstrap Wire Protocol", () => {
  it("round-trips one closed observation request through a length-prefixed frame", () => {
    const request = {
      harness: "Codex",
      operation: "observe" as const,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "observe-1",
      type: "request" as const,
      workspace: "/srv/workspace; printf unsafe",
    };

    expect(decodeWireFrames(encodeWireFrame(request))).toEqual({
      ok: true,
      value: [request],
    });
  });

  it("accepts a canonical POSIX directory with a trailing separator", () => {
    const request = {
      harness: "Codex",
      operation: "observe" as const,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "observe-trailing-separator",
      type: "request" as const,
      workspace: "/srv/workspace/",
    };

    expect(decodeWireFrames(encodeWireFrame(request))).toEqual({
      ok: true,
      value: [request],
    });
  });

  it("round-trips one closed normalized mutation without generic arguments", () => {
    const request = {
      harness: "Codex",
      mutation: {
        names: ["project-skill"],
        scope: "project" as const,
        type: "remove" as const,
      },
      operation: "mutate" as const,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "mutation-1",
      type: "request" as const,
      workspace: "/srv/workspace; printf unsafe",
    };

    expect(decodeWireFrames(encodeWireFrame(request))).toEqual({
      ok: true,
      value: [request],
    });
  });

  it("round-trips a request-id-bound cancellation", () => {
    const request = {
      operation: "cancel" as const,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "mutation-1",
      type: "request" as const,
    };

    expect(decodeWireFrames(encodeWireFrame(request))).toEqual({
      ok: true,
      value: [request],
    });
  });

  it("round-trips a terminal mutation result with cleanup proof and atomic postflight", () => {
    const result = {
      cliVersion: "1.5.23" as const,
      globalJson: "[]",
      process: {
        cleanup: "confirmed" as const,
        disposition: "cancelled" as const,
        exitCode: null,
      },
      projectJson: "[]",
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "mutation-1",
      type: "mutation-result" as const,
    };

    expect(decodeWireFrames(encodeWireFrame(result))).toEqual({
      ok: true,
      value: [result],
    });
  });

  it.each([
    {
      harness: "Codex",
      mutation: { scope: "project", type: "update-all" },
      operation: "mutate",
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "mutation-1",
      type: "request",
      workspace: "/srv/workspace",
    },
    {
      args: ["remove", "project-skill", "--yes"],
      harness: "Codex",
      mutation: {
        names: ["project-skill"],
        scope: "project",
        type: "remove",
      },
      operation: "mutate",
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "mutation-1",
      type: "request",
      workspace: "/srv/workspace",
    },
    {
      operation: "cancel",
      payload: "renderer-data",
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "mutation-1",
      type: "request",
    },
  ])("rejects unsupported mutation authority %#", (request) => {
    expect(() => encodeWireFrame(request as never)).toThrow();
  });

  it.each([
    {
      bytes: new Uint8Array([0, 0, 0, 10, 123]),
      code: "incomplete_frame",
      name: "truncated payload",
    },
    {
      bytes: new Uint8Array([0, 0, 0, 1, 0xff]),
      code: "invalid_frame",
      name: "invalid UTF-8",
    },
    {
      bytes: new Uint8Array([0, 0, 0, 2, 123, 125]),
      code: "invalid_frame",
      name: "unknown frame shape",
    },
    {
      bytes: new Uint8Array([0x7f, 0xff, 0xff, 0xff]),
      code: "frame_too_large",
      name: "oversized length",
    },
  ])("rejects $name", ({ bytes, code }) => {
    expect(decodeWireFrames(bytes)).toMatchObject({
      error: { code },
      ok: false,
    });
  });

  it("rejects protocol contamination between otherwise valid frames", () => {
    const hello = encodeWireFrame({
      bootstrapDigest: "a".repeat(64),
      protocolVersion: WIRE_PROTOCOL_VERSION,
      type: "hello",
    });
    const contaminated = new Uint8Array(hello.length + 1);
    contaminated.set(hello);
    contaminated[hello.length] = 0x0a;

    expect(decodeWireFrames(contaminated)).toMatchObject({
      error: { code: "incomplete_frame" },
      ok: false,
    });
  });

  it.each(["relative/workspace", "/srv/workspace\0suffix"])(
    "rejects a non-canonical POSIX observation workspace %j",
    (workspace) => {
      expect(() =>
        encodeWireFrame({
          harness: "Codex",
          operation: "observe",
          protocolVersion: WIRE_PROTOCOL_VERSION,
          requestId: "observe-1",
          type: "request",
          workspace,
        }),
      ).toThrow();
    },
  );

  it("refuses to encode an unbounded structured error", () => {
    expect(() =>
      encodeWireFrame({
        code: "remote_operation_failed",
        message: "x".repeat(513),
        phase: "observe",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "observe-1",
        type: "failure",
      }),
    ).toThrow();
  });
});
