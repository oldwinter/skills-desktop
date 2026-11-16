# AGENTS.md

Electron desktop app over `npx skills`. Read `CONTEXT.md` and the relevant `docs/adr/` before changing product behavior.

## Scope

- V1 is Local-only: the Local Target tracer (inventory via the pinned skills CLI, allowlisted stale Snapshot restore, mutation confirmation) plus the accepted ADRs are the source of truth. SSH Target, `packages/remote-bootstrap`, and cross-machine reconciliation are in-tree experiments; widening V1 to remote needs an explicit product decision.
- V1 ships unsigned, buildable candidates (`docs/unsigned-developer-preview.md`), not a signed public release.
- `prototype/` is evidence only (`prototype/VERDICT.md`): its sample data, command-preview strings, and monolithic UI module do not move into production.

## Engineering constraints

- Reuse `npx skills` for all skill discovery and mutation.
- Execute processes from argument arrays only; renderer-generated shell text never runs. Remote work uses a deliberately specified transport contract.
- Process, SSH, persistence, and renderer sit behind narrow interfaces with structured inputs and outputs; cover CLI parsing, command planning, IPC boundaries, diff semantics, and mutation confirmation with tests.
- Shipped inventory and collection schemas stay backward compatible.
- Credentials, raw SSH output, and generated visual-QA artifacts stay out of git.

## Verify

- `npm run verify` (typecheck, lint, import and context checks, coverage tests, build).
- Real CLI behavior: `npm run smoke:cli`; packaged app on Linux: `npm run smoke:packaged` (needs `xvfb-run`).

## Agent skills

In-repo Cursor skills live under `.cursor/skills/`. Catalog:
[`.cursor/skills/README.md`](.cursor/skills/README.md).

| Skill | When to use |
| --- | --- |
| [verify-skills-desktop](.cursor/skills/verify-skills-desktop/SKILL.md) | Prove a user-visible Local-only change by driving the packaged app over CDP. Feature map: [features/README.md](.cursor/skills/verify-skills-desktop/features/README.md). |

### How to add a skill

1. Add `.cursor/skills/<kebab-name>/SKILL.md` with `name` and `description`
   frontmatter (`name` matches the directory; `description` says when to load it).
2. List it in [`.cursor/skills/README.md`](.cursor/skills/README.md) and in the
   table above.
3. Reuse existing helpers and tests. Do not add runtime code, secrets, or a
   second skill installer. Packaged-app drivers must keep the Chromium sandbox
   on and reuse `tests/packaged-ui-qa/`.

Tracker and domain notes are not skills: see [`docs/agents/`](docs/agents/).
