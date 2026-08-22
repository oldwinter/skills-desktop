export const STARTUP_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export interface UpdateClock {
  now(): Date;
}

export interface UpdateCheckRecords {
  load(): Promise<string | null>;
  save(checkedAt: string): Promise<void>;
}

export interface UpdateScheduler {
  after(
    delayMs: number,
    action: () => void | Promise<void>,
  ): () => void;
}

export interface UpdateAdapter {
  checkForUpdates(input: {
    readonly feedUrl: string;
    readonly onEvent: (
      event: UpdateAdapterEvent,
    ) => void | Promise<void>;
  }): void;
  restartAndInstall?(): void;
}

export type UpdateAdapterEvent =
  | { readonly type: "checking" }
  | { readonly error?: unknown; readonly type: "error" }
  | { readonly type: "update-available" }
  | {
      readonly candidateVersion?: string;
      readonly type: "update-downloaded";
    }
  | { readonly type: "update-not-available" };
