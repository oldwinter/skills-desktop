# Skills Desktop

Cross-platform desktop client for inspecting and managing Skills through the
existing `npx skills` CLI, locally and on explicitly configured SSH targets.

## Status

This repository is at the product-definition boundary. The validated Electron
prototype lives in [`prototype/`](prototype/); production code has not been
started. Read [`prototype/VERDICT.md`](prototype/VERDICT.md) before making
architecture decisions.

The prototype was imported from SimplexAI Agent-First Control Plane commit
`e4c5cb0f41a1944b369fbe20da72af456f806d2f`. It is evidence, not the production
foundation.

## Product Boundary

- Delegate skill discovery and mutations to `npx skills`; do not build another
  skill installer or scan skill directories independently.
- Support local targets first, then the same target contract over SSH.
- Compare presence, source, harness coverage, and a content revision only when
  one is available. Do not invent semantic versions.
- Generate a command plan before every mutation and require explicit user
  confirmation before execution.
- Treat curated collections as reviewed metadata over existing skill sources.

## Run The Prototype

```bash
cd prototype
npm install
npm run prototype:electron
```

The browser-only design preview is available with `npm run prototype`. The
Electron mode invokes the real read-only `npx skills list --json` boundary.

## Next Phase

Run the greenfield decision flow before implementation:

1. Use `wayfinder` to resolve product and architecture decision tickets.
2. Collapse accepted decisions with `to-spec`.
3. Split the spec into blocking tracer-bullet tickets with `to-tickets`.
4. Run `implement` in a fresh Codex session for each unblocked ticket.

Keep [`CONTEXT.md`](CONTEXT.md) and [`docs/adr/`](docs/adr/) current as decisions
land.
