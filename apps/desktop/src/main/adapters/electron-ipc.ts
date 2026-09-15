import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { ZodError } from "zod";

import {
  aboutDiagnosticsExportRequestSchema,
  aboutDiagnosticsExportResultSchema,
  aboutUpdateCheckRequestSchema,
  aboutUpdateRestartRequestSchema,
  aboutUpdateResultSchema,
  aboutUpdateSnapshotSchema,
  type AboutUpdateResult,
  type AboutUpdateSnapshot,
} from "../../contracts/about.js";
import { reviewWindowClosedEventSchema } from "../../contracts/desktop.js";
import {
  applicationMenuResultSchema,
  applicationMenuSchema,
  menuCommandEventSchema,
  type ApplicationMenu,
  type ApplicationMenuResult,
  type RendererMenuCommand,
} from "../../contracts/menu.js";
import {
  WORKSPACE_PROTOCOL_VERSION,
  desktopEventSchema,
  workspaceRequestResultSchema,
  workspaceSnapshotSchema,
  workspaceSnapshotResultSchema,
  type RendererError,
  type WorkspaceRequestResult,
} from "../../contracts/workspace.js";
import {
  REVIEW_PROTOCOL_VERSION,
  reviewDecisionResultSchema,
  reviewSnapshotResultSchema,
  reviewSnapshotSchema,
} from "../../contracts/review.js";
import type {
  DesktopCapabilities,
  DesktopSession,
} from "../application/desktop-capabilities.js";

const CHANNELS = {
  attachmentEpoch: "desktop:attachment-epoch",
  aboutCheck: "about:update:check",
  aboutDiagnosticsExport: "about:release-diagnostics:export",
  aboutEvent: "about:update:snapshot-changed",
  aboutRestart: "about:update:restart",
  aboutSnapshot: "about:update:snapshot:get",
  cancel: "workspace:inventory:cancel",
  compare: "workspace:comparison:open",
  comparisonPrepare: "workspace:comparison:prepare",
  collectionPrepare: "workspace:collection:prepare",
  collectionPrepareMany: "workspace:collection:prepare-many",
  collectionReview: "workspace:collection:review-request",
  packageImport: "workspace:package:import",
  publicationChooseSource: "workspace:publication:choose-source",
  publicationExport: "workspace:publication:export",
  publicationPrepare: "workspace:publication:prepare",
  publicationReview: "workspace:publication:review-request",
  publicationDiscard: "workspace:publication:discard",
  publicationReconcile: "workspace:publication:reconcile",
  event: "workspace:event",
  handoffSkillsSh: "workspace:handoff:skills-sh",
  updatePreferences: "workspace:preferences:update",
  reviewWindowClosed: "workspace:review-window:closed",
  hostTrustReview: "workspace:host-trust:review",
  refresh: "workspace:inventory:refresh",
  mutationPrepare: "workspace:mutation:prepare",
  mutationReconcile: "workspace:mutation:reconcile",
  sourceInspect: "workspace:source:inspect",
  requestReview: "workspace:review:request",
  requestCancellationReview: "workspace:review:cancel-request",
  reviewApprove: "review:decision:approve",
  reviewReject: "review:decision:reject",
  reviewSnapshot: "review:snapshot:get",
  menuCommand: "menu:command",
  menuGet: "menu:application:get",
  snapshot: "workspace:snapshot:get",
  targetCreate: "workspace:target:create",
  targetDelete: "workspace:target:delete",
  targetRepair: "workspace:target:repair",
  targetUpdate: "workspace:target:update",
} as const;

interface RegisteredEndpoint {
  readonly attachmentEpoch: string;
  readonly expectedUrl: string;
  readonly role: "review" | "workspace";
  readonly session: DesktopSession;
  readonly webContents: WebContents;
}

