import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";

import type { Dialog } from "electron";

import {
  STUDIO_VALIDATOR_PROFILE,
  isValidArchivePath,
  isValidSkillName,
  type Result,
  type StudioTreeEntry,
} from "@skills-desktop/skills-runtime";

import type { RendererError } from "../../contracts/workspace.js";
import type { FolderPick } from "../application/publication.js";
import type { StudioExportFile, StudioHost } from "../application/studio.js";

/**
 * ADR 0018 filesystem edge for Studio. Observation follows no links and
 * reads bytes only from bounded regular files; everything else is reported
 * by kind so the pure validator can fail closed. Export writes an owned
 * sibling temporary tree next to the destination, verifies every byte it
 * wrote, flushes, and commits with a rename that never replaces an existing
 * non-empty path. Any failure removes only the temporary tree.
 */

export interface NodeStudioHostOptions {
  readonly dialog: Pick<Dialog, "showOpenDialog">;
}

function studioError(
  code: RendererError["code"],
  message: string,
  phase: string,
  effects: RendererError["effects"] = "none",
): Result<never, RendererError> {
  return {
    error: { code, effects, message, phase, retryable: false },
    ok: false,
  };
}

const ignored = new Set<string>(STUDIO_VALIDATOR_PROFILE.ignoredEntries);

export async function readStudioTree(
  root: string,
): Promise<Result<readonly StudioTreeEntry[], RendererError>> {
  const limits = STUDIO_VALIDATOR_PROFILE.limits;
  const entries: StudioTreeEntry[] = [];
  let readBytes = 0;
  const pending: string[] = [""];
  try {
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory()) {
      return studioError(
        "studio_grant_invalid",
        "The granted root is not a directory.",
        "observe",
      );
    }
    while (pending.length > 0) {
      const relative = pending.pop()!;
      const absolute = relative === "" ? root : join(root, relative);
      const children = await readdir(absolute, { withFileTypes: true });
      for (const child of children) {
        if (ignored.has(child.name)) continue;
        const childRelative =
          relative === "" ? child.name : `${relative}/${child.name}`;
        if (entries.length > limits.maxFilesPerSkill) {
          return { ok: true, value: entries };
        }
        const metadata = await lstat(join(absolute, child.name));
        if (metadata.isSymbolicLink()) {
          entries.push({ kind: "symlink", path: childRelative, size: 0 });
          continue;
        }
        if (metadata.isDirectory()) {
          entries.push({ kind: "directory", path: childRelative, size: 0 });
          pending.push(childRelative);
          continue;
        }
        if (!metadata.isFile()) {
          entries.push({ kind: "special", path: childRelative, size: 0 });
          continue;
        }
        if (metadata.nlink > 1) {
          entries.push({
            kind: "hardlink",
            path: childRelative,
            size: metadata.size,
          });
          continue;
        }
        const withinBounds =
          metadata.size <= limits.maxFileBytes &&
          readBytes + metadata.size <= limits.maxSkillBytes &&
          isValidArchivePath(childRelative);
        if (!withinBounds) {
          entries.push({
            kind: "file",
            path: childRelative,
            size: metadata.size,
          });
          continue;
        }
        const bytes = new Uint8Array(
          await readFile(join(absolute, child.name)),
        );
        readBytes += bytes.byteLength;
        entries.push({
          bytes,
          kind: "file",
          path: childRelative,
          size: bytes.byteLength,
        });
      }
    }
  } catch {
    return studioError(
      "studio_grant_invalid",
      "The granted folder could not be read.",
      "observe",
    );
  }
  return { ok: true, value: entries };
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } catch {
    // Some filesystems refuse fsync on directories; the rename still commits.
  } finally {
    await handle.close();
  }
}

export async function exportStudioSkill(
  parent: string,
  name: string,
  files: readonly StudioExportFile[],
): Promise<Result<{ readonly fileCount: number }, RendererError>> {
  if (!isValidSkillName(name)) {
    return studioError("studio_export_failed", "Invalid Skill name.", "export");
  }
  if (
    files.length === 0 ||
    files.some(({ path }) => !isValidArchivePath(path))
  ) {
    return studioError(
      "studio_export_failed",
      "The export contains an unsupported path.",
      "export",
    );
  }
  const destination = join(parent, name);
  const exists = await lstat(destination).then(
    () => true,
    () => false,
  );
  if (exists) {
    return studioError(
      "studio_export_failed",
      `"${name}" already exists in the chosen folder; Studio never overwrites.`,
      "export",
    );
  }
  const temporary = join(
    parent,
    `.skills-studio-${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await mkdir(temporary, { mode: 0o700 });
  } catch {
    return studioError(
      "studio_export_failed",
      "The chosen folder is not writable.",
      "export",
    );
  }
  try {
    for (const file of files) {
      const segments = file.path.split("/");
      const absolute = join(temporary, ...segments);
      if (segments.length > 1) {
        await mkdir(join(temporary, ...segments.slice(0, -1)), {
          recursive: true,
        });
      }
      const handle = await open(
        absolute,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o644,
      );
      try {
        await handle.writeFile(file.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    for (const file of files) {
      const written = new Uint8Array(
        await readFile(join(temporary, ...file.path.split("/"))),
      );
      if (digest(written) !== digest(file.bytes)) {
        throw new Error("verification failed");
      }
    }
    await syncDirectory(temporary);
    const raced = await lstat(destination).then(
      () => true,
      () => false,
    );
    if (raced) {
      throw new Error("destination appeared during export");
    }
    await rename(temporary, destination);
    await syncDirectory(dirname(destination));
    return { ok: true, value: { fileCount: files.length } };
  } catch (error) {
    await rm(temporary, { force: true, recursive: true }).catch(
      () => undefined,
    );
    const raced =
      error instanceof Error && error.message.includes("destination appeared");
    return studioError(
      "studio_export_failed",
      raced
        ? `"${name}" appeared while exporting; nothing was written there.`
        : "The export could not be completed; no partial Skill was left behind.",
      "export",
    );
  }
}

function labelFor(path: string): string {
  const label = basename(path);
  return label.length > 0
    ? label
    : (path.split(sep).filter(Boolean).at(-1) ?? path);
}

export function createNodeStudioHost(
  options: NodeStudioHostOptions,
): StudioHost {
  const choose = async (
    title: string,
    create: boolean,
  ): Promise<FolderPick> => {
    const selection = await options.dialog.showOpenDialog({
      properties: [
        "openDirectory",
        "dontAddToRecent",
        ...(create ? (["createDirectory"] as const) : []),
      ],
      title,
    });
    const picked = selection.filePaths[0];
    if (selection.canceled || picked === undefined) {
      return { status: "cancelled" };
    }
    let canonical: string;
    try {
      canonical = await realpath(picked);
    } catch {
      return { status: "cancelled" };
    }
    return { label: labelFor(canonical), path: canonical, status: "picked" };
  };
  return {
    chooseExportParent: () => choose("Export Skill Into Folder", true),
    chooseSkillFolder: () => choose("Open Skill Folder", false),
    exportSkill: exportStudioSkill,
    readTree: readStudioTree,
  };
}
