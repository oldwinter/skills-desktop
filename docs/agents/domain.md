# Domain Docs

This repository uses a single product context.

## Before exploring

- Read root `CONTEXT.md`.
- Read relevant records under `docs/adr/`.
- Read prototype documents only as interaction and design evidence.

## Agent skills

Cursor skills for this repository are catalogued in
[`.cursor/skills/README.md`](../../.cursor/skills/README.md). They are agent
runbooks, not product Skills, and they do not replace `npx skills`.

## Consumer rules

- Use the canonical vocabulary from `CONTEXT.md`.
- Keep `CONTEXT.md` limited to domain language, not implementation details.
- Record durable, hard-to-reverse trade-offs under `docs/adr/`.
- Surface conflicts with existing ADRs rather than silently overriding them.
- Do not promote prototype sample data, preview strings, or monolithic modules
  into production architecture.
