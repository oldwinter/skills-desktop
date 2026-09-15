import { open } from "node:fs/promises";
import { basename } from "node:path";

import type { Dialog } from "electron";

import { SKILLPACK_MAX_BYTES } from "@skills-desktop/skills-runtime";

import type {
  SkillpackPick,
  SkillpackPicker,
} from "../application/imported-packages.js";

/**
 * ADR 0017 offline import edge. The renderer never learns a path: main owns
 * the native dialog, reads at most one byte over the skillpack bound so the
 * codec can fail closed on oversize files, and forwards bytes plus a display
 * name only.
 */
export function createElectronSkillpackPicker(input: {
  readonly dialog: Pick<Dialog, "showOpenDialog">;
}): SkillpackPicker {
  return {
    async pick(): Promise<SkillpackPick> {
      const selection = await input.dialog.showOpenDialog({
        filters: [{ extensions: ["skillpack"], name: "Skillpack" }],
        properties: ["openFile", "dontAddToRecent"],
        title: "Import Skillpack",
      });
      const path = selection.filePaths[0];
      if (selection.canceled || path === undefined) {
        return { status: "cancelled" };
      }
      const handle = await open(path, "r");
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile()) {
          return {
            bytes: new Uint8Array(),
            fileName: basename(path),
            status: "selected",
          };
        }
        const capacity = SKILLPACK_MAX_BYTES + 1;
        const buffer = Buffer.alloc(capacity);
        let total = 0;
        while (total < capacity) {
          const { bytesRead } = await handle.read(
            buffer,
            total,
            capacity - total,
            total,
          );
          if (bytesRead === 0) break;
          total += bytesRead;
        }
        return {
          bytes: new Uint8Array(buffer.subarray(0, total)),
          fileName: basename(path),
          status: "selected",
        };
      } finally {
        await handle.close();
      }
    },
  };
}
