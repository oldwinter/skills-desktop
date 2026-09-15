import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile } from "node:fs/promises";
import { basename, join, sep } from "node:path";

import type { Dialog } from "electron";

import {
  WELL_KNOWN_LIMITS,
  isValidArchivePath,
  type Result,
  type WellKnownExportFile,
  type WellKnownFileInput,
  type WellKnownSkillInput,
} from "@skills-desktop/skills-runtime";

import type {
  FolderPick,
  PublicationHost,
  PublicationHostError,
} from "../application/publication.js";

/**
 * ADR 0019 filesystem edge for export. Main owns both native folder dialogs;
 * the renderer receives a display label only. Reading follows no symbolic
 * links, skips dot-entries, and stops at the exporter limits so oversized or
 * hostile trees fail closed before any bytes reach the deterministic exporter.
 * Writing creates files exclusively inside a new or empty destination and
 * never touches anything that already exists.
 */

export interface NodePublicationHostOptions {
  readonly dialog: Pick<Dialog, "showOpenDialog">;
}

function invalid(message: string): Result<never, PublicationHostError> {
  return {
    error: {
      code: "export_invalid",
      effects: "none",
      message,
      phase: "export",
      retryable: false,
    },
    ok: false,
  };
}

async function readSkillFiles(
  skillRoot: string,
  skillName: string,
): Promise<Result<readonly WellKnownFileInput[], PublicationHostError>> {
  const files: WellKnownFileInput[] = [];
  let totalBytes = 0;
  const pending: string[] = [""];
  while (pending.length > 0) {
    const relative = pending.pop()!;
    const absolute = relative === "" ? skillRoot : join(skillRoot, relative);
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const childRelative =
        relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (!isValidArchivePath(childRelative)) {
        return invalid(
          `Skill "${skillName}" contains an unsupported path: ${childRelative}`,
        );
      }
      const childAbsolute = join(absolute, entry.name);
      const metadata = await lstat(childAbsolute);
      if (metadata.isSymbolicLink()) {
        return invalid(
          `Skill "${skillName}" contains a symbolic link: ${childRelative}`,
        );
      }
      if (metadata.isDirectory()) {
        pending.push(childRelative);
        continue;
      }
      if (!metadata.isFile()) {
        return invalid(
          `Skill "${skillName}" contains a special file: ${childRelative}`,
        );
      }
      if (metadata.size > WELL_KNOWN_LIMITS.maxFileBytes) {
        return invalid(
          `Skill "${skillName}" file exceeds ${WELL_KNOWN_LIMITS.maxFileBytes} bytes: ${childRelative}`,
        );
      }
      totalBytes += metadata.size;
      if (totalBytes > WELL_KNOWN_LIMITS.maxSkillBytes) {
        return invalid(
          `Skill "${skillName}" exceeds ${WELL_KNOWN_LIMITS.maxSkillBytes} bytes.`,
        );
      }
      if (files.length >= WELL_KNOWN_LIMITS.maxFilesPerSkill) {
        return invalid(
          `Skill "${skillName}" exceeds ${WELL_KNOWN_LIMITS.maxFilesPerSkill} files.`,
        );
      }
      files.push({
        bytes: new Uint8Array(await readFile(childAbsolute)),
        path: childRelative,
      });
    }
  }
  return { ok: true, value: files };
}

export async function readSkillFolder(
  root: string,
): Promise<Result<readonly WellKnownSkillInput[], PublicationHostError>> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return invalid("The chosen folder could not be read.");
  }
  const skills: WellKnownSkillInput[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const skillRoot = join(root, entry.name);
    const metadata = await lstat(skillRoot);
    if (!metadata.isDirectory()) continue;
    let skillMd;
    try {
      skillMd = await lstat(join(skillRoot, "SKILL.md"));
    } catch {
      continue;
    }
    if (!skillMd.isFile()) continue;
    if (skills.length >= WELL_KNOWN_LIMITS.maxSkills) {
      return invalid(
        `The folder contains more than ${WELL_KNOWN_LIMITS.maxSkills} Skills.`,
      );
    }
    const files = await readSkillFiles(skillRoot, entry.name);
    if (!files.ok) return files;
    skills.push({ files: files.value, name: entry.name });
  }
  if (skills.length === 0) {
    return invalid(
      "The chosen folder contains no Skill directories with a SKILL.md.",
    );
  }
  return { ok: true, value: skills };
}

export async function writeExportTree(
  destination: string,
  files: readonly WellKnownExportFile[],
): Promise<Result<void, PublicationHostError>> {
  try {
    await mkdir(destination, { recursive: true });
    const existing = await readdir(destination);
    if (existing.length > 0) {
      return invalid("Choose a new or empty folder for the export.");
    }
    for (const file of files) {
      const segments = file.path.split("/");
      const absolute = join(destination, ...segments);
      await mkdir(join(destination, ...segments.slice(0, -1)), {
        recursive: true,
      });
      const handle = await open(
        absolute,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o644,
      );
      try {
        await handle.writeFile(file.bytes);
      } finally {
        await handle.close();
      }
    }
    return { ok: true, value: undefined };
  } catch {
    return invalid("The export could not be written to the chosen folder.");
  }
}

function labelFor(path: string): string {
  const label = basename(path);
  return label.length > 0
    ? label
    : (path.split(sep).filter(Boolean).at(-1) ?? path);
}

export function createNodePublicationHost(
  options: NodePublicationHostOptions,
): PublicationHost {
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
    const path = selection.filePaths[0];
    if (selection.canceled || path === undefined) {
      return { status: "cancelled" };
    }
    return { label: labelFor(path), path, status: "picked" };
  };
  return {
    chooseExportDestination: () => choose("Export Skills", true),
    chooseSourceFolder: () => choose("Choose Skills Folder", false),
    readSourceFolder: readSkillFolder,
    writeExport: writeExportTree,
  };
}
