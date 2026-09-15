import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkGlossary } from "../scripts/check-context.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("CONTEXT.md glossary check", () => {
  it("rejects duplicate terms and terms glued to the previous entry", () => {
    const source = [
      "# Context",
      "",
      "## Language",
      "",
      "**Alpha**: First definition.",
      "**Beta**: Glued to Alpha.",
      "",
      "**Alpha**: Second definition.",
      "",
      "## Next",
      "",
      "**Alpha**: Outside the glossary is ignored.",
    ].join("\n");
    expect(checkGlossary(source)).toEqual([
      'CONTEXT.md:6 term "Beta" must be preceded by a blank line.',
      'CONTEXT.md:8 duplicates the term "Alpha" first defined at line 5.',
    ]);
  });

  it("accepts CRLF checkouts", () => {
    const source = [
      "## Language",
      "",
      "**Alpha**: One.",
      "",
      "**Beta**: Two.",
      "",
    ].join("\r\n");
    expect(checkGlossary(source)).toEqual([]);
  });

  it("requires a Language section", () => {
    expect(checkGlossary("# Context\n")).toEqual([
      "CONTEXT.md has no `## Language` section.",
    ]);
  });

  it("keeps the repository glossary unique", async () => {
    const source = await readFile(
      resolve(repositoryRoot, "CONTEXT.md"),
      "utf8",
    );
    expect(checkGlossary(source)).toEqual([]);
  });
});
