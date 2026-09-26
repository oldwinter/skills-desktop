import type {
  RendererError,
  WorkspaceBridge,
} from "../../../contracts/workspace.js";

export const STUDIO_AUTOSAVE_DELAY_MS = 400;

export interface DraftSession {
  readonly conflict: boolean;
  readonly draftId: string;
  readonly revision: number;
  readonly savedText: string;
  readonly saving: boolean;
  readonly text: string;
}

/**
 * Draft edit sessions belong to the bridge, not to one mounted Studio view:
 * leaving the view flushes pending text through this owner's serialized save
 * chain and returning reconnects the editor to the same pending text,
 * acknowledged revision, and in-flight save. Autosave debounce is tracked per
 * Draft so an unrelated snapshot or a sibling Draft's edits never postpone an
 * idle Draft's deadline.
 */
export class StudioDraftSessions {
  /** Session view emitted to subscribers; replaced on every mutation. */
  snapshot: ReadonlyMap<string, DraftSession> = new Map();
  /** Save outcomes surface through whichever Studio view is mounted. */
  onError: ((error: RendererError | undefined) => void) | undefined;

  private readonly chains = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private readonly sessions = new Map<string, DraftSession>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly client: WorkspaceBridge) {}

  readonly getSnapshot = (): ReadonlyMap<string, DraftSession> =>
    this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  draftIds(): IterableIterator<string> {
    return this.sessions.keys();
  }

  session(draftId: string): DraftSession | undefined {
    return this.sessions.get(draftId);
  }

  write(draftId: string, session: DraftSession): void {
    if (session.conflict) this.cancelAutosave(draftId);
    this.sessions.set(draftId, session);
    this.emit();
  }

  drop(draftId: string): void {
    this.cancelAutosave(draftId);
    if (this.sessions.delete(draftId)) this.emit();
  }

  /** Arm (or re-arm) this Draft's debounce; other Drafts keep their own. */
  scheduleAutosave(draftId: string): void {
    this.cancelAutosave(draftId);
    this.timers.set(
      draftId,
      setTimeout(() => {
        this.timers.delete(draftId);
        this.enqueueSave(draftId);
      }, STUDIO_AUTOSAVE_DELAY_MS),
    );
  }

  cancelAutosave(draftId: string): void {
    const timer = this.timers.get(draftId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(draftId);
  }

  /** Skip the debounce and queue a save on the Draft's chain now. */
  flushSave(draftId: string): void {
    this.cancelAutosave(draftId);
    this.enqueueSave(draftId);
  }

  private enqueueSave(draftId: string): void {
    const chain = this.chains.get(draftId) ?? Promise.resolve();
    const next = chain
      .then(() => this.saveDraftNow(draftId))
      .catch(() => undefined);
    this.chains.set(draftId, next);
  }

  private async saveDraftNow(draftId: string): Promise<void> {
    const session = this.sessions.get(draftId);
    if (
      session === undefined ||
      session.conflict ||
      session.saving ||
      session.text === session.savedText
    ) {
      return;
    }
    this.write(draftId, { ...session, saving: true });
    const { revision, text } = session;
    const result = await this.client
      .saveStudioDraft(draftId, revision, text)
      .catch(() => undefined);
    const latest = this.sessions.get(draftId);
    if (latest === undefined || !latest.saving) return;
    if (result === undefined) {
      this.write(draftId, { ...latest, saving: false });
    } else if (result.ok) {
      this.write(draftId, {
        ...latest,
        revision: revision + 1,
        savedText: text,
        saving: false,
      });
      this.onError?.(undefined);
    } else if (result.error.code === "studio_draft_conflict") {
      this.write(draftId, { ...latest, conflict: true, saving: false });
    } else {
      this.write(draftId, { ...latest, saving: false });
      this.onError?.(result.error);
    }
    const settled = this.sessions.get(draftId);
    if (
      settled !== undefined &&
      !settled.conflict &&
      !settled.saving &&
      settled.text !== settled.savedText
    ) {
      this.scheduleAutosave(draftId);
    }
  }

  private emit(): void {
    this.snapshot = new Map(this.sessions);
    for (const listener of this.listeners) listener();
  }
}

const owners = new WeakMap<WorkspaceBridge, StudioDraftSessions>();

export function studioDraftSessionsFor(
  client: WorkspaceBridge,
): StudioDraftSessions {
  let owner = owners.get(client);
  if (owner === undefined) {
    owner = new StudioDraftSessions(client);
    owners.set(client, owner);
  }
  return owner;
}
