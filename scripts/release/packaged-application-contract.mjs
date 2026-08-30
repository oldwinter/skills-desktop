import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import * as plist from "plist";

const DARWIN_HELPERS = [
  "Skills Desktop Helper (GPU).app",
  "Skills Desktop Helper (Plugin).app",
  "Skills Desktop Helper (Renderer).app",
  "Skills Desktop Helper.app",
];

function parsePlist(bytes, message) {
  try {
    const parsed = plist.parse(bytes.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(message);
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    throw new Error(message, { cause: error });
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function verifyPackagedApplication({
  architecture,
  forgeOutDirectory,
  iconPath,
  platform,
}) {
  if (platform !== "darwin") return { platform };

  const appDirectory = join(
    forgeOutDirectory,
    `Skills Desktop-darwin-${architecture}`,
    "Skills Desktop.app",
  );
  const contentsDirectory = join(appDirectory, "Contents");
  const appInfo = parsePlist(
    await readFile(join(contentsDirectory, "Info.plist")),
    "The packaged macOS application plist is invalid.",
  );
  if (
    typeof appInfo.CFBundleIconFile !== "string" ||
    appInfo.CFBundleIconFile.length === 0
  ) {
    throw new Error("The packaged macOS application icon is missing.");
  }

  const [expectedIcon, packagedIcon] = await Promise.all([
    readFile(iconPath),
    readFile(
      join(contentsDirectory, "Resources", appInfo.CFBundleIconFile),
    ),
  ]);
  if (!expectedIcon.equals(packagedIcon)) {
    throw new Error("The packaged macOS application icon is incorrect.");
  }

  const frameworksDirectory = join(contentsDirectory, "Frameworks");
  const frameworkEntries = await readdir(frameworksDirectory, {
    withFileTypes: true,
  });
  const helperNames = frameworkEntries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith("Skills Desktop Helper") &&
        entry.name.endsWith(".app"),
    )
    .map((entry) => entry.name)
    .sort();
  if (helperNames.join("\n") !== DARWIN_HELPERS.join("\n")) {
    throw new Error("The packaged macOS Helper set is invalid.");
  }
  for (const helperName of helperNames) {
    const helperInfo = parsePlist(
      await readFile(
        join(frameworksDirectory, helperName, "Contents", "Info.plist"),
      ),
      "A packaged macOS Helper plist is invalid.",
    );
    if (
      helperInfo.LSBackgroundOnly !== true ||
      helperInfo.LSUIElement !== true
    ) {
      throw new Error("A packaged macOS Helper is user-visible.");
    }
  }

  return {
    helperCount: helperNames.length,
    iconSha256: sha256(packagedIcon),
    platform,
  };
}
