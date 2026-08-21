# Skills Desktop

Cross-platform desktop client for inspecting and managing Skills through the
existing `npx skills` CLI, locally and on explicitly configured SSH targets.

## Status

The first production tracer is implemented: a hardened packaged Electron shell
can inspect one atomic project-and-global Inventory for the Local Target through
the pinned `skills@1.5.23` CLI dialect. It restores only an allowlisted last
complete Snapshot, always marked stale. Read [`CONTEXT.md`](CONTEXT.md) and the
accepted records in [`docs/adr/`](docs/adr/) before changing product behavior.

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

## Production Development

```bash
npm install
npm run verify
npm run smoke:cli
npm run smoke:packaged
```

Development and local observation require Node.js 22.20 or newer so the pinned
Skills CLI can run through `npx`.

`npm run smoke:cli` uses an isolated temporary home, workspace, and npm cache.
The packaged smoke uses a fake pinned CLI boundary in temporary state so it can
exercise fresh observation, redaction, restart, and stale recovery without
reading or changing developer inventory.

The production workspaces are `apps/desktop`, `packages/skills-runtime`, and
`packages/remote-bootstrap`. Production skill discovery and mutation must keep
using argument-array invocations of the pinned `npx skills` package.

## Run The Prototype

```bash
cd prototype
npm install
npm run prototype:electron
```

The browser-only design preview is available with `npm run prototype`. The
Electron mode invokes the real read-only `npx skills list --json` boundary.

The prototype remains design evidence and is not a production dependency.
