import { chmod, writeFile } from "node:fs/promises";

import type { Dialog } from "electron";

const MAX_DIAGNOSTIC_BYTES = 16_384;

export function createElectronReleaseDiagnosticsExporter(input: {
  readonly dialog: Pick<Dialog, "showSaveDialog">;
}) {
  return {
    async export(source: string): Promise<"cancelled" | "saved"> {
      if (Buffer.byteLength(source, "utf8") > MAX_DIAGNOSTIC_BYTES) {
        throw new Error("Release diagnostics exceeded the output limit.");
      }
      const selection = await input.dialog.showSaveDialog({
        defaultPath: "skills-desktop-release-diagnostics.json",
        filters: [{ extensions: ["json"], name: "JSON" }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
        title: "Export Release Diagnostics",
      });
      if (selection.canceled || selection.filePath === undefined) {
        return "cancelled";
      }
      await writeFile(selection.filePath, source, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(selection.filePath, 0o600);
      return "saved";
    },
  };
}
