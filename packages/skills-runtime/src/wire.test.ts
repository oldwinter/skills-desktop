import { describe, expect, it } from "vitest";

import {
  decodeSingleWireFramePayload,
  decodeWireFrames,
  encodeWireFrame,
  encodeWireFramePayload,
  isWireObservationRequest,
  isWireRequest,
  MAX_WIRE_FRAME_BYTES,
  MAX_WIRE_HARNESS_LENGTH,
  MAX_WIRE_REQUEST_ID_LENGTH,
  MAX_WIRE_WORKSPACE_LENGTH,
  validateWireObservationRequest,
  validateWireRequest,
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

  it("round-trips one pinned GitHub add as structured mutation data", () => {
    const request = {
      harness: "Codex",
      mutation: {
        names: ["find-skills"],
        scope: "project" as const,
        source: {
          revision: "0123456789abcdef0123456789abcdef01234567",
          source: "vercel-labs/skills",
          sourceType: "github" as const,
        },
        type: "add" as const,
      },
      operation: "mutate" as const,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "mutation-pinned-add",
      type: "request" as const,
      workspace: "/srv/workspace",
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

describe("Wire request validators", () => {
  const observe = {
    harness: "Codex",
    operation: "observe" as const,
    protocolVersion: WIRE_PROTOCOL_VERSION,
    requestId: "observe-1",
    type: "request" as const,
    workspace: "/srv/workspace",
  };

  it("accepts root and rejects traversal or empty segments in observation workspaces", () => {
    expect(isWireObservationRequest({ ...observe, workspace: "/" })).toBe(true);
    expect(
      validateWireObservationRequest(
        { ...observe, workspace: "/srv/./workspace" },
        WIRE_PROTOCOL_VERSION,
        MAX_WIRE_HARNESS_LENGTH,
        MAX_WIRE_REQUEST_ID_LENGTH,
        MAX_WIRE_WORKSPACE_LENGTH,
      ),
    ).toBe(false);
    expect(
      validateWireObservationRequest(
        { ...observe, workspace: "/srv/../workspace" },
        WIRE_PROTOCOL_VERSION,
        MAX_WIRE_HARNESS_LENGTH,
        MAX_WIRE_REQUEST_ID_LENGTH,
        MAX_WIRE_WORKSPACE_LENGTH,
      ),
    ).toBe(false);
    expect(
      validateWireObservationRequest(
        { ...observe, workspace: "/srv//workspace" },
        WIRE_PROTOCOL_VERSION,
        MAX_WIRE_HARNESS_LENGTH,
        MAX_WIRE_REQUEST_ID_LENGTH,
        MAX_WIRE_WORKSPACE_LENGTH,
      ),
    ).toBe(false);
    expect(isWireObservationRequest(null)).toBe(false);
    expect(isWireObservationRequest([])).toBe(false);
    expect(isWireObservationRequest({ ...observe, extra: true })).toBe(false);
    expect(isWireObservationRequest({ ...observe, harness: "" })).toBe(false);
    expect(
      isWireObservationRequest({
        ...observe,
        harness: "x".repeat(MAX_WIRE_HARNESS_LENGTH + 1),
      }),
    ).toBe(false);
    expect(isWireObservationRequest({ ...observe, requestId: "" })).toBe(false);
    expect(isWireObservationRequest({ ...observe, workspace: "" })).toBe(false);
    expect(
      isWireObservationRequest({ ...observe, protocolVersion: 1 }),
    ).toBe(false);
  });

  it("validates cancel, observe, and mutate request shapes", () => {
    expect(
      isWireRequest({
        operation: "cancel",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "cancel-1",
        type: "request",
      }),
    ).toBe(true);
    expect(isWireRequest(observe)).toBe(true);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: {
          names: ["find-skills"],
          scope: "project",
          source: { source: "vercel-labs/skills", sourceType: "github" },
          type: "add",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-add",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(true);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: {
          names: ["find-skills"],
          scope: "global",
          type: "update",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-update",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(true);

    expect(isWireRequest({ type: "request" })).toBe(false);
    expect(
      validateWireRequest(
        { ...observe, protocolVersion: 99 },
        WIRE_PROTOCOL_VERSION,
        MAX_WIRE_HARNESS_LENGTH,
        MAX_WIRE_REQUEST_ID_LENGTH,
        MAX_WIRE_WORKSPACE_LENGTH,
      ),
    ).toBe(false);
    expect(
      isWireRequest({
        operation: "cancel",
        payload: "nope",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "cancel-1",
        type: "request",
      }),
    ).toBe(false);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: {
          names: ["bad name"],
          scope: "project",
          type: "remove",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-bad-name",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(false);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: {
          names: ["find-skills", "find-skills"],
          scope: "project",
          type: "remove",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-dup",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(false);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: {
          names: ["find-skills"],
          scope: "project",
          source: {
            revision: "not-a-sha",
            source: "vercel-labs/skills",
            sourceType: "github",
          },
          type: "add",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-bad-rev",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(false);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: {
          names: ["find-skills"],
          scope: "project",
          source: { source: "../evil", sourceType: "github" },
          type: "add",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-bad-source",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(false);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: { names: [], scope: "project", type: "remove" },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-empty",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(false);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: {
          names: ["find-skills"],
          scope: "other",
          type: "remove",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-scope",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(false);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: {
          names: ["find-skills"],
          scope: "project",
          type: "remove",
        },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-1",
        type: "request",
        workspace: "relative/path",
      }),
    ).toBe(false);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: { type: "add" },
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-1",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(false);
    expect(
      isWireRequest({
        harness: "Codex",
        mutation: null,
        operation: "mutate",
        protocolVersion: WIRE_PROTOCOL_VERSION,
        requestId: "mutation-1",
        type: "request",
        workspace: "/srv/workspace",
      }),
    ).toBe(false);
  });

  it("encodes multi-byte JSON and rejects oversized frames", () => {
    const request = {
      harness: "Codex 技能 🙂",
      operation: "observe" as const,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "observe-multi-byte",
      type: "request" as const,
      workspace: "/srv/技能/🙂",
    };
    const framed = encodeWireFramePayload(request, 1024);
    expect(framed.byteLength).toBeGreaterThan(4);
    expect(decodeSingleWireFramePayload(framed, 1024)).toBeDefined();
    expect(decodeWireFrames(framed)).toEqual({ ok: true, value: [request] });
    expect(decodeSingleWireFramePayload(new Uint8Array([0, 0]), 1024)).toBe(
      undefined,
    );
    expect(
      decodeSingleWireFramePayload(new Uint8Array([0, 0, 0, 2, 1]), 1024),
    ).toBe(undefined);
    expect(
      decodeSingleWireFramePayload(new Uint8Array([0, 0, 0, 5, 1, 2, 3, 4, 5]), 4),
    ).toBe(undefined);
    expect(() =>
      encodeWireFramePayload({ huge: "x".repeat(100) }, 16),
    ).toThrow(/Wire frame exceeds/);
  });

  it("decodes multi-frame streams and rejects truncated UTF-8 continuations", () => {
    const hello = encodeWireFrame({
      bootstrapDigest: "a".repeat(64),
      protocolVersion: WIRE_PROTOCOL_VERSION,
      type: "hello",
    });
    const inventory = encodeWireFrame({
      cliVersion: "1.5.23",
      globalJson: "[]",
      projectJson: "[]",
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: "observe-1",
      type: "inventory",
    });
    const joined = new Uint8Array(hello.length + inventory.length);
    joined.set(hello);
    joined.set(inventory, hello.length);
    expect(decodeWireFrames(joined)).toMatchObject({
      ok: true,
      value: [{ type: "hello" }, { type: "inventory" }],
    });

    const truncatedHeader = new Uint8Array([0, 0, 1]);
    expect(decodeWireFrames(truncatedHeader)).toMatchObject({
      error: { code: "incomplete_frame" },
      ok: false,
    });

    const badContinuation = new Uint8Array([0, 0, 0, 2, 0xc2, 0x20]);
    expect(decodeWireFrames(badContinuation)).toMatchObject({
      error: { code: "invalid_frame" },
      ok: false,
    });
    const overlong = new Uint8Array([0, 0, 0, 2, 0xc0, 0x80]);
    expect(decodeWireFrames(overlong)).toMatchObject({
      error: { code: "invalid_frame" },
      ok: false,
    });
    const truncatedMulti = new Uint8Array([0, 0, 0, 1, 0xe0]);
    expect(decodeWireFrames(truncatedMulti)).toMatchObject({
      error: { code: "invalid_frame" },
      ok: false,
    });
  });
});
