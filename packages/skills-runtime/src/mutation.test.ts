import { describe, expect, it } from "vitest";

import { mutationIntentSchema } from "./mutation.js";

describe("Mutation Intent schema", () => {
  it("accepts only exact named and scoped operations from the supported dialect", () => {
    expect(
      mutationIntentSchema.parse({
        names: ["tdd"],
        scope: "project",
        source: {
          revision: "0123456789abcdef0123456789abcdef01234567",
          source: "example/skills",
          sourceType: "github",
        },
        type: "add",
      }),
    ).toEqual({
      names: ["tdd"],
      scope: "project",
      source: {
        revision: "0123456789abcdef0123456789abcdef01234567",
        source: "example/skills",
        sourceType: "github",
      },
      type: "add",
    });
    expect(
      mutationIntentSchema.parse({
        scope: "global",
        type: "update-all",
      }),
    ).toEqual({ scope: "global", type: "update-all" });

    for (const unsafe of [
      { names: ["*"], scope: "project", type: "remove" },
      { names: ["--all"], scope: "project", type: "update" },
      { argv: ["remove", "tdd"], scope: "project", type: "remove" },
      { command: "npx skills remove tdd", scope: "project", type: "remove" },
      { names: ["tdd"], scope: "project", type: "experimental_install" },
      { names: ["tdd"], scope: "project", type: "add-list" },
      {
        names: ["tdd"],
        scope: "project",
        source: {
          revision: "main",
          source: "example/skills",
          sourceType: "github",
        },
        type: "add",
      },
      {
        names: ["not-a-repo"],
        scope: "project",
        source: { source: "not-a-repo", sourceType: "github" },
        type: "add",
      },
      {
        flags: ["--yes"],
        names: ["tdd"],
        scope: "project",
        type: "update",
      },
    ]) {
      expect(mutationIntentSchema.safeParse(unsafe).success).toBe(false);
    }

    expect(
      mutationIntentSchema.safeParse({
        names: Array.from({ length: 128 }, (_, index) =>
          `${index}-${"x".repeat(250)}`,
        ),
        scope: "project",
        type: "remove",
      }).success,
    ).toBe(false);
  });

  it("carries an optional non-empty unique harness subset for add and remove only", () => {
    expect(
      mutationIntentSchema.parse({
        harnessIds: ["codex", "amp"],
        names: ["tdd"],
        scope: "project",
        type: "remove",
      }),
    ).toEqual({
      harnessIds: ["codex", "amp"],
      names: ["tdd"],
      scope: "project",
      type: "remove",
    });
    expect(
      mutationIntentSchema.safeParse({
        harnessIds: ["codex"],
        names: ["tdd"],
        scope: "project",
        source: { source: "example/skills", sourceType: "github" },
        type: "add",
      }).success,
    ).toBe(true);

    for (const unsafe of [
      { harnessIds: [], names: ["tdd"], scope: "project", type: "remove" },
      {
        harnessIds: ["codex", "codex"],
        names: ["tdd"],
        scope: "project",
        type: "remove",
      },
      { harnessIds: [""], names: ["tdd"], scope: "project", type: "remove" },
      { harnessIds: ["codex"], names: ["tdd"], scope: "project", type: "update" },
      { harnessIds: ["codex"], scope: "project", type: "update-all" },
    ]) {
      expect(mutationIntentSchema.safeParse(unsafe).success).toBe(false);
    }
  });
});
