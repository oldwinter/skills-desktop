import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const termPattern = /^\*\*([^*]+)\*\*:/;

export function checkGlossary(source) {
  const lines = source.split(/\r?\n/);
  const seen = new Map();
  const problems = [];
  const languageStart = lines.indexOf("## Language");
  if (languageStart === -1) {
    return ["CONTEXT.md has no `## Language` section."];
  }
  for (let index = languageStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("## ")) break;
    const match = termPattern.exec(line);
    if (match === null) continue;
    const term = match[1];
    const lineNumber = index + 1;
    const previous = seen.get(term);
    if (previous !== undefined) {
      problems.push(
        `CONTEXT.md:${lineNumber} duplicates the term "${term}" first defined at line ${previous}.`,
      );
    } else {
      seen.set(term, lineNumber);
    }
    if (index > 0 && lines[index - 1].trim() !== "") {
      problems.push(
        `CONTEXT.md:${lineNumber} term "${term}" must be preceded by a blank line.`,
      );
    }
  }
  return problems;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const source = await readFile(resolve(repositoryRoot, "CONTEXT.md"), "utf8");
  const problems = checkGlossary(source);
  if (problems.length > 0) {
    process.stderr.write(`${problems.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("CONTEXT.md glossary terms are unique.\n");
}
