import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";

import {
  desktopEventSchema,
  workspaceRequestResultSchema,
  workspaceSnapshotSchema,
  workspaceSnapshotResultSchema,
  type RendererError,
  type WorkspaceRequestResult,
} from "../../contracts/workspace.js";
import {
  reviewSnapshotResultSchema,
  reviewSnapshotSchema,
} from "../../contracts/review.js";
import type {
  DesktopCapabilities,
  DesktopSession,
} from "../application/desktop-capabilities.js";

const CHANNELS = {
  cancel: "workspace:inventory:cancel",
  event: "workspace:event",
  refresh: "workspace:inventory:refresh",
  reviewSnapshot: "review:snapshot:get",
  snapshot: "workspace:snapshot:get",
} as const;

interface RegisteredEndpoint {
  readonly expectedUrl: string;
  readonly role: "review" | "workspace";
  readonly session: DesktopSession;
  readonly webContents: WebContents;
}

function internalFailure(): WorkspaceRequestResult {
  const error: RendererError = {
    code: "internal_error",
    effects: "none",
    message: "The request could not be completed.",
    phase: "ipc",
    retryable: true,
  };
  return { error, ok: false };
}

function authorizationFailure(): WorkspaceRequestResult {
  return {
    error: {
      code: "unauthorized",
      effects: "none",
      message: "This window cannot make that request.",
      phase: "authorize",
      retryable: false,
    },
    ok: false,
  };
}

export function isAuthorizedSender(
  endpoint: Pick<RegisteredEndpoint, "expectedUrl" | "role"> & { readonly webContentsId: number },
  sender: {
    readonly frameUrl: string;
    readonly isMainFrame: boolean;
    readonly role: "review" | "workspace";
    readonly webContentsId: number;
  },
) {
  return (
    sender.webContentsId === endpoint.webContentsId &&
    sender.role === endpoint.role &&
    sender.isMainFrame &&
    sender.frameUrl === endpoint.expectedUrl
  );
}

export function registerDesktopIpc(input: {
  readonly capabilities: DesktopCapabilities;
  readonly ipcMain: IpcMain;
  readonly newEpoch: () => string;
}) {
  const endpoints = new Map<number, RegisteredEndpoint>();

  const authorized = (event: IpcMainInvokeEvent, role: RegisteredEndpoint["role"]) => {
    const endpoint = endpoints.get(event.sender.id);
    const frame = event.senderFrame;
    if (
      endpoint === undefined ||
      frame === null ||
      !isAuthorizedSender(
        {
          expectedUrl: endpoint.expectedUrl,
          role: endpoint.role,
          webContentsId: endpoint.webContents.id,
        },
        {
          frameUrl: frame.url,
          isMainFrame: frame === event.sender.mainFrame,
          role,
          webContentsId: event.sender.id,
        },
      )
    ) {
      return undefined;
    }
    return endpoint;
  };

  input.ipcMain.handle(CHANNELS.snapshot, async (event) => {
    const endpoint = authorized(event, "workspace");
    if (endpoint === undefined) {
      return workspaceSnapshotResultSchema.parse(authorizationFailure());
    }
    try {
      return workspaceSnapshotResultSchema.parse({
        ok: true,
        value: workspaceSnapshotSchema.parse(await endpoint.session.snapshot()),
      });
    } catch {
      return workspaceSnapshotResultSchema.parse(internalFailure());
    }
  });
  input.ipcMain.handle(CHANNELS.refresh, async (event, targetId: unknown) => {
    const endpoint = authorized(event, "workspace");
    if (endpoint === undefined) return authorizationFailure();
    try {
      return workspaceRequestResultSchema.parse(
        await endpoint.session.request({ targetId, type: "inventory.refresh", version: 1 }),
      );
    } catch {
      return internalFailure();
    }
  });
  input.ipcMain.handle(CHANNELS.cancel, async (event, operationId: unknown) => {
    const endpoint = authorized(event, "workspace");
    if (endpoint === undefined) return authorizationFailure();
    try {
      return workspaceRequestResultSchema.parse(
        await endpoint.session.request({ operationId, type: "inventory.cancel", version: 1 }),
      );
    } catch {
      return internalFailure();
    }
  });
  input.ipcMain.handle(CHANNELS.reviewSnapshot, (event) => {
    if (authorized(event, "review") === undefined) {
      return reviewSnapshotResultSchema.parse(authorizationFailure());
    }
    try {
      return reviewSnapshotResultSchema.parse({
        ok: true,
        value: reviewSnapshotSchema.parse({ schemaVersion: 1, status: "unavailable" }),
      });
    } catch {
      return reviewSnapshotResultSchema.parse(internalFailure());
    }
  });

  const detach = (webContentsId: number) => {
    const prior = endpoints.get(webContentsId);
    if (prior === undefined) return;
    prior.session.teardown();
    endpoints.delete(webContentsId);
  };

  const attach = (
    webContents: WebContents,
    role: RegisteredEndpoint["role"],
    expectedUrl: string,
  ) => {
    detach(webContents.id);
    const session = input.capabilities.attach(
      {
        endpointId: String(webContents.id),
        role,
        sessionEpoch: input.newEpoch(),
      },
      (event) => {
        if (!webContents.isDestroyed()) {
          webContents.send(CHANNELS.event, desktopEventSchema.parse(event));
        }
      },
    );
    endpoints.set(webContents.id, { expectedUrl, role, session, webContents });
  };

  return {
    attach,
    detach,
    dispose() {
      for (const webContentsId of endpoints.keys()) detach(webContentsId);
      input.ipcMain.removeHandler(CHANNELS.snapshot);
      input.ipcMain.removeHandler(CHANNELS.refresh);
      input.ipcMain.removeHandler(CHANNELS.cancel);
      input.ipcMain.removeHandler(CHANNELS.reviewSnapshot);
    },
  };
}
