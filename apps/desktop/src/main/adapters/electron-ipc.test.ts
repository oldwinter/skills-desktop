import { describe, expect, it, vi } from "vitest";

import { buildApplicationMenu } from "../application/application-menu.js";
import { isAuthorizedSender, registerDesktopIpc } from "./electron-ipc.js";

describe("Electron IPC sender authorization", () => {
  const endpoint = {
    expectedUrl: "skills-desktop://workspace/index.html",
    role: "workspace" as const,
    webContentsId: 17,
  };
  const sender = {
    frameUrl: "skills-desktop://workspace/index.html",
    isMainFrame: true,
    role: "workspace" as const,
    webContentsId: 17,
  };

  it("accepts only the registered main frame at its exact role URL", () => {
    expect(isAuthorizedSender(endpoint, sender)).toBe(true);
    expect(isAuthorizedSender(endpoint, { ...sender, webContentsId: 18 })).toBe(
      false,
    );
    expect(isAuthorizedSender(endpoint, { ...sender, role: "review" })).toBe(
      false,
    );
    expect(
      isAuthorizedSender(endpoint, { ...sender, isMainFrame: false }),
    ).toBe(false);
    expect(
      isAuthorizedSender(endpoint, {
        ...sender,
        frameUrl: "skills-desktop://workspace/index.html?unexpected=true",
      }),
    ).toBe(false);
  });

  it("notifies only the exact live workspace that owned the review", () => {
    const session = {
      request: vi.fn(),
      snapshot: vi.fn(),
      teardown: vi.fn(),
    };
    const ipcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    };
    const capabilities = {
      attach: vi.fn(() => session),
    };
    let nextEpoch = 1;
    const registration = registerDesktopIpc({
      capabilities: capabilities as never,
      ipcMain: ipcMain as never,
      newEpoch: vi.fn(() => `epoch-${nextEpoch++}`),
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const firstWorkspace = {
      id: 17,
      isDestroyed: vi.fn(() => false),
      mainFrame: { url: "skills-desktop://workspace/index.html" },
      send: vi.fn(),
    };
    const secondWorkspace = {
      id: 19,
      isDestroyed: vi.fn(() => false),
      mainFrame: { url: "skills-desktop://workspace/index.html" },
      send: vi.fn(),
    };
    const review = {
      id: 21,
      isDestroyed: vi.fn(() => false),
      mainFrame: { url: "skills-desktop://review/index.html" },
      send: vi.fn(),
    };
    const firstAttachment = registration.attach(
      firstWorkspace as never,
      "workspace",
      firstWorkspace.mainFrame.url,
    );
    const secondAttachment = registration.attach(
      secondWorkspace as never,
      "workspace",
      secondWorkspace.mainFrame.url,
    );
    const reviewAttachment = registration.attach(
      review as never,
      "review",
      review.mainFrame.url,
      "review-1",
    );
    firstWorkspace.send.mockClear();
    secondWorkspace.send.mockClear();
    review.send.mockClear();

    expect(firstAttachment).toBeDefined();
    expect(secondAttachment).toBeDefined();
    expect(reviewAttachment).toBeDefined();
    registration.notifyReviewWindowClosed("review-1", firstAttachment!);
    expect(firstWorkspace.send).toHaveBeenCalledWith(
      "workspace:review-window:closed",
      { reviewId: "review-1", schemaVersion: 1 },
    );
    expect(secondWorkspace.send).not.toHaveBeenCalled();
    expect(review.send).not.toHaveBeenCalled();

    firstWorkspace.send.mockClear();
    secondWorkspace.isDestroyed.mockReturnValue(true);
    registration.notifyReviewWindowClosed("review-2", secondAttachment!);
    expect(firstWorkspace.send).not.toHaveBeenCalled();
    expect(secondWorkspace.send).not.toHaveBeenCalled();

    registration.notifyReviewWindowClosed("review-2", reviewAttachment!);
    expect(review.send).not.toHaveBeenCalled();

    firstWorkspace.send.mockClear();
    registration.notifyReviewWindowClosed("", firstAttachment!);
    expect(firstWorkspace.send).not.toHaveBeenCalled();

    registration.detach(17);
    registration.notifyReviewWindowClosed("review-3", firstAttachment!);
    expect(firstWorkspace.send).not.toHaveBeenCalled();

    const replacementAttachment = registration.attach(
      firstWorkspace as never,
      "workspace",
      firstWorkspace.mainFrame.url,
    );
    expect(replacementAttachment).toBeDefined();
    firstWorkspace.send.mockClear();
    registration.notifyReviewWindowClosed("review-old", firstAttachment!);
    expect(firstWorkspace.send).not.toHaveBeenCalled();
    registration.notifyReviewWindowClosed(
      "review-current",
      replacementAttachment!,
    );
    expect(firstWorkspace.send).toHaveBeenCalledWith(
      "workspace:review-window:closed",
      { reviewId: "review-current", schemaVersion: 1 },
    );
    firstWorkspace.send.mockImplementationOnce(() => {
      throw new Error("renderer disposed");
    });
    expect(() =>
      registration.notifyReviewWindowClosed(
        "review-disposed",
        replacementAttachment!,
      ),
    ).not.toThrow();

    const destroyedWorkspace = {
      id: 23,
      isDestroyed: () => true,
      mainFrame: { url: "skills-desktop://workspace/index.html" },
      send: vi.fn(),
    };
    const teardownCount = session.teardown.mock.calls.length;
    expect(
      registration.attach(
        destroyedWorkspace as never,
        "workspace",
        destroyedWorkspace.mainFrame.url,
      ),
    ).toBeUndefined();
    expect(destroyedWorkspace.send).not.toHaveBeenCalled();
    expect(session.teardown).toHaveBeenCalledTimes(teardownCount + 1);

    const failingWorkspace = {
      id: 25,
      isDestroyed: () => false,
      mainFrame: { url: "skills-desktop://workspace/index.html" },
      send: vi.fn(() => {
        throw new Error("send failed");
      }),
    };
    expect(
      registration.attach(
        failingWorkspace as never,
        "workspace",
        failingWorkspace.mainFrame.url,
      ),
    ).toBeUndefined();
    expect(session.teardown).toHaveBeenCalledTimes(teardownCount + 2);
  });

  it("returns bounded errors for hostile frames and invalid main output", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const session = {
      request: vi.fn(async () => ({
        error: {
          code: "invalid_request" as const,
          effects: "none" as const,
          message: "The request is not supported.",
          phase: "validate",
          retryable: false,
        },
        ok: false as const,
      })),
      snapshot: vi.fn(async () => ({ rawSecret: "must-not-cross-ipc" })),
      teardown: vi.fn(),
    };
    const capabilities = {
      attach: vi.fn(() => session),
      initialize: vi.fn(async () => undefined),
    };
    const registration = registerDesktopIpc({
      capabilities: capabilities as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const mainFrame = { url: "skills-desktop://workspace/index.html" };
    const webContents = {
      id: 17,
      isDestroyed: () => false,
      mainFrame,
      send: vi.fn(),
    };
    registration.attach(webContents as never, "workspace", mainFrame.url);
    const hostileEvent = {
      sender: webContents,
      senderFrame: { url: mainFrame.url },
    };
    const authorizedEvent = { sender: webContents, senderFrame: mainFrame };

    await expect(
      handlers.get("workspace:snapshot:get")!(hostileEvent as never),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("workspace:snapshot:get")!(
        authorizedEvent as never,
        "epoch-1",
      ),
    ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
    await expect(
      handlers.get("workspace:inventory:refresh")!(
        authorizedEvent as never,
        "epoch-1",
        { executable: "sh" },
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenCalledWith({
      targetId: { executable: "sh" },
      type: "inventory.refresh",
      version: 2,
    });
    await expect(
      handlers.get("workspace:comparison:open")!(
        authorizedEvent as never,
        "epoch-1",
        "00000000-0000-4000-8000-00000000000b",
        "00000000-0000-4000-8000-00000000000c",
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      leftTargetId: "00000000-0000-4000-8000-00000000000b",
      rightTargetId: "00000000-0000-4000-8000-00000000000c",
      type: "comparison.open",
      version: 2,
    });
    await expect(
      handlers.get("workspace:host-trust:review")!(
        authorizedEvent as never,
        "epoch-1",
        "00000000-0000-4000-8000-000000000018",
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      targetId: "00000000-0000-4000-8000-000000000018",
      type: "host-trust.review",
      version: 2,
    });
    await expect(
      handlers.get("workspace:collection:prepare")!(
        authorizedEvent as never,
        "epoch-1",
        {
          collectionId: "skills-desktop-starter",
          executable: "must-not-cross-ipc",
          manifestDigest: `sha256:${"a".repeat(64)}`,
          releaseNumber: 1,
          scope: "project",
          selections: [{ mode: "add", name: "find-skills" }],
          targetId: "00000000-0000-4000-8000-000000000001",
        },
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      collectionId: "skills-desktop-starter",
      manifestDigest: `sha256:${"a".repeat(64)}`,
      releaseNumber: 1,
      scope: "project",
      selections: [{ mode: "add", name: "find-skills" }],
      targetId: "00000000-0000-4000-8000-000000000001",
      type: "collection.prepare",
      version: 2,
    });
    await expect(
      handlers.get("workspace:collection:prepare-many")!(
        authorizedEvent as never,
        "epoch-1",
        {
          collectionId: "skills-desktop-starter",
          manifestDigest: `sha256:${"a".repeat(64)}`,
          releaseNumber: 1,
          targets: [
            {
              executable: "must-not-cross-ipc",
              scope: "project",
              selections: [{ mode: "add", name: "find-skills" }],
              targetId: "00000000-0000-4000-8000-000000000001",
            },
            {
              scope: "global",
              selections: [{ mode: "reapply", name: "tdd" }],
              targetId: "00000000-0000-4000-8000-000000000002",
            },
          ],
        },
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      collectionId: "skills-desktop-starter",
      manifestDigest: `sha256:${"a".repeat(64)}`,
      releaseNumber: 1,
      targets: [
        {
          scope: "project",
          selections: [{ mode: "add", name: "find-skills" }],
          targetId: "00000000-0000-4000-8000-000000000001",
        },
        {
          scope: "global",
          selections: [{ mode: "reapply", name: "tdd" }],
          targetId: "00000000-0000-4000-8000-000000000002",
        },
      ],
      type: "collection.prepare-many",
      version: 2,
    });
    await expect(
      handlers.get("workspace:collection:review-request")!(
        authorizedEvent as never,
        "epoch-1",
        "collection-plan-1",
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      collectionPlanId: "collection-plan-1",
      type: "collection.review.request",
      version: 2,
    });
    await expect(
      handlers.get("workspace:target:create")!(
        authorizedEvent as never,
        "epoch-1",
        {
          connectionReference: "build-host",
          harness: "Codex",
          kind: "ssh",
          label: "Build host",
          workspace: "/srv/project",
        },
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      definition: {
        connectionReference: "build-host",
        harness: "Codex",
        kind: "ssh",
        label: "Build host",
        workspace: "/srv/project",
      },
      type: "target.create",
      version: 2,
    });
    await expect(
      handlers.get("workspace:target:repair")!(
        authorizedEvent as never,
        "epoch-1",
        "00000000-0000-4000-8000-000000000024",
        "claude-code",
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      harnessId: "claude-code",
      targetId: "00000000-0000-4000-8000-000000000024",
      type: "target.repair",
      version: 2,
    });
    await expect(
      handlers.get("workspace:target:repair")!(
        hostileEvent as never,
        "epoch-1",
        "00000000-0000-4000-8000-000000000024",
        "claude-code",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    // The handoff channel carries a record id only; a URL is never accepted.
    await expect(
      handlers.get("workspace:handoff:skills-sh")!(
        authorizedEvent as never,
        "epoch-1",
        "b".repeat(64),
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      recordId: "b".repeat(64),
      type: "handoff.skills-sh",
      version: 2,
    });
    await expect(
      handlers.get("workspace:handoff:skills-sh")!(
        hostileEvent as never,
        "epoch-1",
        "b".repeat(64),
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    // Preferences travel as a typed patch; the session validates the shape.
    await expect(
      handlers.get("workspace:preferences:update")!(
        authorizedEvent as never,
        "epoch-1",
        { appearance: "dark", localePreference: "zh-CN" },
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      patch: { appearance: "dark", localePreference: "zh-CN" },
      type: "preferences.update",
      version: 2,
    });
    await expect(
      handlers.get("workspace:preferences:update")!(
        hostileEvent as never,
        "epoch-1",
        { appearance: "dark" },
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    // ADR 0015: source inspection carries only the exact source text; main
    // classifies it and refuses hostile frames before any spawn.
    await expect(
      handlers.get("workspace:source:inspect")!(
        authorizedEvent as never,
        "epoch-1",
        "00000000-0000-4000-8000-000000000001",
        "vercel-labs/skills",
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      source: "vercel-labs/skills",
      targetId: "00000000-0000-4000-8000-000000000001",
      type: "source.inspect",
      version: 2,
    });
    await expect(
      handlers.get("workspace:source:inspect")!(
        hostileEvent as never,
        "epoch-1",
        "00000000-0000-4000-8000-000000000001",
        "vercel-labs/skills",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });

    const reviewMainFrame = { url: "skills-desktop://review/index.html" };
    const reviewContents = {
      id: 18,
      isDestroyed: () => false,
      mainFrame: reviewMainFrame,
      send: vi.fn(),
    };
    registration.attach(
      reviewContents as never,
      "review",
      reviewMainFrame.url,
      "review-1",
    );
    const reviewEvent = {
      sender: reviewContents,
      senderFrame: reviewMainFrame,
    };

    await expect(
      handlers.get("review:decision:approve")!(
        authorizedEvent as never,
        "epoch-1",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("workspace:mutation:prepare")!(
        reviewEvent as never,
        "epoch-1",
        "00000000-0000-4000-8000-000000000001",
        { names: ["tdd"], scope: "project", type: "remove" },
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("review:decision:reject")!(reviewEvent as never, "epoch-1"),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(session.request).toHaveBeenLastCalledWith({
      decision: "reject",
      type: "review.decide",
      version: 2,
    });
  });

  it("forwards package, publication, and studio intents as closed versioned requests", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const session = {
      request: vi.fn(async () => ({
        ok: true as const,
        value: { operationId: "operation-9" },
      })),
      snapshot: vi.fn(),
      teardown: vi.fn(),
    };
    const capabilities = {
      attach: vi.fn(() => session),
      initialize: vi.fn(async () => undefined),
    };
    const registration = registerDesktopIpc({
      capabilities: capabilities as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const mainFrame = { url: "skills-desktop://workspace/index.html" };
    const webContents = {
      id: 17,
      isDestroyed: () => false,
      mainFrame,
      send: vi.fn(),
    };
    registration.attach(webContents as never, "workspace", mainFrame.url);
    const authorizedEvent = { sender: webContents, senderFrame: mainFrame };
    const hostileEvent = {
      sender: webContents,
      senderFrame: { url: "skills-desktop://review/index.html" },
    };

    const cases: Array<{
      readonly args: readonly unknown[];
      readonly channel: string;
      readonly forwarded: Record<string, unknown>;
    }> = [
      {
        args: [],
        channel: "workspace:package:import",
        forwarded: { type: "package.import" },
      },
      {
        args: [],
        channel: "workspace:publication:choose-source",
        forwarded: { type: "publication.choose-source" },
      },
      {
        args: [],
        channel: "workspace:publication:export",
        forwarded: { type: "publication.export" },
      },
      {
        args: ["origin", "skills-desktop/publication"],
        channel: "workspace:publication:prepare",
        forwarded: {
          branch: "skills-desktop/publication",
          remote: "origin",
          type: "publication.prepare",
        },
      },
      {
        args: ["plan-1"],
        channel: "workspace:publication:review-request",
        forwarded: { planId: "plan-1", type: "publication.review.request" },
      },
      {
        args: ["plan-2"],
        channel: "workspace:publication:discard",
        forwarded: { planId: "plan-2", type: "publication.discard" },
      },
      {
        args: [],
        channel: "workspace:publication:reconcile",
        forwarded: { type: "publication.reconcile" },
      },
      {
        args: [],
        channel: "workspace:studio:open",
        forwarded: { type: "studio.open" },
      },
      {
        args: ["grant-1"],
        channel: "workspace:studio:release",
        forwarded: { grantId: "grant-1", type: "studio.release" },
      },
      {
        args: ["grant-2"],
        channel: "workspace:studio:validate",
        forwarded: { grantId: "grant-2", type: "studio.validate" },
      },
      {
        args: ["grant-3"],
        channel: "workspace:studio:draft-create",
        forwarded: { grantId: "grant-3", type: "studio.draft.create" },
      },
      {
        args: [],
        channel: "workspace:studio:draft-create",
        forwarded: { type: "studio.draft.create" },
      },
      {
        args: ["draft-1", 4, "# Skill\n"],
        channel: "workspace:studio:draft-save",
        forwarded: {
          draftId: "draft-1",
          expectedRevision: 4,
          skillMd: "# Skill\n",
          type: "studio.draft.save",
        },
      },
      {
        args: ["draft-2", 7],
        channel: "workspace:studio:draft-delete",
        forwarded: {
          draftId: "draft-2",
          expectedRevision: 7,
          type: "studio.draft.delete",
        },
      },
      {
        args: ["draft-3"],
        channel: "workspace:studio:preview",
        forwarded: { draftId: "draft-3", type: "studio.preview" },
      },
      {
        args: ["draft-4"],
        channel: "workspace:studio:export",
        forwarded: { draftId: "draft-4", type: "studio.export" },
      },
    ];

    for (const { args, channel, forwarded } of cases) {
      await expect(
        handlers.get(channel)!(authorizedEvent as never, "epoch-1", ...args),
      ).resolves.toEqual({ ok: true, value: { operationId: "operation-9" } });
      expect(session.request).toHaveBeenLastCalledWith({
        ...forwarded,
        version: 2,
      });
    }

    await expect(
      handlers.get("workspace:publication:export")!(
        hostileEvent as never,
        "epoch-1",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("workspace:studio:draft-save")!(
        hostileEvent as never,
        "epoch-1",
        "draft-1",
        4,
        "# Skill\n",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });

    session.request.mockRejectedValueOnce(new Error("session crashed"));
    await expect(
      handlers.get("workspace:studio:open")!(
        authorizedEvent as never,
        "epoch-1",
      ),
    ).resolves.toMatchObject({
      error: { code: "internal_error", phase: "ipc" },
      ok: false,
    });
  });

  it("rejects queued workspace and review invokes from a prior attachment epoch", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const sessions = Array.from({ length: 4 }, (_, index) => ({
      request: vi.fn(async () => ({
        ok: true as const,
        value: { operationId: `operation-${index}` },
      })),
      snapshot: vi.fn(),
      teardown: vi.fn(),
    }));
    const eventSinks: Array<(event: unknown) => void> = [];
    let epoch = 0;
    const capabilities = {
      attach: vi.fn((_endpoint: unknown, publish: (event: unknown) => void) => {
        eventSinks.push(publish);
        return sessions[eventSinks.length - 1];
      }),
    };
    const registration = registerDesktopIpc({
      capabilities: capabilities as never,
      ipcMain: ipcMain as never,
      newEpoch: () => `private-${++epoch}`,
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const workspaceFrame = {
      url: "skills-desktop://workspace/index.html",
    };
    const workspaceContents = {
      id: 17,
      isDestroyed: () => false,
      mainFrame: workspaceFrame,
      send: vi.fn(),
    };
    const workspaceEvent = {
      sender: workspaceContents,
      senderFrame: workspaceFrame,
    };
    const targetId = "00000000-0000-4000-8000-000000000001";

    registration.attach(
      workspaceContents as never,
      "workspace",
      workspaceFrame.url,
    );
    const staleWorkspaceInvoke = Promise.resolve().then(() =>
      handlers.get("workspace:inventory:refresh")!(
        workspaceEvent as never,
        "private-1",
        targetId,
      ),
    );
    registration.attach(
      workspaceContents as never,
      "workspace",
      workspaceFrame.url,
    );

    await expect(staleWorkspaceInvoke).resolves.toMatchObject({
      error: { code: "unauthorized" },
      ok: false,
    });
    expect(sessions[0]?.teardown).toHaveBeenCalledTimes(1);
    expect(sessions[0]?.request).not.toHaveBeenCalled();
    expect(sessions[1]?.request).not.toHaveBeenCalled();
    await expect(
      handlers.get("workspace:inventory:refresh")!(
        workspaceEvent as never,
        "private-3",
        targetId,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { operationId: "operation-1" },
    });
    expect(sessions[1]?.request).toHaveBeenCalledTimes(1);

    workspaceContents.send.mockClear();
    eventSinks[0]?.({
      reason: "buffer_overflow",
      sequence: 1,
      sessionEpoch: "public-2",
      stateRevision: 1,
      type: "resync.required",
    });
    expect(workspaceContents.send).not.toHaveBeenCalled();
    eventSinks[1]?.({
      reason: "buffer_overflow",
      sequence: 1,
      sessionEpoch: "public-4",
      stateRevision: 1,
      type: "resync.required",
    });
    expect(workspaceContents.send).toHaveBeenCalledWith(
      "workspace:event",
      expect.objectContaining({ sessionEpoch: "public-4" }),
    );

    const reviewFrame = { url: "skills-desktop://review/index.html" };
    const reviewContents = {
      id: 18,
      isDestroyed: () => false,
      mainFrame: reviewFrame,
      send: vi.fn(),
    };
    const reviewEvent = { sender: reviewContents, senderFrame: reviewFrame };
    registration.attach(
      reviewContents as never,
      "review",
      reviewFrame.url,
      "review-1",
    );
    const staleReviewInvoke = Promise.resolve().then(() =>
      handlers.get("review:decision:approve")!(
        reviewEvent as never,
        "private-5",
      ),
    );
    registration.attach(
      reviewContents as never,
      "review",
      reviewFrame.url,
      "review-1",
    );

    await expect(staleReviewInvoke).resolves.toMatchObject({
      error: { code: "unauthorized" },
      ok: false,
    });
    expect(sessions[2]?.request).not.toHaveBeenCalled();
    expect(sessions[3]?.request).not.toHaveBeenCalled();
    await expect(
      handlers.get("review:decision:approve")!(
        reviewEvent as never,
        "private-7",
      ),
    ).resolves.toEqual({
      ok: true,
      value: { operationId: "operation-3" },
    });
    registration.detach(reviewContents.id);
    await expect(
      handlers.get("review:decision:reject")!(
        reviewEvent as never,
        "private-7",
      ),
    ).resolves.toMatchObject({
      error: { code: "unauthorized" },
      ok: false,
    });
  });

  it("returns safe actionable diagnostics for an invalid saved workspace", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const session = {
      request: vi.fn(),
      snapshot: vi.fn(async () => ({
        eventSequence: 0,
        inventory: {
          activeOperationId: null,
          cliVersion: null,
          entries: [],
          freshness: "none",
          lastError: null,
          observedAt: null,
          persistenceWarning: null,
          phase: "ready",
        },
        mutation: {
          activeOperationId: null,
          commandPlan: null,
          lastError: null,
          outcome: null,
          phase: "idle",
          reconciliationDeadline: null,
        },
        schemaVersion: 1,
        sessionEpoch: "epoch-1",
        stateRevision: 0,
        target: {
          connectionReference: null,
          generation: 1,
          harness: "Codex",
          id: "00000000-0000-4000-8000-000000000001",
          kind: "local",
          label: "This device",
          workspace: "/",
          workspaceLabel: "",
        },
      })),
      teardown: vi.fn(),
    };
    const registration = registerDesktopIpc({
      capabilities: { attach: vi.fn(() => session) } as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const mainFrame = { url: "skills-desktop://workspace/index.html" };
    const webContents = {
      id: 17,
      isDestroyed: () => false,
      mainFrame,
      send: vi.fn(),
    };
    registration.attach(webContents as never, "workspace", mainFrame.url);

    await expect(
      handlers.get("workspace:snapshot:get")!(
        {
          sender: webContents,
          senderFrame: mainFrame,
        } as never,
        "epoch-1",
      ),
    ).resolves.toEqual({
      error: {
        code: "target_unavailable",
        effects: "none",
        message:
          "The saved workspace is invalid. Choose a workspace in Targets.",
        phase: "snapshot",
        retryable: false,
      },
      ok: false,
    });
  });

  it("grants only the workspace main frame versioned About read and check intents", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const aboutSnapshot = {
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
        releasePageUrl: "https://github.com/oldwinter/skills-desktop/releases",
      },
      schemaVersion: 1,
      state: { kind: "manual" },
    } as const;
    let publishUpdate: ((snapshot: typeof aboutSnapshot) => void) | undefined;
    const updates = {
      exportDiagnostics: vi.fn(async () => "saved" as const),
      getSnapshot: vi.fn(() => aboutSnapshot),
      requestCheck: vi.fn(async () => undefined),
      requestRestart: vi.fn(async () => "blocked" as const),
      subscribe: vi.fn((listener: (snapshot: typeof aboutSnapshot) => void) => {
        publishUpdate = listener;
        return () => undefined;
      }),
    };
    const session = {
      request: vi.fn(),
      snapshot: vi.fn(),
      teardown: vi.fn(),
    };
    const registration = registerDesktopIpc({
      capabilities: { attach: vi.fn(() => session) } as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates,
    });
    const mainFrame = { url: "skills-desktop://workspace/index.html" };
    const workspaceContents = {
      id: 17,
      isDestroyed: () => false,
      mainFrame,
      send: vi.fn(),
    };
    registration.attach(workspaceContents as never, "workspace", mainFrame.url);
    const workspaceEvent = {
      sender: workspaceContents,
      senderFrame: mainFrame,
    };

    expect(
      [...handlers.keys()].filter((channel) => channel.startsWith("about:")),
    ).toEqual([
      "about:update:snapshot:get",
      "about:update:check",
      "about:update:restart",
      "about:release-diagnostics:export",
    ]);
    await expect(
      handlers.get("about:update:snapshot:get")!(
        workspaceEvent as never,
        "epoch-1",
      ),
    ).resolves.toEqual({ ok: true, value: aboutSnapshot });
    await expect(
      handlers.get("about:update:check")!(workspaceEvent as never, "epoch-1", {
        type: "update.check",
        version: 1,
      }),
    ).resolves.toEqual({ ok: true, value: aboutSnapshot });
    expect(updates.requestCheck).toHaveBeenCalledTimes(1);
    await expect(
      handlers.get("about:update:restart")!(
        workspaceEvent as never,
        "epoch-1",
        {
          candidateId: "00000000-0000-4000-8000-000000000025",
          type: "update.restart",
          version: 1,
        },
      ),
    ).resolves.toEqual({ ok: true, value: aboutSnapshot });
    expect(updates.requestRestart).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000025",
    );
    await expect(
      handlers.get("about:release-diagnostics:export")!(
        workspaceEvent as never,
        "epoch-1",
        { type: "release-diagnostics.export", version: 1 },
      ),
    ).resolves.toEqual({ ok: true, value: { status: "saved" } });
    expect(updates.exportDiagnostics).toHaveBeenCalledTimes(1);

    const hostileSubframe = {
      sender: workspaceContents,
      senderFrame: { url: mainFrame.url },
    };
    await expect(
      handlers.get("about:update:check")!(hostileSubframe as never, "epoch-1", {
        type: "update.check",
        version: 1,
      }),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("about:update:check")!(workspaceEvent as never, "epoch-1", {
        feedUrl: "https://attacker.invalid",
        type: "update.check",
        version: 1,
      }),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(updates.requestCheck).toHaveBeenCalledTimes(1);
    await expect(
      handlers.get("about:update:restart")!(
        workspaceEvent as never,
        "epoch-1",
        {
          candidateId: "00000000-0000-4000-8000-000000000025",
          feedUrl: "https://attacker.invalid",
          type: "update.restart",
          version: 1,
        },
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    await expect(
      handlers.get("about:release-diagnostics:export")!(
        workspaceEvent as never,
        "epoch-1",
        {
          outputPath: "/SECRET_PATH/diagnostics.json",
          type: "release-diagnostics.export",
          version: 1,
        },
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    expect(updates.requestRestart).toHaveBeenCalledTimes(1);
    expect(updates.exportDiagnostics).toHaveBeenCalledTimes(1);
    expect([...handlers.keys()].join(" ")).not.toMatch(
      /download|install|quit|argv|shell|path/i,
    );

    const reviewFrame = { url: "skills-desktop://review/index.html" };
    const reviewContents = {
      id: 18,
      isDestroyed: () => false,
      mainFrame: reviewFrame,
      send: vi.fn(),
    };
    registration.attach(
      reviewContents as never,
      "review",
      reviewFrame.url,
      "review-1",
    );
    await expect(
      handlers.get("about:update:check")!(
        { sender: reviewContents, senderFrame: reviewFrame } as never,
        "epoch-1",
        { type: "update.check", version: 1 },
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("about:update:restart")!(
        { sender: reviewContents, senderFrame: reviewFrame } as never,
        "epoch-1",
        {
          candidateId: "00000000-0000-4000-8000-000000000025",
          type: "update.restart",
          version: 1,
        },
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    expect(updates.requestCheck).toHaveBeenCalledTimes(1);
    expect(updates.subscribe).toHaveBeenCalledTimes(1);
    publishUpdate?.(aboutSnapshot);
    expect(workspaceContents.send).toHaveBeenCalledWith(
      "about:update:snapshot-changed",
      aboutSnapshot,
    );
    expect(reviewContents.send).not.toHaveBeenCalledWith(
      "about:update:snapshot-changed",
      expect.anything(),
    );

    // A malformed push is dropped at the schema boundary, never relayed.
    workspaceContents.send.mockClear();
    publishUpdate?.({ garbage: true } as never);
    publishUpdate?.({ ...aboutSnapshot, schemaVersion: 99 } as never);
    expect(workspaceContents.send).not.toHaveBeenCalledWith(
      "about:update:snapshot-changed",
      expect.anything(),
    );

    // A disposed renderer is skipped on the next broadcast.
    workspaceContents.isDestroyed = () => true;
    publishUpdate?.(aboutSnapshot);
    expect(workspaceContents.send).not.toHaveBeenCalledWith(
      "about:update:snapshot-changed",
      expect.anything(),
    );
  });

  it("reads the main-owned menu for the workspace only and relays commands to the exact owner", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const session = {
      request: vi.fn(),
      snapshot: vi.fn(),
      teardown: vi.fn(),
    };
    const menu = buildApplicationMenu({ locale: "zh-CN", platform: "linux" });
    let nextEpoch = 1;
    const registration = registerDesktopIpc({
      capabilities: { attach: vi.fn(() => session) } as never,
      ipcMain: ipcMain as never,
      menu: { current: () => menu },
      newEpoch: () => `epoch-${nextEpoch++}`,
      updates: {
        exportDiagnostics: vi.fn(async () => "saved" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "blocked" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const mainFrame = { url: "skills-desktop://workspace/index.html" };
    const workspaceContents = {
      id: 17,
      isDestroyed: vi.fn(() => false),
      mainFrame,
      send: vi.fn(),
    };
    const attachment = registration.attach(
      workspaceContents as never,
      "workspace",
      mainFrame.url,
    );
    const workspaceEvent = { sender: workspaceContents, senderFrame: mainFrame };

    expect(
      [...handlers.keys()].filter((channel) => channel.startsWith("menu:")),
    ).toEqual(["menu:application:get"]);
    await expect(
      handlers.get("menu:application:get")!(workspaceEvent as never, "epoch-1"),
    ).resolves.toEqual({ ok: true, value: menu });
    await expect(
      handlers.get("menu:application:get")!(
        workspaceEvent as never,
        "epoch-1",
        "extra",
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
    await expect(
      handlers.get("menu:application:get")!(
        { sender: workspaceContents, senderFrame: { url: mainFrame.url } } as never,
        "epoch-1",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });

    const reviewFrame = { url: "skills-desktop://review/index.html" };
    const reviewContents = {
      id: 18,
      isDestroyed: () => false,
      mainFrame: reviewFrame,
      send: vi.fn(),
    };
    const reviewAttachment = registration.attach(
      reviewContents as never,
      "review",
      reviewFrame.url,
      "review-1",
    );
    await expect(
      handlers.get("menu:application:get")!(
        { sender: reviewContents, senderFrame: reviewFrame } as never,
        "epoch-3",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });

    workspaceContents.send.mockClear();
    expect(registration.notifyMenuCommand("inventory.refresh", attachment!)).toBe(
      true,
    );
    expect(workspaceContents.send).toHaveBeenCalledWith("menu:command", {
      command: "inventory.refresh",
      schemaVersion: 1,
    });
    expect(
      registration.notifyMenuCommand("navigate.about", reviewAttachment!),
    ).toBe(false);
    expect(reviewContents.send).not.toHaveBeenCalledWith(
      "menu:command",
      expect.anything(),
    );
    expect(
      registration.notifyMenuCommand("workspace.show" as never, attachment!),
    ).toBe(false);
    workspaceContents.send.mockClear();
    expect(
      registration.notifyMenuCommand("navigate.about", {
        attachmentEpoch: "stale",
        webContentsId: 17,
      }),
    ).toBe(false);
    workspaceContents.isDestroyed.mockReturnValue(true);
    expect(registration.notifyMenuCommand("navigate.about", attachment!)).toBe(
      false,
    );
    expect(workspaceContents.send).not.toHaveBeenCalled();

    registration.dispose();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith("menu:application:get");
  });

  it("forwards cancel, comparison, target, and mutation intents as closed versioned requests", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const session = {
      request: vi.fn(async () => ({
        ok: true as const,
        value: { operationId: "operation-3" },
      })),
      snapshot: vi.fn(),
      teardown: vi.fn(),
    };
    const registration = registerDesktopIpc({
      capabilities: { attach: vi.fn(() => session) } as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const mainFrame = { url: "skills-desktop://workspace/index.html" };
    const webContents = {
      id: 31,
      isDestroyed: () => false,
      mainFrame,
      send: vi.fn(),
    };
    registration.attach(webContents as never, "workspace", mainFrame.url);
    const authorizedEvent = { sender: webContents, senderFrame: mainFrame };

    const cases: Array<{
      readonly args: readonly unknown[];
      readonly channel: string;
      readonly forwarded: Record<string, unknown>;
    }> = [
      {
        args: ["operation-1"],
        channel: "workspace:inventory:cancel",
        forwarded: {
          operationId: "operation-1",
          type: "inventory.cancel",
        },
      },
      {
        args: ["comparison-1", "row-1", "00000000-0000-4000-8000-000000000002"],
        channel: "workspace:comparison:prepare",
        forwarded: {
          comparisonId: "comparison-1",
          destinationTargetId: "00000000-0000-4000-8000-000000000002",
          rowKey: "row-1",
          type: "comparison.prepare",
        },
      },
      {
        args: [
          "00000000-0000-4000-8000-000000000001",
          { label: "Renamed" },
        ],
        channel: "workspace:target:update",
        forwarded: {
          definition: { label: "Renamed" },
          targetId: "00000000-0000-4000-8000-000000000001",
          type: "target.update",
        },
      },
      {
        args: ["00000000-0000-4000-8000-000000000001"],
        channel: "workspace:target:delete",
        forwarded: {
          targetId: "00000000-0000-4000-8000-000000000001",
          type: "target.delete",
        },
      },
      {
        args: [
          "00000000-0000-4000-8000-000000000001",
          { names: ["find-skills"], operation: "add" },
        ],
        channel: "workspace:mutation:prepare",
        forwarded: {
          intent: { names: ["find-skills"], operation: "add" },
          targetId: "00000000-0000-4000-8000-000000000001",
          type: "mutation.prepare",
        },
      },
      {
        args: ["00000000-0000-4000-8000-000000000001"],
        channel: "workspace:mutation:reconcile",
        forwarded: {
          targetId: "00000000-0000-4000-8000-000000000001",
          type: "mutation.reconcile",
        },
      },
    ];

    for (const { args, channel, forwarded } of cases) {
      await expect(
        handlers.get(channel)!(authorizedEvent as never, "epoch-1", ...args),
      ).resolves.toEqual({ ok: true, value: { operationId: "operation-3" } });
      expect(session.request).toHaveBeenLastCalledWith({
        ...forwarded,
        version: 2,
      });
    }

    await expect(
      handlers.get("workspace:mutation:reconcile")!(
        {
          sender: webContents,
          senderFrame: { url: "skills-desktop://review/index.html" },
        } as never,
        "epoch-1",
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
  });

  it("serves snapshot and decisions to the review role only", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const reviewSnapshot = {
      schemaVersion: 2,
      status: "unavailable",
    } as const;
    const session = {
      request: vi.fn(async () => ({
        ok: true as const,
        value: { operationId: "op-review" },
      })),
      snapshot: vi.fn(async () => reviewSnapshot),
      teardown: vi.fn(),
    };
    const registration = registerDesktopIpc({
      capabilities: { attach: vi.fn(() => session) } as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const reviewFrame = { url: "skills-desktop://review/index.html" };
    const reviewContents = {
      id: 41,
      isDestroyed: () => false,
      mainFrame: reviewFrame,
      send: vi.fn(),
    };
    const attachment = registration.attach(
      reviewContents as never,
      "review",
      reviewFrame.url,
      "review-9",
    );
    const reviewEvent = { sender: reviewContents, senderFrame: reviewFrame };

    await expect(
      handlers.get("review:snapshot:get")!(
        reviewEvent as never,
        attachment!.attachmentEpoch,
      ),
    ).resolves.toEqual({ ok: true, value: reviewSnapshot });

    for (const channel of [
      "review:decision:approve",
      "review:decision:reject",
    ]) {
      await expect(
        handlers.get(channel)!(
          reviewEvent as never,
          attachment!.attachmentEpoch,
        ),
      ).resolves.toEqual({ ok: true, value: { operationId: "op-review" } });
    }
    expect(session.request).toHaveBeenNthCalledWith(1, {
      decision: "approve",
      type: "review.decide",
      version: 2,
    });
    expect(session.request).toHaveBeenNthCalledWith(2, {
      decision: "reject",
      type: "review.decide",
      version: 2,
    });

    // A workspace-role frame cannot read or decide a review.
    const workspaceFrame = { url: "skills-desktop://workspace/index.html" };
    const workspaceContents = {
      id: 42,
      isDestroyed: () => false,
      mainFrame: workspaceFrame,
      send: vi.fn(),
    };
    const workspaceAttachment = registration.attach(
      workspaceContents as never,
      "workspace",
      workspaceFrame.url,
    );
    const workspaceEvent = {
      sender: workspaceContents,
      senderFrame: workspaceFrame,
    };
    await expect(
      handlers.get("review:snapshot:get")!(
        workspaceEvent as never,
        workspaceAttachment!.attachmentEpoch,
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("review:decision:approve")!(
        workspaceEvent as never,
        workspaceAttachment!.attachmentEpoch,
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    expect(session.request).toHaveBeenCalledTimes(2);

    // A review-role frame with a stale epoch is rejected.
    await expect(
      handlers.get("review:snapshot:get")!(
        reviewEvent as never,
        "epoch-999",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
  });

  it("bounds review snapshot and decision failures to internal_error", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const session = {
      request: vi.fn(async () => {
        throw new Error("session crashed");
      }),
      snapshot: vi.fn(async () => {
        throw new Error("snapshot crashed");
      }),
      teardown: vi.fn(),
    };
    const registration = registerDesktopIpc({
      capabilities: { attach: vi.fn(() => session) } as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const reviewFrame = { url: "skills-desktop://review/index.html" };
    const reviewContents = {
      id: 51,
      isDestroyed: () => false,
      mainFrame: reviewFrame,
      send: vi.fn(),
    };
    const attachment = registration.attach(
      reviewContents as never,
      "review",
      reviewFrame.url,
      "review-x",
    );
    const reviewEvent = {
      sender: reviewContents,
      senderFrame: reviewFrame,
    };

    await expect(
      handlers.get("review:snapshot:get")!(
        reviewEvent as never,
        attachment!.attachmentEpoch,
      ),
    ).resolves.toMatchObject({
      error: { code: "internal_error", phase: "ipc" },
      ok: false,
    });
    for (const channel of [
      "review:decision:approve",
      "review:decision:reject",
    ]) {
      await expect(
        handlers.get(channel)!(
          reviewEvent as never,
          attachment!.attachmentEpoch,
        ),
      ).resolves.toMatchObject({
        error: { code: "internal_error", phase: "ipc" },
        ok: false,
      });
    }
  });

  it("returns bounded About failures for hostile frames, bad requests, and update crashes", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const updates = {
      exportDiagnostics: vi.fn(async () => "saved" as const),
      getSnapshot: vi.fn(() => {
        throw new Error("update store crashed");
      }),
      requestCheck: vi.fn(async () => undefined),
      requestRestart: vi.fn(async () => "stale" as const),
      subscribe: vi.fn(() => () => undefined),
    };
    const registration = registerDesktopIpc({
      capabilities: {
        attach: vi.fn(() => ({
          request: vi.fn(),
          snapshot: vi.fn(),
          teardown: vi.fn(),
        })),
      } as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates,
    });
    const mainFrame = { url: "skills-desktop://workspace/index.html" };
    const webContents = {
      id: 51,
      isDestroyed: () => false,
      mainFrame,
      send: vi.fn(),
    };
    registration.attach(webContents as never, "workspace", mainFrame.url);
    const authorizedEvent = { sender: webContents, senderFrame: mainFrame };
    const hostileEvent = {
      sender: webContents,
      senderFrame: { url: "skills-desktop://review/index.html" },
    };

    await expect(
      handlers.get("about:update:snapshot:get")!(
        hostileEvent as never,
        "epoch-1",
      ),
    ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    await expect(
      handlers.get("about:update:snapshot:get")!(
        authorizedEvent as never,
        "epoch-1",
        "extra",
      ),
    ).resolves.toMatchObject({
      error: { code: "invalid_request" },
      ok: false,
    });
    await expect(
      handlers.get("about:update:snapshot:get")!(
        authorizedEvent as never,
        "epoch-1",
      ),
    ).resolves.toMatchObject({
      error: { code: "internal_error" },
      ok: false,
    });

    await expect(
      handlers.get("about:release-diagnostics:export")!(
        authorizedEvent as never,
        "epoch-1",
        { type: "release-diagnostics.export", version: 1 },
      ),
    ).resolves.toEqual({ ok: true, value: { status: "saved" } });
    await expect(
      handlers.get("about:release-diagnostics:export")!(
        authorizedEvent as never,
        "epoch-1",
        { type: "wrong" },
      ),
    ).resolves.toMatchObject({
      error: { code: "invalid_request" },
      ok: false,
    });
    updates.exportDiagnostics.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      handlers.get("about:release-diagnostics:export")!(
        authorizedEvent as never,
        "epoch-1",
        { type: "release-diagnostics.export", version: 1 },
      ),
    ).resolves.toMatchObject({
      error: { code: "internal_error" },
      ok: false,
    });
  });

  it("reports internal_error for the menu when no provider is configured", async () => {
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const registration = registerDesktopIpc({
      capabilities: {
        attach: vi.fn(() => ({
          request: vi.fn(),
          snapshot: vi.fn(),
          teardown: vi.fn(),
        })),
      } as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const mainFrame = { url: "skills-desktop://workspace/index.html" };
    const webContents = {
      id: 61,
      isDestroyed: () => false,
      mainFrame,
      send: vi.fn(),
    };
    registration.attach(webContents as never, "workspace", mainFrame.url);
    await expect(
      handlers.get("menu:application:get")!(
        { sender: webContents, senderFrame: mainFrame } as never,
        "epoch-1",
      ),
    ).resolves.toMatchObject({
      error: { code: "internal_error" },
      ok: false,
    });
  });

  it("tears down the session when attach lands on a destroyed webContents", () => {
    const session = {
      request: vi.fn(),
      snapshot: vi.fn(),
      teardown: vi.fn(),
    };
    const ipcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    };
    const registration = registerDesktopIpc({
      capabilities: { attach: vi.fn(() => session) } as never,
      ipcMain: ipcMain as never,
      newEpoch: () => "epoch-1",
      updates: {
        exportDiagnostics: vi.fn(async () => "cancelled" as const),
        getSnapshot: vi.fn(),
        requestCheck: vi.fn(async () => undefined),
        requestRestart: vi.fn(async () => "stale" as const),
        subscribe: vi.fn(() => () => undefined),
      },
    });
    const destroyed = {
      id: 71,
      isDestroyed: () => true,
      send: vi.fn(),
    };
    expect(
      registration.attach(
        destroyed as never,
        "workspace",
        "skills-desktop://workspace/index.html",
      ),
    ).toBeUndefined();
    expect(session.teardown).toHaveBeenCalledTimes(1);
    expect(destroyed.send).not.toHaveBeenCalled();

    // A send failure during epoch delivery also detaches cleanly.
    const throwing = {
      id: 72,
      isDestroyed: () => false,
      send: vi.fn(() => {
        throw new Error("frame gone");
      }),
    };
    expect(
      registration.attach(
        throwing as never,
        "workspace",
        "skills-desktop://workspace/index.html",
      ),
    ).toBeUndefined();
    expect(session.teardown).toHaveBeenCalledTimes(2);
  });
});

describe("Electron IPC failure arms", () => {
  const workspaceUrl = "skills-desktop://workspace/index.html";
  const reviewUrl = "skills-desktop://review/index.html";

  function failureHarness(options?: { menu?: { current(): unknown } }) {
    let nextEpoch = 1;
    const session = {
      request: vi.fn(async () => ({
        ok: true,
        value: { operationId: "operation-1" },
      })),
      snapshot: vi.fn(async () => ({ bogus: "snapshot" })),
      teardown: vi.fn(),
    };
    const handlers = new Map<
      string,
      (event: never, ...args: unknown[]) => unknown
    >();
    const ipcMain = {
      handle(
        channel: string,
        handler: (event: never, ...args: unknown[]) => unknown,
      ) {
        handlers.set(channel, handler);
      },
      removeHandler: vi.fn(),
    };
    const updates = {
      exportDiagnostics: vi.fn(async () => {
        throw new Error("export failed");
      }),
      getSnapshot: vi.fn(() => {
        throw new Error("snapshot failed");
      }),
      requestCheck: vi.fn(async () => {
        throw new Error("check failed");
      }),
      requestRestart: vi.fn(async () => {
        throw new Error("restart failed");
      }),
      subscribe: vi.fn(() => () => undefined),
    };
    const registration = registerDesktopIpc({
      capabilities: { attach: vi.fn(() => session) } as never,
      ipcMain: ipcMain as never,
      menu: options?.menu as never,
      newEpoch: vi.fn(() => `epoch-${nextEpoch++}`),
      updates,
    });
    const workspaceWebContents = {
      id: 17,
      isDestroyed: vi.fn(() => false),
      mainFrame: { url: workspaceUrl },
      send: vi.fn(),
    };
    const workspaceAttachment = registration.attach(
      workspaceWebContents as never,
      "workspace",
      workspaceUrl,
    );
    const reviewWebContents = {
      id: 21,
      isDestroyed: vi.fn(() => false),
      mainFrame: { url: reviewUrl },
      send: vi.fn(),
    };
    const reviewAttachment = registration.attach(
      reviewWebContents as never,
      "review",
      reviewUrl,
      "review-1",
    );
    return {
      handlers,
      registration,
      reviewAttachment,
      reviewEvent: {
        sender: reviewWebContents,
        senderFrame: reviewWebContents.mainFrame,
      },
      reviewWebContents,
      session,
      updates,
      workspaceAttachment,
      workspaceEvent: {
        sender: workspaceWebContents,
        senderFrame: workspaceWebContents.mainFrame,
      },
      workspaceWebContents,
    };
  }

  it("rejects every inbound channel on an attachment-epoch mismatch", async () => {
    const fixture = failureHarness();
    expect(fixture.workspaceAttachment?.attachmentEpoch).toBe("epoch-1");
    expect(fixture.reviewAttachment?.attachmentEpoch).toBe("epoch-3");

    for (const [channel, handler] of fixture.handlers) {
      await expect(
        handler(fixture.workspaceEvent as never, "stale-epoch", {}),
      ).resolves.toMatchObject({ error: { code: "unauthorized" }, ok: false });
    }
    expect(fixture.session.request).not.toHaveBeenCalled();
  });

  it("maps a session failure to internal_error on every workspace channel", async () => {
    const fixture = failureHarness();
    fixture.session.request.mockRejectedValue(new Error("bridge gone"));

    const workspaceChannels = [...fixture.handlers.keys()].filter((channel) =>
      channel.startsWith("workspace:"),
    );
    for (const channel of workspaceChannels) {
      await expect(
        fixture.handlers.get(channel)!(
          fixture.workspaceEvent as never,
          fixture.workspaceAttachment!.attachmentEpoch,
          "arg-1",
          "arg-2",
        ),
      ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
    }

    for (const channel of ["review:decision:approve", "review:decision:reject"]) {
      await expect(
        fixture.handlers.get(channel)!(
          fixture.reviewEvent as never,
          fixture.reviewAttachment!.attachmentEpoch,
        ),
      ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
    }
    await expect(
      fixture.handlers.get("review:snapshot:get")!(
        fixture.reviewEvent as never,
        fixture.reviewAttachment!.attachmentEpoch,
      ),
    ).resolves.toMatchObject({
      error: { code: "internal_error" },
      ok: false,
    });
  });

  it("maps about-update failures to invalid_request or internal_error", async () => {
    const fixture = failureHarness();
    const event = fixture.workspaceEvent as never;
    const epoch = fixture.workspaceAttachment!.attachmentEpoch;

    await expect(
      fixture.handlers.get("about:update:check")!(event, epoch, {
        type: "update.check",
        version: 1,
      }),
    ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
    await expect(
      fixture.handlers.get("about:update:check")!(event, epoch, {}),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });

    await expect(
      fixture.handlers.get("about:update:restart")!(event, epoch, {
        candidateId: "00000000-0000-4000-8000-000000000099",
        type: "update.restart",
        version: 1,
      }),
    ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
    await expect(
      fixture.handlers.get("about:release-diagnostics:export")!(
        event,
        epoch,
        { type: "release-diagnostics.export", version: 1 },
      ),
    ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
    await expect(
      fixture.handlers.get("about:update:snapshot:get")!(event, epoch),
    ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
    await expect(
      fixture.handlers.get("about:update:snapshot:get")!(
        event,
        epoch,
        "extra",
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });
  });

  it("reports menu failures when the projection is missing or throws", async () => {
    const withoutMenu = failureHarness();
    await expect(
      withoutMenu.handlers.get("menu:application:get")!(
        withoutMenu.workspaceEvent as never,
        withoutMenu.workspaceAttachment!.attachmentEpoch,
      ),
    ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
    await expect(
      withoutMenu.handlers.get("menu:application:get")!(
        withoutMenu.workspaceEvent as never,
        withoutMenu.workspaceAttachment!.attachmentEpoch,
        "extra",
      ),
    ).resolves.toMatchObject({ error: { code: "invalid_request" }, ok: false });

    const throwingMenu = failureHarness({
      menu: {
        current() {
          throw new Error("menu read failed");
        },
      },
    });
    await expect(
      throwingMenu.handlers.get("menu:application:get")!(
        throwingMenu.workspaceEvent as never,
        throwingMenu.workspaceAttachment!.attachmentEpoch,
      ),
    ).resolves.toMatchObject({ error: { code: "internal_error" }, ok: false });
  });

  it("rejects menu relays for stale, foreign, destroyed, or throwing endpoints", () => {
    const fixture = failureHarness();
    const owner = fixture.workspaceAttachment!;
    const reviewOwner = fixture.reviewAttachment!;

    expect(
      fixture.registration.notifyMenuCommand("inventory.refresh", owner),
    ).toBe(true);
    expect(
      fixture.workspaceWebContents.send,
    ).toHaveBeenCalledWith("menu:command", {
      command: "inventory.refresh",
      schemaVersion: 1,
    });

    // Wrong-role owner is not relayed.
    expect(
      fixture.registration.notifyMenuCommand("inventory.refresh", reviewOwner),
    ).toBe(false);

    // A stale attachment (detached by a later attach) is not relayed.
    fixture.registration.attach(
      { id: 17, isDestroyed: () => false, mainFrame: { url: workspaceUrl }, send: vi.fn() } as never,
      "workspace",
      workspaceUrl,
    );
    expect(
      fixture.registration.notifyMenuCommand("inventory.refresh", owner),
    ).toBe(false);

    // A destroyed surface is not relayed.
    const fresh = failureHarness();
    fresh.workspaceWebContents.isDestroyed.mockReturnValue(true);
    expect(
      fresh.registration.notifyMenuCommand(
        "inventory.refresh",
        fresh.workspaceAttachment!,
      ),
    ).toBe(false);

    // A throwing send surface is reported as not relayed.
    const throwing = failureHarness();
    throwing.workspaceWebContents.send.mockImplementation(() => {
      throw new Error("frame gone");
    });
    expect(
      throwing.registration.notifyMenuCommand(
        "inventory.refresh",
        throwing.workspaceAttachment!,
      ),
    ).toBe(false);

    // An out-of-contract command is not relayed.
    expect(
      fixture.registration.notifyMenuCommand(
        "not-a-command" as never,
        fixture.workspaceAttachment!,
      ),
    ).toBe(false);
  });
});