export interface DesktopIpcAttachment {
  readonly attachmentEpoch: string;
  readonly webContentsId: number;
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

function snapshotFailure(error: unknown): WorkspaceRequestResult {
  const invalidWorkspace =
    error instanceof ZodError &&
    error.issues.some((issue) => {
      const root = issue.path[0];
      const field = issue.path.at(-1);
      return (
        (root === "target" || root === "targets") &&
        (field === "workspace" || field === "workspaceLabel")
      );
    });
  if (!invalidWorkspace) return internalFailure();
  return {
    error: {
      code: "target_unavailable",
      effects: "none",
      message: "The saved workspace is invalid. Choose a workspace in Targets.",
      phase: "snapshot",
      retryable: false,
    },
    ok: false,
  };
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

function aboutFailure(
  code: "internal_error" | "invalid_request" | "unauthorized",
): AboutUpdateResult {
  const failure = {
    error: {
      code,
      message:
        code === "unauthorized"
          ? "This window cannot make that request."
          : code === "invalid_request"
            ? "The update request is not supported."
            : "The update request could not be completed.",
      retryable: code === "internal_error",
    },
    ok: false as const,
  };
  return aboutUpdateResultSchema.parse(failure);
}

function menuFailure(
  code: "internal_error" | "invalid_request" | "unauthorized",
): ApplicationMenuResult {
  return applicationMenuResultSchema.parse({
    error: {
      code,
      message:
        code === "unauthorized"
          ? "This window cannot make that request."
          : code === "invalid_request"
            ? "The menu request is not supported."
            : "The menu could not be read.",
      retryable: code === "internal_error",
    },
    ok: false,
  });
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
  /** Main-owned application menu projection (ADR 0023). */
  readonly menu?: {
    current(): ApplicationMenu;
  };
  readonly updates: {
    exportDiagnostics(): Promise<"cancelled" | "saved">;
    getSnapshot(): AboutUpdateSnapshot;
    requestCheck(): Promise<void>;
    requestRestart(
      candidateId: string,
    ): Promise<"blocked" | "cancelled" | "stale" | "started">;
    subscribe(listener: (snapshot: AboutUpdateSnapshot) => void): () => void;
  };
}) {
  const endpoints = new Map<number, RegisteredEndpoint>();

  const authorized = (
    event: IpcMainInvokeEvent,
    role: RegisteredEndpoint["role"],
    attachmentEpoch: unknown,
  ) => {
    const endpoint = endpoints.get(event.sender.id);
    const frame = event.senderFrame;
    if (
      endpoint === undefined ||
      attachmentEpoch !== endpoint.attachmentEpoch ||
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

  input.ipcMain.handle(
    CHANNELS.aboutSnapshot,
    async (event, attachmentEpoch: unknown, ...args) => {
      if (authorized(event, "workspace", attachmentEpoch) === undefined) {
        return aboutFailure("unauthorized");
      }
      if (args.length !== 0) return aboutFailure("invalid_request");
      try {
        return aboutUpdateResultSchema.parse({
          ok: true,
          value: aboutUpdateSnapshotSchema.parse(input.updates.getSnapshot()),
        });
      } catch {
        return aboutFailure("internal_error");
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.aboutCheck,
    async (event, attachmentEpoch: unknown, request: unknown, ...args) => {
      if (authorized(event, "workspace", attachmentEpoch) === undefined) {
        return aboutFailure("unauthorized");
      }
      if (
        args.length !== 0 ||
        !aboutUpdateCheckRequestSchema.safeParse(request).success
      ) {
        return aboutFailure("invalid_request");
      }
      try {
        await input.updates.requestCheck();
        return aboutUpdateResultSchema.parse({
          ok: true,
          value: aboutUpdateSnapshotSchema.parse(input.updates.getSnapshot()),
        });
      } catch {
        return aboutFailure("internal_error");
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.aboutRestart,
    async (event, attachmentEpoch: unknown, request: unknown, ...args) => {
      if (authorized(event, "workspace", attachmentEpoch) === undefined) {
        return aboutFailure("unauthorized");
      }
      const parsed = aboutUpdateRestartRequestSchema.safeParse(request);
      if (args.length !== 0 || !parsed.success) {
        return aboutFailure("invalid_request");
      }
      try {
        const outcome = await input.updates.requestRestart(
          parsed.data.candidateId,
        );
        if (outcome === "stale" || outcome === "cancelled") {
          return aboutFailure("invalid_request");
        }
        return aboutUpdateResultSchema.parse({
          ok: true,
          value: aboutUpdateSnapshotSchema.parse(input.updates.getSnapshot()),
        });
      } catch {
        return aboutFailure("internal_error");
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.aboutDiagnosticsExport,
    async (event, attachmentEpoch: unknown, request: unknown, ...args) => {
      if (authorized(event, "workspace", attachmentEpoch) === undefined) {
        return aboutDiagnosticsExportResultSchema.parse(
          aboutFailure("unauthorized"),
        );
      }
      if (
        args.length !== 0 ||
        !aboutDiagnosticsExportRequestSchema.safeParse(request).success
      ) {
        return aboutDiagnosticsExportResultSchema.parse(
          aboutFailure("invalid_request"),
        );
      }
      try {
        return aboutDiagnosticsExportResultSchema.parse({
          ok: true,
          value: { status: await input.updates.exportDiagnostics() },
        });
      } catch {
        return aboutDiagnosticsExportResultSchema.parse(
          aboutFailure("internal_error"),
        );
      }
    },
  );

  input.ipcMain.handle(
    CHANNELS.menuGet,
    async (event, attachmentEpoch: unknown, ...args) => {
      if (authorized(event, "workspace", attachmentEpoch) === undefined) {
        return menuFailure("unauthorized");
      }
      if (args.length !== 0) return menuFailure("invalid_request");
      if (input.menu === undefined) return menuFailure("internal_error");
      try {
        return applicationMenuResultSchema.parse({
          ok: true,
          value: applicationMenuSchema.parse(input.menu.current()),
        });
      } catch {
        return menuFailure("internal_error");
      }
    },
  );

  input.ipcMain.handle(CHANNELS.snapshot, async (event, attachmentEpoch) => {
    const endpoint = authorized(event, "workspace", attachmentEpoch);
    if (endpoint === undefined) {
      return workspaceSnapshotResultSchema.parse(authorizationFailure());
    }
    try {
      return workspaceSnapshotResultSchema.parse({
        ok: true,
        value: workspaceSnapshotSchema.parse(await endpoint.session.snapshot()),
      });
    } catch (error) {
      return workspaceSnapshotResultSchema.parse(snapshotFailure(error));
    }
  });
  input.ipcMain.handle(
    CHANNELS.refresh,
    async (event, attachmentEpoch: unknown, targetId: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            targetId,
            type: "inventory.refresh",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.cancel,
    async (event, attachmentEpoch: unknown, operationId: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            operationId,
            type: "inventory.cancel",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.compare,
    async (
      event,
      attachmentEpoch: unknown,
      leftTargetId: unknown,
      rightTargetId: unknown,
    ) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            leftTargetId,
            rightTargetId,
            type: "comparison.open",
            version: WORKSPACE_PROTOCOL_VERSION,
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
      attachmentEpoch: unknown,
      comparisonId: unknown,
      rowKey: unknown,
      destinationTargetId: unknown,
    ) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            comparisonId,
            destinationTargetId,
            rowKey,
            type: "comparison.prepare",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.collectionPrepare,
    async (event, attachmentEpoch: unknown, request: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
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
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.collectionReview,
    async (event, attachmentEpoch: unknown, collectionPlanId: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            collectionPlanId,
            type: "collection.review.request",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.collectionPrepareMany,
    async (event, attachmentEpoch: unknown, request: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
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
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.targetCreate,
    async (event, attachmentEpoch: unknown, definition: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            definition,
            type: "target.create",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.targetUpdate,
    async (
      event,
      attachmentEpoch: unknown,
      targetId: unknown,
      definition: unknown,
    ) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            definition,
            targetId,
            type: "target.update",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.targetDelete,
    async (event, attachmentEpoch: unknown, targetId: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            targetId,
            type: "target.delete",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.mutationPrepare,
    async (
      event,
      attachmentEpoch: unknown,
      targetId: unknown,
      intent: unknown,
    ) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            intent,
            targetId,
            type: "mutation.prepare",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.sourceInspect,
    async (
      event,
      attachmentEpoch: unknown,
      targetId: unknown,
      source: unknown,
    ) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            source,
            targetId,
            type: "source.inspect",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.mutationReconcile,
    async (event, attachmentEpoch: unknown, targetId: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            targetId,
            type: "mutation.reconcile",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.targetRepair,
    async (
      event,
      attachmentEpoch: unknown,
      targetId: unknown,
      harnessId: unknown,
    ) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            harnessId,
            targetId,
            type: "target.repair",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.packageImport,
    async (event, attachmentEpoch: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            type: "package.import",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  const publicationHandler =
    (build: (...args: readonly unknown[]) => Record<string, unknown>) =>
    async (
      event: IpcMainInvokeEvent,
      attachmentEpoch: unknown,
      ...args: unknown[]
    ) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            ...build(...args),
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    };
  input.ipcMain.handle(
    CHANNELS.publicationChooseSource,
    publicationHandler(() => ({ type: "publication.choose-source" })),
  );
  input.ipcMain.handle(
    CHANNELS.publicationExport,
    publicationHandler(() => ({ type: "publication.export" })),
  );
  input.ipcMain.handle(
    CHANNELS.publicationPrepare,
    publicationHandler((remote, branch) => ({
      branch,
      remote,
      type: "publication.prepare",
    })),
  );
  input.ipcMain.handle(
    CHANNELS.publicationReview,
    publicationHandler((planId) => ({
      planId,
      type: "publication.review.request",
    })),
  );
  input.ipcMain.handle(
    CHANNELS.publicationDiscard,
    publicationHandler((planId) => ({ planId, type: "publication.discard" })),
  );
  input.ipcMain.handle(
    CHANNELS.publicationReconcile,
    publicationHandler(() => ({ type: "publication.reconcile" })),
  );
  input.ipcMain.handle(
    CHANNELS.handoffSkillsSh,
    async (event, attachmentEpoch: unknown, recordId: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            recordId,
            type: "handoff.skills-sh",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.updatePreferences,
    async (event, attachmentEpoch: unknown, patch: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            patch,
            type: "preferences.update",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.hostTrustReview,
    async (event, attachmentEpoch: unknown, targetId: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            targetId,
            type: "host-trust.review",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.requestReview,
    async (event, attachmentEpoch: unknown, preparedMutationId: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            preparedMutationId,
            type: "review.request",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.requestCancellationReview,
    async (event, attachmentEpoch: unknown, operationId: unknown) => {
      const endpoint = authorized(event, "workspace", attachmentEpoch);
      if (endpoint === undefined) return authorizationFailure();
      try {
        return workspaceRequestResultSchema.parse(
          await endpoint.session.request({
            operationId,
            type: "review.cancel-request",
            version: WORKSPACE_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return internalFailure();
      }
    },
  );
  input.ipcMain.handle(
    CHANNELS.reviewSnapshot,
    async (event, attachmentEpoch) => {
      const endpoint = authorized(event, "review", attachmentEpoch);
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
    },
  );
  const decideReview =
    (decision: "approve" | "reject") =>
    async (event: IpcMainInvokeEvent, attachmentEpoch: unknown) => {
      const endpoint = authorized(event, "review", attachmentEpoch);
      if (endpoint === undefined) {
        return reviewDecisionResultSchema.parse(authorizationFailure());
      }
      try {
        return reviewDecisionResultSchema.parse(
          await endpoint.session.request({
            decision,
            type: "review.decide",
            version: REVIEW_PROTOCOL_VERSION,
          }),
        );
      } catch {
        return reviewDecisionResultSchema.parse(internalFailure());
      }
    };
  input.ipcMain.handle(CHANNELS.reviewApprove, decideReview("approve"));
  input.ipcMain.handle(CHANNELS.reviewReject, decideReview("reject"));

  const unsubscribeUpdates = input.updates.subscribe((snapshot) => {
    const parsed = aboutUpdateSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) return;
    for (const endpoint of endpoints.values()) {
      if (
        endpoint.role === "workspace" &&
        !endpoint.webContents.isDestroyed()
      ) {
        endpoint.webContents.send(CHANNELS.aboutEvent, parsed.data);
      }
    }
  });

  const notifyReviewWindowClosed = (
    reviewId: string,
    owner: DesktopIpcAttachment,
  ) => {
    const parsed = reviewWindowClosedEventSchema.safeParse({
      reviewId,
      schemaVersion: 1,
    });
    if (!parsed.success) return;
    const endpoint = endpoints.get(owner.webContentsId);
    if (
      endpoint?.role !== "workspace" ||
      endpoint.attachmentEpoch !== owner.attachmentEpoch ||
      endpoint.webContents.isDestroyed()
    )
      return;
    try {
      endpoint.webContents.send(CHANNELS.reviewWindowClosed, parsed.data);
    } catch {
      // The lifecycle hint is lossy when its owning renderer is being disposed.
    }
  };

  /**
   * Relay one menu activation to the workspace renderer that owns
   * `owner`. The renderer then issues the same closed Workspace v2 request
   * its own control would; main never invents a request on its behalf.
   */
  const notifyMenuCommand = (
    command: RendererMenuCommand,
    owner: DesktopIpcAttachment,
  ) => {
    const parsed = menuCommandEventSchema.safeParse({
      command,
      schemaVersion: 1,
    });
    if (!parsed.success) return false;
    const endpoint = endpoints.get(owner.webContentsId);
    if (
      endpoint?.role !== "workspace" ||
      endpoint.attachmentEpoch !== owner.attachmentEpoch ||
      endpoint.webContents.isDestroyed()
    )
      return false;
    try {
      endpoint.webContents.send(CHANNELS.menuCommand, parsed.data);
      return true;
    } catch {
      return false;
    }
  };

  const detach = (webContentsId: number) => {
    const prior = endpoints.get(webContentsId);
    if (prior === undefined) return;
    endpoints.delete(webContentsId);
    prior.session.teardown();
  };

  const attach = (
    webContents: WebContents,
    role: RegisteredEndpoint["role"],
    expectedUrl: string,
    reviewId?: string,
  ) => {
    detach(webContents.id);
    const attachmentEpoch = input.newEpoch();
    const session = input.capabilities.attach(
      {
        endpointId: String(webContents.id),
        reviewId,
        role,
        sessionEpoch: input.newEpoch(),
      },
      (event) => {
        if (
          !webContents.isDestroyed() &&
          endpoints.get(webContents.id)?.attachmentEpoch === attachmentEpoch
        ) {
          webContents.send(CHANNELS.event, desktopEventSchema.parse(event));
        }
      },
    );
    if (webContents.isDestroyed()) {
      session.teardown();
      return;
    }
    endpoints.set(webContents.id, {
      attachmentEpoch,
      expectedUrl,
      role,
      session,
      webContents,
    });
    try {
      webContents.send(CHANNELS.attachmentEpoch, attachmentEpoch);
    } catch {
      detach(webContents.id);
      return undefined;
    }
    return { attachmentEpoch, webContentsId: webContents.id };
  };

  return {
    attach,
    detach,
    notifyMenuCommand,
    notifyReviewWindowClosed,
    dispose() {
      unsubscribeUpdates();
      for (const webContentsId of endpoints.keys()) detach(webContentsId);
      input.ipcMain.removeHandler(CHANNELS.menuGet);
      input.ipcMain.removeHandler(CHANNELS.aboutSnapshot);
      input.ipcMain.removeHandler(CHANNELS.aboutCheck);
      input.ipcMain.removeHandler(CHANNELS.aboutRestart);
      input.ipcMain.removeHandler(CHANNELS.aboutDiagnosticsExport);
      input.ipcMain.removeHandler(CHANNELS.snapshot);
      input.ipcMain.removeHandler(CHANNELS.hostTrustReview);
      input.ipcMain.removeHandler(CHANNELS.refresh);
      input.ipcMain.removeHandler(CHANNELS.cancel);
      input.ipcMain.removeHandler(CHANNELS.compare);
      input.ipcMain.removeHandler(CHANNELS.comparisonPrepare);
      input.ipcMain.removeHandler(CHANNELS.collectionPrepare);
      input.ipcMain.removeHandler(CHANNELS.collectionPrepareMany);
      input.ipcMain.removeHandler(CHANNELS.collectionReview);
      input.ipcMain.removeHandler(CHANNELS.packageImport);
      input.ipcMain.removeHandler(CHANNELS.publicationChooseSource);
      input.ipcMain.removeHandler(CHANNELS.publicationExport);
      input.ipcMain.removeHandler(CHANNELS.publicationPrepare);
      input.ipcMain.removeHandler(CHANNELS.publicationReview);
      input.ipcMain.removeHandler(CHANNELS.publicationDiscard);
      input.ipcMain.removeHandler(CHANNELS.publicationReconcile);
      input.ipcMain.removeHandler(CHANNELS.targetCreate);
      input.ipcMain.removeHandler(CHANNELS.targetDelete);
      input.ipcMain.removeHandler(CHANNELS.targetRepair);
      input.ipcMain.removeHandler(CHANNELS.handoffSkillsSh);
      input.ipcMain.removeHandler(CHANNELS.updatePreferences);
      input.ipcMain.removeHandler(CHANNELS.targetUpdate);
      input.ipcMain.removeHandler(CHANNELS.reviewSnapshot);
      input.ipcMain.removeHandler(CHANNELS.mutationPrepare);
      input.ipcMain.removeHandler(CHANNELS.mutationReconcile);
      input.ipcMain.removeHandler(CHANNELS.sourceInspect);
      input.ipcMain.removeHandler(CHANNELS.requestReview);
      input.ipcMain.removeHandler(CHANNELS.requestCancellationReview);
      input.ipcMain.removeHandler(CHANNELS.reviewApprove);
      input.ipcMain.removeHandler(CHANNELS.reviewReject);
    },
  };
}
