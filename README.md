# Skills Desktop

Cross-platform desktop client for inspecting and managing Skills through the
existing `npx skills` CLI on the Local Target. V1 ships Local Target only;
SSH Target support is next-scope.

## Status

The first production tracer is implemented: a hardened packaged Electron shell
can inspect one atomic project-and-global Inventory for the Local Target through
the pinned `skills@1.5.23` CLI dialect. It restores only an allowlisted last
complete Snapshot, always marked stale. Read [`CONTEXT.md`](CONTEXT.md) and the
accepted records in [`docs/adr/`](docs/adr/) before changing product behavior.

V1 acceptance is Local-only: a reliable local tracer, reproducible unsigned
candidates, and docs that match reality. Public
[Unsigned Developer Previews](docs/unsigned-developer-preview.md) are available
through [GitHub Releases](https://github.com/oldwinter/skills-desktop/releases)
with checksums, an SPDX SBOM, attestations, and manual installation guidance.
They remain prereleases, are never latest, and do not enter automatic update
feeds. A signed stable release remains gated on #22/#27. SSH Target,
remote-bootstrap, and cross-machine reconciliation are out of V1 scope / next.

The prototype was imported from SimplexAI Agent-First Control Plane commit
`e4c5cb0f41a1944b369fbe20da72af456f806d2f`. It is evidence, not the production
foundation.

## Product Boundary

- Delegate skill discovery and mutations to `npx skills`; do not build another
  skill installer or scan skill directories independently.
- V1 supports Local Target only. SSH Target is next-scope and is not marketed
  or accepted as V1.
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
`packages/remote-bootstrap`. `packages/remote-bootstrap` is retained for
next-scope work; it is not part of the V1 public commitment. Production skill
discovery and mutation must keep using argument-array invocations of the pinned
`npx skills` package.

## Unsigned Developer Previews And Local Candidates

Unsigned Developer Previews are public early-access prereleases, not stable
releases. They have no Apple or Windows publisher trust. Verify the exact
downloaded bytes before following the platform-owned override and local-signing
steps in the [installation guide](docs/unsigned-developer-preview.md). Paid
signing, notarization, and stable publication remain deferred under #22/#27.

Local candidate generation remains available for development evidence. These
local builds have no publication authority, require a clean tracked tree, and
must run on the target operating system. Linux additionally requires `fakeroot`
and `rpmbuild`.

```bash
npm run candidate:build -- \
  --platform linux \
  --architecture x64 \
  --output-directory release-candidates \
  --repository oldwinter/skills-desktop \
  --source-commit "$(git rev-parse HEAD)" \
  --workflow-event local \
  --workflow-run-attempt 1 \
  --workflow-run-id 1
```

Use `darwin` with `arm64` or `x64`, or `win32` with `x64`, on the
corresponding native host. Each immutable candidate directory contains only
the ADR-defined Forge outputs, `candidate-manifest-v1.json`, and its SHA-256
sidecar. Public preview publication is a separate manual workflow on `main`:
it attests and verifies the exact candidate bytes, stages a private draft,
reverifies the uploaded assets, and only then publishes a GitHub prerelease.

## Run The Prototype

```bash
cd prototype
npm install
npm run prototype:electron
```

The browser-only design preview is available with `npm run prototype`. The
Electron mode invokes the real read-only `npx skills list --json` boundary.

The prototype remains design evidence and is not a production dependency.
