import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SkillpackPick } from "../application/imported-packages.js";

import { createElectronSkillpackPicker } from "./electron-skillpack-picker.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "skills-desktop-pick-"));
  temporaryDirectories.push(directory);
  return directory;
}

function pickerReturning(filePaths: string[]) {
  return createElectronSkillpackPicker({
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths })),
    } as never,
  });
}

async function boundedPick(pending: Promise<SkillpackPick>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending.then(
        (value) => ({ kind: "resolved" as const, value }),
        (error: unknown) => ({ error, kind: "rejected" as const }),
      ),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function releaseFifo(path: string) {
  // An O_RDWR|O_NONBLOCK open pairs a writer with a blocked reader so a
  // regressed pick() settles instead of leaking past teardown.
  const handle = await open(
    path,
    constants.O_RDWR | (constants.O_NONBLOCK ?? 0),
  ).catch(() => undefined);
  await handle?.close();
}

describe("electron skillpack picker", () => {
  it("reports a dismissed dialog as cancelled", async () => {
    const picker = createElectronSkillpackPicker({
      dialog: {
        showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      } as never,
    });

    await expect(picker.pick()).resolves.toEqual({ status: "cancelled" });
  });

  it("forwards a picked regular file's bytes and basename", async () => {
    const directory = await createDirectory();
    const path = join(directory, "kit.skillpack");
    await writeFile(path, new Uint8Array([1, 2, 3]));

    await expect(pickerReturning([path]).pick()).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "kit.skillpack",
      status: "selected",
    });
  });

  it("returns empty bytes for a picked directory", async () => {
    const directory = await createDirectory();
    const picked = join(directory, "dir.skillpack");
    await mkdir(picked);

    await expect(pickerReturning([picked]).pick()).resolves.toEqual({
      bytes: new Uint8Array(),
      fileName: "dir.skillpack",
      status: "selected",
    });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a picked FIFO without waiting for a writer",
    async () => {
      const directory = await createDirectory();
      const fifoPath = join(directory, "pipe.skillpack");
      execFileSync("mkfifo", [fifoPath]);

      const outcome = await boundedPick(pickerReturning([fifoPath]).pick(), 2_000);

      if (outcome.kind === "timeout") await releaseFifo(fifoPath);
      expect(outcome).toMatchObject({
        kind: "resolved",
        value: {
          bytes: new Uint8Array(),
          fileName: "pipe.skillpack",
          status: "selected",
        },
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a symlink to a FIFO without waiting for a writer",
    async () => {
      const directory = await createDirectory();
      const fifoPath = join(directory, "target.fifo");
      const linkPath = join(directory, "linked.skillpack");
      execFileSync("mkfifo", [fifoPath]);
      await symlink(fifoPath, linkPath);

      const outcome = await boundedPick(pickerReturning([linkPath]).pick(), 2_000);

      if (outcome.kind === "timeout") await releaseFifo(fifoPath);
      expect(outcome).toMatchObject({
        kind: "resolved",
        value: {
          bytes: new Uint8Array(),
          fileName: "linked.skillpack",
          status: "selected",
        },
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "still follows a symlink to a regular file",
    async () => {
      const directory = await createDirectory();
      const target = join(directory, "real.skillpack");
      const linkPath = join(directory, "linked.skillpack");
      await writeFile(target, new Uint8Array([9, 8, 7]));
      await symlink(target, linkPath);

      await expect(pickerReturning([linkPath]).pick()).resolves.toEqual({
        bytes: new Uint8Array([9, 8, 7]),
        fileName: "linked.skillpack",
        status: "selected",
      });
    },
  );
});
