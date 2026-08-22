import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createElectronReleaseDiagnosticsExporter } from "./electron-release-diagnostics.js";

describe("Electron release diagnostics exporter", () => {
  it("writes bounded contents only to the main-dialog-selected destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skills-diagnostics-"));
    const path = join(directory, "release-diagnostics.json");
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: path }));
    try {
      const exporter = createElectronReleaseDiagnosticsExporter({
        dialog: { showSaveDialog },
      });
      const source = '{"schemaVersion":1}\n';

      await expect(exporter.export(source)).resolves.toBe("saved");

      expect(showSaveDialog).toHaveBeenCalledWith({
        defaultPath: "skills-desktop-release-diagnostics.json",
        filters: [{ extensions: ["json"], name: "JSON" }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
        title: "Export Release Diagnostics",
      });
      await expect(readFile(path, "utf8")).resolves.toBe(source);
      if (process.platform !== "win32") {
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("returns cancellation without writing or exposing a path", async () => {
    const showSaveDialog = vi.fn(async () => ({ canceled: true, filePath: "" }));
    const exporter = createElectronReleaseDiagnosticsExporter({
      dialog: { showSaveDialog },
    });

    await expect(exporter.export('{"schemaVersion":1}\n')).resolves.toBe(
      "cancelled",
    );
  });

  it("rejects oversized output before opening a dialog", async () => {
    const showSaveDialog = vi.fn();
    const exporter = createElectronReleaseDiagnosticsExporter({
      dialog: { showSaveDialog },
    });

    await expect(exporter.export("x".repeat(16_385))).rejects.toThrow();
    expect(showSaveDialog).not.toHaveBeenCalled();
  });
});
