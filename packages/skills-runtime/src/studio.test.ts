import { describe, expect, it } from "vitest";

import {
  STUDIO_VALIDATOR_PROFILE,
  renderStudioPreview,
  stripSkillFrontmatter,
  studioPreviewSchema,
  studioValidationSchema,
  validateSkillTree,
  type StudioTreeEntry,
} from "./studio.js";

const encoder = new TextEncoder();

function file(path: string, text: string | Uint8Array): StudioTreeEntry {
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  return { bytes, kind: "file", path, size: bytes.byteLength };
}

const SKILL_MD = `---
name: demo-skill
description: Demonstrates Studio validation.
---

# Demo

See [the guide](docs/guide.md) and [section](#demo).
`;

function codes(
  entries: readonly StudioTreeEntry[],
  directoryName = "demo-skill",
) {
  return validateSkillTree({ directoryName, entries }).findings.map(
    ({ code }) => code,
  );
}

describe("validateSkillTree (ADR 0018)", () => {
  it("accepts a well-formed Skill and reports frontmatter facts", () => {
    const validation = validateSkillTree({
      directoryName: "demo-skill",
      entries: [
        file("SKILL.md", SKILL_MD),
        { kind: "directory", path: "docs", size: 0 },
        file("docs/guide.md", "# Guide\n"),
      ],
    });
    expect(studioValidationSchema.safeParse(validation).success).toBe(true);
    expect(validation).toMatchObject({
      description: "Demonstrates Studio validation.",
      fileCount: 2,
      findings: [],
      name: "demo-skill",
      ok: true,
      profileVersion: STUDIO_VALIDATOR_PROFILE.version,
    });
  });

  it("fails closed on symlinks, hard links, special files, and traversal", () => {
    const validation = validateSkillTree({
      directoryName: "demo-skill",
      entries: [
        file("SKILL.md", SKILL_MD),
        file("docs/guide.md", "# Guide\n"),
        { kind: "symlink", path: "escape", size: 0 },
        { kind: "hardlink", path: "shared.bin", size: 4 },
        { kind: "special", path: "fifo", size: 0 },
        {
          bytes: new Uint8Array(0),
          kind: "file",
          path: "../outside.md",
          size: 0,
        },
      ],
    });
    expect(validation.ok).toBe(false);
    expect(validation.findings.map(({ code, path }) => [code, path])).toEqual([
      ["symlink", "escape"],
      ["hardlink", "shared.bin"],
      ["special_file", "fifo"],
      ["path_traversal", "../outside.md"],
    ]);
  });

  it("rejects over-limit files without bytes and over-limit Skills", () => {
    const large = STUDIO_VALIDATOR_PROFILE.limits.maxFileBytes + 1;
    expect(
      codes([
        file("SKILL.md", SKILL_MD),
        file("docs/guide.md", "# Guide\n"),
        { kind: "file", path: "big.bin", size: large },
      ]),
    ).toEqual(["file_too_large"]);
    const many: StudioTreeEntry[] = [
      file("SKILL.md", SKILL_MD),
      file("docs/guide.md", "x"),
    ];
    for (
      let index = 0;
      index < STUDIO_VALIDATOR_PROFILE.limits.maxFilesPerSkill;
      index += 1
    ) {
      many.push(file(`assets/a${index}.txt`, "x"));
    }
    expect(codes(many)).toContain("too_many_files");
  });

  it("requires SKILL.md with agreeing frontmatter", () => {
    expect(codes([file("README.md", "# nope\n")])).toEqual([
      "skill_md_missing",
    ]);
    expect(codes([file("SKILL.md", "# no frontmatter\n")])).toEqual([
      "frontmatter_invalid",
    ]);
    expect(
      codes([file("SKILL.md", new Uint8Array([0xff, 0xfe, 0x2d]))]),
    ).toEqual(["not_utf8"]);
    expect(
      codes(
        [
          file(
            "SKILL.md",
            SKILL_MD.replace("name: demo-skill", "name: Demo_Skill"),
          ),
        ],
        "demo-skill",
      ),
    ).toContain("name_invalid");
    expect(
      codes(
        [file("SKILL.md", SKILL_MD), file("docs/guide.md", "x")],
        "other-dir",
      ),
    ).toEqual(["name_mismatch"]);
  });

  it("rejects invalid paths and case conflicts", () => {
    expect(
      codes([
        file("SKILL.md", SKILL_MD),
        file("docs/guide.md", "x"),
        file("bad name.txt", "x"),
        file("Docs/Guide.md", "x"),
      ]),
    ).toEqual(["path_invalid", "case_conflict"]);
  });

  it("checks Markdown links against the observed tree", () => {
    const validation = validateSkillTree({
      directoryName: "demo-skill",
      entries: [
        file(
          "SKILL.md",
          `---
name: demo-skill
description: Links.
---
[missing](missing.md)
[escape](../secret.md)
[abs](/etc/passwd)
[js](javascript:alert(1))
[ok](https://example.com/page)
[img](./assets/logo.png)
![alt](assets/logo.png)
<script>alert(1)</script>
`,
        ),
        file("assets/logo.png", "png"),
      ],
    });
    expect(validation.ok).toBe(false);
    expect(validation.findings.map(({ code, line }) => [code, line])).toEqual([
      ["link_unresolved", 5],
      ["link_escape", 6],
      ["link_escape", 7],
      ["link_unsafe", 8],
      ["html_inert", 12],
    ]);
    expect(
      validation.findings.every(
        (finding) => !finding.message.includes("secret"),
      ),
    ).toBe(true);
  });

  it("ignores VCS and OS metadata entries", () => {
    expect(
      codes([
        file("SKILL.md", SKILL_MD),
        file("docs/guide.md", "x"),
        { kind: "symlink", path: ".git/HEAD", size: 0 },
        file(".DS_Store", "x"),
      ]),
    ).toEqual([]);
  });
});

