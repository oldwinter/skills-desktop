import { CLI_PACKAGE, CLI_VERSION, HARNESS_IDS } from "@skills-desktop/skills-runtime";
import { describe, expect, it } from "vitest";

import {
  CLI_EXAMPLES,
  PINNED_CLI_VERSION,
  formatArgumentArray,
  formatPreview,
} from "./cli-examples.js";

describe("CLI examples", () => {
  it("always pin the CLI package right after --yes", () => {
    for (const example of CLI_EXAMPLES) {
      expect(example.args.slice(0, 2)).toEqual(["--yes", CLI_PACKAGE]);
    }
    expect(PINNED_CLI_VERSION).toBe(CLI_VERSION);
  });

  it("end every mutation with a non-interactive --yes and name only registry harnesses", () => {
    const mutations = CLI_EXAMPLES.filter((example) =>
      ["add", "remove", "update"].includes(example.id),
    );
    expect(mutations).toHaveLength(3);
    for (const example of mutations) {
      expect(example.args.at(-1)).toBe("--yes");
      example.args.forEach((argument, index) => {
        if (example.args[index - 1] === "--agent") {
          expect(HARNESS_IDS).toContain(argument);
        }
      });
    }
  });

  it("contain no shell metacharacters because they are argument arrays, not commands", () => {
    for (const example of CLI_EXAMPLES) {
      for (const argument of example.args) {
        expect(argument).not.toMatch(/[|&;<>`$\\'"\s]/);
      }
    }
  });

  it("format arrays as JSON string literals and previews as npx lines", () => {
    expect(formatArgumentArray(["--yes", "skills@1.5.23", "--version"])).toBe(
      '["--yes", "skills@1.5.23", "--version"]',
    );
    expect(formatPreview(["--yes", "skills@1.5.23", "list", "--json"])).toBe(
      "npx --yes skills@1.5.23 list --json",
    );
  });
});
