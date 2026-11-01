# Agent skill catalog

In-repo Cursor skills for this repository. They teach agents how to work
**on** Skills Desktop. They do not install product Skills, do not replace
`npx skills`, and do not change runtime behavior.

Product Skills (Inventory add/remove/update) stay delegated to the pinned
CLI. See [docs/user-guide.md](../../docs/user-guide.md) for the Local-only
user path, including Add Skill and Studio.

## Index

| Skill | When to use | Entry |
| --- | --- | --- |
| `verify-skills-desktop` | Prove a user-visible Local-only change in Inventory, Comparison, Collections, Targets, About, or Trusted Review by driving the packaged Electron app over CDP. | [SKILL.md](verify-skills-desktop/SKILL.md) · [feature map](verify-skills-desktop/features/README.md) |

Tracker and domain notes under [`docs/agents/`](../../docs/agents/) are **not**
skills. List a skill here only when it has a `SKILL.md` with `name` and
`description` frontmatter.

## How to add a skill

1. Create `.cursor/skills/<kebab-case-name>/SKILL.md`.
2. Start with YAML frontmatter. `name` must match the directory. `description`
   must say **when** the next agent should load the skill:
   ```yaml
   ---
   name: example-skill
   description: Use when doing X in this repository. Do not use for Y.
   ---
   ```
3. Keep the body short enough to follow mid-task. Point at existing helpers,
   tests, and docs instead of copying them. If the skill covers several
   surfaces, add a feature map (see
   [verify-skills-desktop/features/README.md](verify-skills-desktop/features/README.md)).
4. Add a row to the Index above and a one-line pointer in `AGENTS.md` /
   `CLAUDE.md`.
5. Do not put secrets, credentials, raw SSH/CLI output, or generated visual-QA
   artifacts in a skill. Do not add runtime code, dependency bumps, or a second
   skill installer. Verification skills that drive the packaged app must reuse
   `tests/packaged-ui-qa/` and keep the Chromium sandbox enabled.

A skill is ready when another agent can find it from this catalog, decide
whether it applies from the `description`, and follow `SKILL.md` without
reading the rest of the repository first.
