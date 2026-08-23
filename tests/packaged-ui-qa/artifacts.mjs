import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SECRET_VALUE_PATTERN =
  /((?:["']?[A-Za-z0-9_-]*(?:authorization|token|secret|password|passwd|api[_-]?key|access[_-]?key|client[_-]?secret)[A-Za-z0-9_-]*["']?\s*[:=]\s*))(?:(?:"[^"\r\n]*")|(?:'[^'\r\n]*')|(?:Bearer\s+[^\s,;}]+)|(?:[^\s,;}]+))/gi;
const URL_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\)[^\r\n,;}]+/g;
const POSIX_PATH_PATTERN = /\/(?:[^\s"'<>/]+\/)+[^\r\n,;}]+/g;

export function redactFailureText(value) {
  return String(value)
    .replace(SECRET_VALUE_PATTERN, "$1[REDACTED_SECRET]")
    .replace(URL_PATTERN, "[REDACTED_URL]")
    .replace(WINDOWS_PATH_PATTERN, "[REDACTED_PATH]")
    .replace(POSIX_PATH_PATTERN, "[REDACTED_PATH]");
}

export async function persistFailureArtifacts(fixture, error, destination) {
  if (typeof destination !== "string" || destination.length === 0) return false;
  await mkdir(destination, { recursive: true });
  const errorPath = join(destination, "error.txt");
  await writeFile(
    errorPath,
    `${redactFailureText(error instanceof Error ? error.stack : String(error))}\n`,
    { mode: 0o600 },
  );
  await chmod(errorPath, 0o600);
  for (const name of ["electron.stdout.log", "electron.stderr.log"]) {
    await readFile(join(fixture.artifacts, name), "utf8")
      .then((contents) =>
        writeFile(join(destination, name), redactFailureText(contents), {
          mode: 0o600,
        }),
      )
      .catch(() => undefined);
  }
  return true;
}
