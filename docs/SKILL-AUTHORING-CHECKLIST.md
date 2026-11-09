# Skill authoring checklist

Writer guidance for `SKILL.md` (Agent Skills). Use it before publishing or
reviewing a Skill, whether that Skill is installed through the pinned
`npx skills` CLI or kept as an in-repo Cursor runbook.

This is **not** a catalog index. In-repo skill discoverability (listing
`.cursor/skills/` and telling agents how to register a new row) is tracked
in skills-desktop#310. This is **not** Inventory UI work (skills-desktop#304)
and does not change Studio runtime, the Skills Dialect, or CI.

## 1. Frontmatter `name` and `description`

`SKILL.md` must start with closed YAML frontmatter. Both fields are required
and must be single-line scalars:

```yaml
---
name: example-skill
description: One-line what and when. Use when doing X. Do not use for Y.
---
```

- `name` is kebab-case: lowercase letters, digits, and single hyphens; 1–64
  characters; no leading or trailing hyphen; no `--`.
- `name` must equal the Skill directory name.
- `description` is non-blank, at most 1024 characters, with no control
  characters. Duplicate frontmatter keys fail closed.
- Studio validation and well-known export (ADR 0018 / 0019) accept only this
  subset. Nested YAML, multiline scalars, and extra structure are not a
  portable bet.

## 2. When-to-use line

Put the trigger in `description`, not only in the body. Agents match
`description` to decide whether to load the Skill.

- State the job: `Use when …`
- Name the surfaces or inputs that should load it.
- Add a negative when a nearby Skill or ordinary docs would otherwise steal
  the match: `Do not use for …`
- Keep the body for steps. Repeat the trigger in the opening paragraph only
  if the next agent would otherwise miss it.

## 3. Idempotent steps

Write steps a second agent can re-run without duplicating work or leaving
partial state.

- Prefer check-then-act: detect existing output, then skip or update in place.
- Name exact commands, files, and exit conditions. Do not ask the agent to
  invent a shell pipeline.
- Fail closed on secrets, missing fixtures, or unexpected hosts. Do not
  best-effort mutate shared state.
- Point at existing helpers, tests, and docs instead of copying them.

## 4. No secrets

Never put any of the following in `SKILL.md` or adjacent skill files:

- credentials, tokens, API keys, signing keys, cookies
- raw SSH output, host keys, or Connection Reference secrets
- generated visual-QA artifacts (screenshots, videos, Electron logs)
- live inventory paths, developer `HOME`, or personal machine names

Tell the agent where secrets already live (environment, OpenSSH, OS keychain)
and to refuse to echo them. Fixture data must be disposable and obviously fake.

## 5. Test notes

Every Skill needs a short "how to know it worked" note in the body:

- **Behavior skill**: command(s) to run, expected evidence, and cleanup.
- **Docs-only skill**: say so, and list the links or headings a reviewer
  should click. Do not require `npm run verify` or packaged CDP.
- **Packaged-app driver**: reuse `tests/packaged-ui-qa/`, keep the Chromium
  sandbox on, and record the one-shot helper plus teardown.

If the Skill cannot be followed mid-task without reading the rest of the
repository, it is not done.

## Out of scope

| Need | Go here instead |
| --- | --- |
| List in-repo Cursor skills or register a catalog row | skills-desktop#310 — do not duplicate that index here |
| Inventory name sort | skills-desktop#304 |
| Studio UI (open folder, draft, preview, export) | [user-guide.md](user-guide.md) §8 and [ADR 0018](adr/0018-author-skills-with-static-studio-grants.md) |
| Domain language | [CONTEXT.md](../CONTEXT.md) |
