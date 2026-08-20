# Skills Desktop UI Prototype

Throwaway Electron prototype for one question: which information architecture best supports local skill inventory, cross-harness/device diff, and curated skill bundles while delegating skill operations to `npx skills`?

## Run

```bash
npm install
npm run prototype
```

Open the printed browser URL for the fastest UI review. Use `npm run prototype:electron` to launch the Electron shell; that mode reads the current workspace with the real, read-only `npx skills list --json` command.

Variants are shareable:

- `?variant=A` - inventory-first, fixed scope tree and inspector
- `?variant=B` - compare-first, paired targets and diff matrix
- `?variant=C` - fleet-first, machine lanes and collection planning

Use the bottom switcher or the left/right arrow keys. The top view tabs expose Local Skills, Differences, and Collections in every variant.

Run the real Electron boundary check on Linux with `xvfb-run -a npm run prototype:smoke`; on a desktop session, `npm run prototype:smoke` is sufficient.

## Prototype Boundary

- Reads local skills through `npx skills`; no local skill discovery logic is reimplemented.
- Shows real command shapes for add, remove, update, and repository listing, but never executes them.
- Uses sample SSH snapshots and collection metadata so the UI can be evaluated without credentials or remote mutations.
- Has no persistence, updater, packaging, broad test suite, or production error recovery. One Electron smoke locks the local-list IPC boundary.

This directory is intentionally named `prototype` and must not be promoted directly into production.

The product decision and implementation boundary are captured in `VERDICT.md`.
