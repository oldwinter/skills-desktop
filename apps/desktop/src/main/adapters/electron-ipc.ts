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
  reviewDecisionResultSchema,
  reviewSnapshotResultSchema,
  reviewSnapshotSchema,
} from "../../contracts/review.js";
import type {
  DesktopCapabilities,
  DesktopSession,
} from "../application/desktop-capabilities.js";

const CHANNELS = {
  cancel: "workspace:inventory:cancel",
  compare: "workspace:comparison:open",
  comparisonPrepare: "workspace:comparison:prepare",
  collectionPrepare: "workspace:collection:prepare",
  collectionPrepareMany: "workspace:collection:prepare-many",
  collectionReview: "workspace:collection:review-request",
  event: "workspace:event",
  hostTrustReview: "workspace:host-trust:review",
  refresh: "workspace:inventory:refresh",
  mutationPrepare: "workspace:mutation:prepare",
  mutationReconcile: "workspace:mutation:reconcile",
  requestReview: "workspace:review:request",
  requestCancellationReview: "workspace:review:cancel-request",
  reviewApprove: "review:decision:approve",
  reviewReject: "review:decision:reject",
  reviewSnapshot: "review:snapshot:get",
  snapshot: "workspace:snapshot:get",
  targetCreate: "workspace:target:create",
  targetDelete: "workspace:target:delete",
  targetUpdate: "workspace:target:update",
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
  endpoint: Pick<RegisteredEndpoint, "expectedUrl" | "role"> & {
    readonly webContentsId: number;
  },
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

  const authorized = (
    event: IpcMainInvokeEvent,
    role: RegisteredEndpoint["role"],
  ) => {
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
        await endpoint.session.request({
          targetId,
          type: "inventory.refresh",
          version: 1,
        }),
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
        await endpoint.session.request({
          operationId,
          type: "inventory.cancel",
          version: 1,
        }),
      );
    } catch {
      return internalFailure();
    }
  });
  input.ipcMain.handle(
    CHANNELS.compare,
    async (event, leftTargetId: unknown, rightTargetId: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            leftTargetId,
            rightTargetId,
            type: "comparison.open",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.comparisonPrepare,
    async (
      event,
      comparisonId: unknown,
      rowKey: unknown,
      destinationTargetId: unknown,
    ) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            comparisonId,
            destinationTargetId,
            rowKey,
            type: "comparison.prepare",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.collectionPrepare,
    async (event, request: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      const fields =
        typeof request === "object" && request !== null
          ? (request as Record<string, unknown>)
          : {};
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            collectionId: fields.collectionId,
            manifestDigest: fields.manifestDigest,
            releaseNumber: fields.releaseNumber,
            scope: fields.scope,
            selections: fields.selections,
            targetId: fields.targetId,
            type: "collection.prepare",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.collectionReview,
    async (event, collectionPlanId: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            collectionPlanId,
            type: "collection.review.request",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.collectionPrepareMany,
    async (event, request: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      const fields =
        typeof request === "object" && request !== null
          ? (request as Record<string, unknown>)
          : {};
      const targets = Array.isArray(fields.targets)
        ? fields.targets.map((target) => {
            const targetFields =
              typeof target === "object" && target !== null
                ? (target as Record<string, unknown>)
                : {};
            const selections = Array.isArray(targetFields.selections)
              ? targetFields.selections.map((selection) => {
                  const selectionFields =
                    typeof selection === "object" && selection !== null
                      ? (selection as Record<string, unknown>)
                      : {};
                  return {
                    mode: selectionFields.mode,
                    name: selectionFields.name,
                  };
                })
              : targetFields.selections;
            return {
              scope: targetFields.scope,
              selections,
              targetId: targetFields.targetId,
            };
          })
        : fields.targets;
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            collectionId: fields.collectionId,
            manifestDigest: fields.manifestDigest,
            releaseNumber: fields.releaseNumber,
            targets,
            type: "collection.prepare-many",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.targetCreate,
    async (event, definition: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            definition,
            type: "target.create",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.targetUpdate,
    async (event, targetId: unknown, definition: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            definition,
            targetId,
            type: "target.update",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.targetDelete,
    async (event, targetId: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            targetId,
            type: "target.delete",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.mutationPrepare,
    async (event, targetId: unknown, intent: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            intent,
            targetId,
            type: "mutation.prepare",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.mutationReconcile,
    async (event, targetId: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            targetId,
            type: "mutation.reconcile",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.hostTrustReview,
    async (event, targetId: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            targetId,
            type: "host-trust.review",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.requestReview,
    async (event, preparedMutationId: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            preparedMutationId,
            type: "review.request",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.requestCancellationReview,
    async (event, operationId: unknown) => {
      const endpoint = authorized(event, "workspace");
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            operationId,
            type: "review.cancel-request",
            version: 1,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(CHANNELS.reviewSnapshot, async (event) => {
    const endpoint = authorized(event, "review");
    if (endpoint === undefined) {
      return reviewSnapshotResultSchema.parse(authorizationFailure());
    }
    try {
      return reviewSnapshotResultSchema.parse({
        ok: true,
        value: reviewSnapshotSchema.parse(await endpoint.session.snapshot()),
      });
    } catch {
      return reviewSnapshotResultSchema.parse(internalFailure());
    }
  });
  const decideReview =
    (decision: "approve" | "reject") => async (event: IpcMainInvokeEvent) => {
      const endpoint = authorized(event, "review");
      if (endpoint === undefined) {
        return reviewDecisionResultSchema.parse(authorizationFailure());
      }
      try {
        return reviewDecisionResultSchema.parse(
          await endpoint.session.request({
            decision,
            type: "review.decide",
            version: 1,
          }),
        );
      } catch {
        return reviewDecisionResultSchema.parse(internalFailure());
      }
    };
  input.ipcMain.handle(CHANNELS.reviewApprove, decideReview("approve"));
  input.ipcMain.handle(CHANNELS.reviewReject, decideReview("reject"));

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
    reviewId?: string,
  ) => {
    detach(webContents.id);
    const session = input.capabilities.attach(
      {
        endpointId: String(webContents.id),
        reviewId,
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
      input.ipcMain.removeHandler(CHANNELS.hostTrustReview);
      input.ipcMain.removeHandler(CHANNELS.refresh);
      input.ipcMain.removeHandler(CHANNELS.cancel);
      input.ipcMain.removeHandler(CHANNELS.compare);
      input.ipcMain.removeHandler(CHANNELS.comparisonPrepare);
      input.ipcMain.removeHandler(CHANNELS.collectionPrepare);
      input.ipcMain.removeHandler(CHANNELS.collectionPrepareMany);
      input.ipcMain.removeHandler(CHANNELS.collectionReview);
      input.ipcMain.removeHandler(CHANNELS.targetCreate);
      input.ipcMain.removeHandler(CHANNELS.targetDelete);
      input.ipcMain.removeHandler(CHANNELS.targetUpdate);
      input.ipcMain.removeHandler(CHANNELS.reviewSnapshot);
      input.ipcMain.removeHandler(CHANNELS.mutationPrepare);
      input.ipcMain.removeHandler(CHANNELS.mutationReconcile);
      input.ipcMain.removeHandler(CHANNELS.requestReview);
      input.ipcMain.removeHandler(CHANNELS.requestCancellationReview);
      input.ipcMain.removeHandler(CHANNELS.reviewApprove);
      input.ipcMain.removeHandler(CHANNELS.reviewReject);
    },
  };
}