describe("renderStudioPreview (ADR 0018)", () => {
  it("parses Markdown into a closed block vocabulary without HTML", () => {
    const preview = renderStudioPreview(`---
name: demo-skill
description: x
---
# Title

Some *emphasis*, **strong**, \`code\`, [link](docs/a.md), ![img](a.png).

- one
- two

1. first
2. second

> quoted **text**

\`\`\`bash
echo hi
\`\`\`

<div onclick="x()">raw</div>

---
`);
    expect(studioPreviewSchema.safeParse(preview).success).toBe(true);
    expect(preview.truncated).toBe(false);
    expect(preview.blocks).toEqual([
      {
        children: [{ kind: "text", text: "Title" }],
        kind: "heading",
        level: 1,
      },
      {
        children: [
          { kind: "text", text: "Some " },
          { children: [{ kind: "text", text: "emphasis" }], kind: "emphasis" },
          { kind: "text", text: ", " },
          { children: [{ kind: "text", text: "strong" }], kind: "strong" },
          { kind: "text", text: ", " },
          { kind: "code", text: "code" },
          { kind: "text", text: ", " },
          {
            children: [{ kind: "text", text: "link" }],
            kind: "link",
            target: "docs/a.md",
          },
          { kind: "text", text: ", " },
          { alt: "img", kind: "image", target: "a.png" },
          { kind: "text", text: "." },
        ],
        kind: "paragraph",
      },
      {
        items: [
          [{ kind: "text", text: "one" }],
          [{ kind: "text", text: "two" }],
        ],
        kind: "list",
        ordered: false,
      },
      {
        items: [
          [{ kind: "text", text: "first" }],
          [{ kind: "text", text: "second" }],
        ],
        kind: "list",
        ordered: true,
      },
      {
        children: [
          {
            children: [
              { kind: "text", text: "quoted " },
              { children: [{ kind: "text", text: "text" }], kind: "strong" },
            ],
            kind: "paragraph",
          },
        ],
        kind: "quote",
      },
      { kind: "code", language: "bash", text: "echo hi" },
      {
        children: [{ kind: "text", text: '<div onclick="x()">raw</div>' }],
        kind: "paragraph",
      },
      { kind: "rule" },
    ]);
  });

  it("bounds the block budget and reports truncation", () => {
    const lines = Array.from(
      { length: STUDIO_VALIDATOR_PROFILE.limits.maxPreviewBlocks + 5 },
      (_, index) => `# h${index}\n`,
    ).join("\n");
    const preview = renderStudioPreview(lines);
    expect(preview.blocks).toHaveLength(
      STUDIO_VALIDATOR_PROFILE.limits.maxPreviewBlocks,
    );
    expect(preview.truncated).toBe(true);
  });

  it("strips only a closed frontmatter block", () => {
    expect(stripSkillFrontmatter("---\nname: a\n---\nbody")).toBe("body");
    expect(stripSkillFrontmatter("---\nname: a\nbody")).toBe(
      "---\nname: a\nbody",
    );
    expect(stripSkillFrontmatter("body")).toBe("body");
  });
});
