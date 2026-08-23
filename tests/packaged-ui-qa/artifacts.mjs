import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function persistFailureArtifacts(fixture, error, destination) {
  if (typeof destination !== "string" || destination.length === 0) return false;
  await mkdir(destination, { recursive: true });
  await writeFile(
    join(destination, "error.txt"),
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  for (const name of ["electron.stdout.log", "electron.stderr.log"]) {
    await cp(join(fixture.artifacts, name), join(destination, name)).catch(
      () => undefined,
    );
  }
  return true;
}
