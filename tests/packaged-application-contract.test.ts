import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as plist from "plist";
import { afterEach, describe, expect, it } from "vitest";

import { verifyPackagedApplication } from "../scripts/release/packaged-application-contract.mjs";

const temporaryDirectories: string[] = [];
const helpers = [
  "Skills Desktop Helper (GPU).app",
  "Skills Desktop Helper (Plugin).app",
  "Skills Desktop Helper (Renderer).app",
  "Skills Desktop Helper.app",
];

async function darwinBundleFixture() {
  const root = await mkdtemp(join(tmpdir(), "skills-packaged-app-"));
  temporaryDirectories.push(root);
  const forgeOutDirectory = join(root, "out");
  const contents = join(
    forgeOutDirectory,
    "Skills Desktop-darwin-arm64",
    "Skills Desktop.app",
    "Contents",
  );
  const frameworks = join(contents, "Frameworks");
  const resources = join(contents, "Resources");
  const iconPath = join(root, "app-icon.icns");
  await Promise.all([
    mkdir(frameworks, { recursive: true }),
    mkdir(resources, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(contents, "Info.plist"),
      plist.build({ CFBundleIconFile: "electron.icns" }),
    ),
    writeFile(iconPath, "verified-icon-bytes"),
    writeFile(join(resources, "electron.icns"), "verified-icon-bytes"),
    ...helpers.map(async (helper) => {
      const helperContents = join(frameworks, helper, "Contents");
      await mkdir(helperContents, { recursive: true });
      await writeFile(
        join(helperContents, "Info.plist"),
        plist.build({ LSBackgroundOnly: true, LSUIElement: true }),
      );
    }),
  ]);
  return { forgeOutDirectory, iconPath, resources };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("packaged application contract", () => {
  it("binds the macOS icon bytes and hides every required Helper", async () => {
    const fixture = await darwinBundleFixture();

    await expect(
      verifyPackagedApplication({
        architecture: "arm64",
        ...fixture,
        platform: "darwin",
      }),
    ).resolves.toEqual({
      helperCount: 4,
      iconSha256:
        "2294a230bc52254356abcd48b56a9b376ce1380da5c051b5a86b65eacc2eb2f4",
      platform: "darwin",
    });
  });

  it("rejects a default or otherwise mismatched macOS icon", async () => {
    const fixture = await darwinBundleFixture();
    await writeFile(join(fixture.resources, "electron.icns"), "wrong-icon");

    await expect(
      verifyPackagedApplication({
        architecture: "arm64",
        ...fixture,
        platform: "darwin",
      }),
    ).rejects.toThrow("The packaged macOS application icon is incorrect.");
  });

  it("rejects a user-visible macOS Helper", async () => {
    const fixture = await darwinBundleFixture();
    await writeFile(
      join(
        fixture.forgeOutDirectory,
        "Skills Desktop-darwin-arm64",
        "Skills Desktop.app",
        "Contents",
        "Frameworks",
        helpers[0],
        "Contents",
        "Info.plist",
      ),
      plist.build({ LSUIElement: true }),
    );

    await expect(
      verifyPackagedApplication({
        architecture: "arm64",
        ...fixture,
        platform: "darwin",
      }),
    ).rejects.toThrow("A packaged macOS Helper is user-visible.");
  });
});
