import {
  aboutReleaseDiagnosticsSchema,
  type AboutUpdateSnapshot,
  type RestartGuardReason,
} from "../../contracts/about.js";

const MAX_DIAGNOSTIC_BYTES = 16_384;

type AboutUpdateSnapshotV2 = Extract<
  AboutUpdateSnapshot,
  { readonly schemaVersion: 2 }
>;

export interface ReleaseDiagnosticsExporter {
  export(source: string): Promise<"cancelled" | "saved">;
}

export function serializeReleaseDiagnostics(input: {
  readonly exportedAt: Date;
  readonly guardReasons: readonly RestartGuardReason[];
  readonly snapshot: AboutUpdateSnapshotV2;
}) {
  const diagnostics = aboutReleaseDiagnosticsSchema.parse({
    application: input.snapshot.application,
    candidate: input.snapshot.candidate,
    errors:
      input.snapshot.state.kind === "error"
        ? [
            {
              code: input.snapshot.state.error.code,
              message: input.snapshot.state.error.message,
            },
          ]
        : [],
    exportedAt: input.exportedAt.toISOString(),
    guardReasons: input.guardReasons,
    restartState:
      input.guardReasons.length > 0 ? "blocked" : input.snapshot.restart.kind,
    schemaVersion: 1,
    updateState: input.snapshot.state.kind,
  });
  const source = `${JSON.stringify(diagnostics, null, 2)}\n`;
  if (Buffer.byteLength(source, "utf8") > MAX_DIAGNOSTIC_BYTES) {
    throw new Error("Release diagnostics exceeded the output limit.");
  }
  return source;
}
