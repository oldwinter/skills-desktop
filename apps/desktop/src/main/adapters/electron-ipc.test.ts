import { describe, expect, it, vi } from "vitest";

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
      version: 1,
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
      version: 1,
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
      version: 1,
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
      version: 1,
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
      version: 1,
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
      version: 1,
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
      version: 1,
    });

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
      version: 1,
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
  });
});
