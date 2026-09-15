import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  canonicalSourceInspectionJson,
  describeSource,
  parseSourceListing,
  sourceDescriptorV1Schema,
  stripTerminalEscapes,
  type SourceDescriptorV1,
} from "./source.js";
import { mutationIntentSchema } from "./mutation.js";

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    "utf8",
  );

function expectDescriptor(
  source: string,
  expected: Omit<SourceDescriptorV1, "schemaVersion" | "source">,
) {
  expect(describeSource(source)).toEqual({
    ok: true,
    value: { ...expected, schemaVersion: 1, source },
  });
}

describe("describeSource", () => {
  it("classifies GitHub shorthand and keeps the exact case", () => {
    expectDescriptor("Vercel-Labs/Agent.Skills", {
      family: "github",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("vercel-labs/skills/skills/find-skills", {
      family: "github",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("vercel-labs/skills#main", {
      family: "github",
      locality: "portable",
      mutability: "mutable",
      ref: "main",
    });
    expectDescriptor(
      "vercel-labs/skills#435076e78988e1e6ec40d00b0b1d76bdbbc5419a",
      {
        family: "github",
        locality: "portable",
        mutability: "pinned",
        ref: "435076e78988e1e6ec40d00b0b1d76bdbbc5419a",
      },
    );
  });

  it("classifies GitHub, GitLab, and generic Git URLs", () => {
    expectDescriptor("https://github.com/vercel-labs/skills", {
      family: "github",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("https://github.com/vercel-labs/skills.git", {
      family: "github",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor(
      "https://github.com/vercel-labs/skills/tree/release/skills",
      {
        family: "github",
        locality: "portable",
        mutability: "mutable",
        ref: "release",
      },
    );
    expectDescriptor("https://gitlab.com/group/sub/project", {
      family: "gitlab",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("https://gitlab.com/group/project/-/tree/v2/skills", {
      family: "gitlab",
      locality: "portable",
      mutability: "mutable",
      ref: "v2",
    });
    expectDescriptor("https://git.example.com/team/skills.git", {
      family: "git",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("ssh://git@git.example.com/team/skills.git", {
      family: "git",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("git@github.com:vercel-labs/skills.git", {
      family: "git",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
  });

  it("classifies HTTP SKILL.md and archive forms, pinning exact commit archives", () => {
    expectDescriptor(
      "https://github.com/vercel-labs/skills/archive/435076e78988e1e6ec40d00b0b1d76bdbbc5419a.tar.gz",
      {
        family: "http-archive",
        locality: "portable",
        mutability: "pinned",
        ref: null,
      },
    );
    expectDescriptor("https://github.com/vercel-labs/skills/archive/main.zip", {
      family: "http-archive",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor(
      "https://raw.githubusercontent.com/vercel-labs/skills/main/skills/find-skills/SKILL.md",
      {
        family: "http-skill",
        locality: "portable",
        mutability: "mutable",
        ref: null,
      },
    );
    expectDescriptor("https://example.com/skills/review/SKILL.md", {
      family: "http-skill",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("https://example.com/downloads/skills.tgz", {
      family: "http-archive",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("https://gitlab.com/group/project/-/archive/main/project-main.zip", {
      family: "http-archive",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
  });

  it("classifies well-known discovery and skills.sh Pack sources", () => {
    expectDescriptor("https://example.com", {
      family: "well-known",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("http://127.0.0.1:8080/team", {
      family: "well-known",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("https://skills.sh/p/vercel-essentials", {
      family: "skills-sh-pack",
      locality: "portable",
      mutability: "mutable",
      ref: null,
    });
  });

  it("classifies local directories and archives as local-only", () => {
    expectDescriptor("/home/me/skills", {
      family: "local-directory",
      locality: "local-only",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("./skills", {
      family: "local-directory",
      locality: "local-only",
      mutability: "mutable",
      ref: null,
    });
    expectDescriptor("C:\\skills\\bundle.zip", {
      family: "local-archive",
      locality: "local-only",
      mutability: "mutable",
      ref: null,
    });
  });

  it("rejects credential-bearing, option-shaped, control-character, and unsupported forms", () => {
    const rejected = [
      "",
      " vercel-labs/skills",
      "vercel-labs/skills ",
      "--list",
      "-y",
      "vercel-labs/skills\u001b[2J",
      "vercel-labs/skills\nother",
      "https://user:secret@github.com/vercel-labs/skills",
      "https://token@github.com/vercel-labs/skills",
      "ssh://git:secret@git.example.com/team/skills.git",
      "https://github.com/vercel-labs",
      "https://github.com/vercel-labs/skills/pull/1",
      "https://github.com/vercel-labs/skills?ref=main",
      "https://gitlab.com/onlygroup",
      "https://skills.sh/search?q=vercel",
      "https://example.com/index#main",
      "github:vercel-labs/skills",
      "gitlab:group/project",
      "vercel-labs/skills#main@find-skills",
      "vercel-labs/skills#",
      "vercel-labs/skills#bad ref",
      "vercel-labs/skills/../escape",
      "-owner/repo",
      "owner",
      "ftp://example.com/skills.zip",
      "file:///home/me/skills",
      "a".repeat(2_049),
    ];
    for (const source of rejected) {
      const result = describeSource(source);
      expect(result.ok, source).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: "source_unsupported",
          effects: "none",
          retryable: false,
        });
      }
    }
    expect(describeSource(42).ok).toBe(false);
  });

  it("keeps the descriptor schema closed and locality consistent", () => {
    expect(
      sourceDescriptorV1Schema.safeParse({
        family: "github",
        locality: "local-only",
        mutability: "mutable",
        ref: null,
        schemaVersion: 1,
        source: "vercel-labs/skills",
      }).success,
    ).toBe(false);
    expect(
      sourceDescriptorV1Schema.safeParse({
        extra: true,
        family: "github",
        locality: "portable",
        mutability: "mutable",
        ref: null,
        schemaVersion: 1,
        source: "vercel-labs/skills",
      }).success,
    ).toBe(false);
    for (const source of ["vercel-labs/skills --skill x", "-r", "a\u0000b"]) {
      expect(
        sourceDescriptorV1Schema.safeParse({
          family: "github",
          locality: "portable",
          mutability: "mutable",
          ref: null,
          schemaVersion: 1,
          source,
        }).success,
      ).toBe(false);
    }
  });
});

describe("parseSourceListing", () => {
  it("parses the pinned single-skill fixture", () => {
    expect(parseSourceListing(fixture("skills-1.5.23-add-list-single.v1.txt"))).toEqual({
      ok: true,
      value: {
        candidates: [
          {
            description: expect.stringContaining(
              "Helps users discover and install agent skills",
            ),
            group: null,
            name: "find-skills",
          },
        ],
        cliVersion: "1.5.23",
        dialectVersion: 1,
      },
    });
  });

  it("parses the pinned multi-skill fixture in listing order", () => {
    const result = parseSourceListing(
      fixture("skills-1.5.23-add-list-multi.v1.txt"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates.map(({ name }) => name)).toEqual([
      "vercel-composition-patterns",
      "deploy-to-vercel",
      "vercel-react-best-practices",
      "vercel-react-native-skills",
      "vercel-react-view-transitions",
      "vercel-cli-with-tokens",
      "vercel-optimize",
      "web-design-guidelines",
      "writing-guidelines",
    ]);
    expect(
      result.value.candidates.every(
        ({ description, group }) => description.length > 0 && group === null,
      ),
    ).toBe(true);
    expect(result.value.candidates[1]?.description).toBe(
      'Deploy applications and websites to Vercel. Use when the user requests deployment actions like "deploy my app", "deploy and give me the link", "push this live", or "create a preview deployment".',
    );
  });

  it("fails a clone failure transcript instead of publishing an empty list", () => {
    const result = parseSourceListing(
      fixture("skills-1.5.23-add-list-clone-failed.v1.txt"),
    );
    expect(result).toEqual({
      error: {
        code: "source_inspection_incompatible",
        effects: "none",
        message: "Source listing did not announce available Skills.",
        phase: "inspect",
        retryable: false,
      },
      ok: false,
    });
  });

  const transcript = (entries: string, count = 1, outro = "Use --skill <name> to install specific skills") =>
    [
      "",
      "│",
      "◇  Source: https://example.com/skills.git",
      `◇  Found ${count} skill${count === 1 ? "" : "s"}`,
      "",
      "│",
      "◇  Available Skills",
      entries,
      "",
      "│",
      `└  ${outro}`,
      "",
    ].join("\n");

  it("parses grouped listings and well-known file counts", () => {
    const grouped = [
      "Frontend",
      "│",
      "│    react-patterns",
      "│",
      "│      React guidance.",
      "",
      "General",
      "│",
      "│    writing",
      "│",
      "│      Prose guidance.",
    ].join("\n");
    expect(parseSourceListing(transcript(grouped, 2))).toMatchObject({
      ok: true,
      value: {
        candidates: [
          { description: "React guidance.", group: "Frontend", name: "react-patterns" },
          { description: "Prose guidance.", group: "General", name: "writing" },
        ],
      },
    });

    const wellKnown = [
      "│",
      "│    review",
      "│      Reviews code.",
      "│      Files: 3",
    ].join("\n");
    expect(
      parseSourceListing(transcript(wellKnown, 1, "Run without --list to install")),
    ).toMatchObject({
      ok: true,
      value: {
        candidates: [{ description: "Reviews code.", group: null, name: "review" }],
      },
    });
  });

  it("fails on missing header, missing count, mismatched count, duplicates, and contamination", () => {
    const single = ["│", "│    review", "│", "│      Reviews code."].join("\n");
    const cases: readonly [string, string][] = [
      [transcript(single, 1).replace("◇  Available Skills", "◇  Skills"), "did not announce available Skills"],
      [transcript(single, 1).replace("◇  Found 1 skill\n", ""), "did not announce a Skill count"],
      [transcript(single, 2), "entry count does not match"],
      [transcript(`${single}\n${single}`, 2), "repeated an entry name"],
      [transcript(`${single}\n│  stray line`, 1), "not part of the dialect"],
      [transcript(`${single}\n◇  Another step`, 1), "unexpected step"],
      [transcript("│\n│    review", 1), "ended without a description"],
      [transcript("│\n│      Orphan description.", 1), "description has no entry"],
      [transcript("│\n│    bad name!\n│      Desc.", 1), "entry name is not supported"],
      [`${transcript(single, 1)}\n│    trailing`, "continued after its outro"],
      [transcript(single, 1).replace(/└.*\n/, ""), "did not finish"],
      [transcript("", 0), "published no entries"],
      [`${transcript(single, 1)}\n${transcript(single, 1)}`, "twice"],
    ];
    for (const [text, message] of cases) {
      const result = parseSourceListing(text);
      expect(result.ok, message).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("source_inspection_incompatible");
        expect(result.error.message, message).toContain(message);
      }
    }
    expect(parseSourceListing(undefined as unknown as string).ok).toBe(false);
  });

  it("strips CSI, OSC, and simple escapes while preserving text", () => {
    expect(
      stripTerminalEscapes(
        "\u001b[?25l\u001b[1G\u001b[J\u001b]0;title\u0007\u001b(Bplain \u001b[36mcyan\u001b[39m",
      ),
    ).toBe("plain cyan");
  });
});

describe("inspected add intents", () => {
  const descriptor: SourceDescriptorV1 = {
    family: "gitlab",
    locality: "portable",
    mutability: "mutable",
    ref: "main",
    schemaVersion: 1,
    source: "https://gitlab.com/group/project#main",
  };

  it("accepts an inspected source binding alongside legacy GitHub sources", () => {
    expect(
      mutationIntentSchema.safeParse({
        names: ["review"],
        scope: "project",
        source: {
          descriptor,
          inspection: { digest: "a".repeat(64), id: "inspection-1" },
          sourceType: "inspected",
        },
        type: "add",
      }).success,
    ).toBe(true);
    expect(
      mutationIntentSchema.safeParse({
        names: ["review"],
        scope: "project",
        source: { source: "vercel-labs/skills", sourceType: "github" },
        type: "add",
      }).success,
    ).toBe(true);
  });

  it("rejects inspected sources without a digest binding", () => {
    expect(
      mutationIntentSchema.safeParse({
        names: ["review"],
        scope: "project",
        source: { descriptor, sourceType: "inspected" },
        type: "add",
      }).success,
    ).toBe(false);
    expect(
      mutationIntentSchema.safeParse({
        names: ["review"],
        scope: "project",
        source: {
          descriptor,
          inspection: { digest: "not-a-digest", id: "inspection-1" },
          sourceType: "inspected",
        },
        type: "add",
      }).success,
    ).toBe(false);
  });

  it("produces stable canonical digest bytes", () => {
    const listing = {
      candidates: [{ description: "Reviews code.", group: null, name: "review" }],
      cliVersion: "1.5.23" as const,
      dialectVersion: 1 as const,
    };
    const json = canonicalSourceInspectionJson({ descriptor, listing });
    expect(JSON.parse(json)).toEqual({
      candidates: listing.candidates,
      cliVersion: "1.5.23",
      descriptor,
      dialectVersion: 1,
    });
    expect(
      canonicalSourceInspectionJson({
        descriptor: { ...descriptor, ref: "release" },
        listing,
      }),
    ).not.toBe(json);
  });
});
