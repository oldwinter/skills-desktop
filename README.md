# Skills Desktop

Cross-platform desktop client for inspecting and managing Skills through the
existing pinned `npx skills` CLI. The accepted architecture now targets Local
plus POSIX Remote SSH, delivered through gated milestones. The current shipped
product remains Local-only.


## 用户手册

面向最终用户的操作说明见 [docs/user-guide.md](docs/user-guide.md)（当前仍为 Local-only）。

## Status

The first production tracer is implemented: a hardened packaged Electron shell
can inspect one atomic project-and-global Inventory for the Local Target through
the pinned `skills@1.5.23` CLI dialect. It restores only an allowlisted last
complete Snapshot, always marked stale. Read [`CONTEXT.md`](CONTEXT.md) and the
accepted records in [`docs/adr/`](docs/adr/) before changing product behavior.

Current acceptance remains Local-only: a reliable local tracer, reproducible
unsigned candidates, and docs that match reality. SSH Inventory remains
unavailable until Milestone 3 passes. SSH mutation remains unavailable until
Milestone 4 passes. Public
[Unsigned Developer Previews](docs/unsigned-developer-preview.md) are available
through [GitHub Releases](https://github.com/oldwinter/skills-desktop/releases)
with checksums, an SPDX SBOM, attestations, and manual installation guidance.
They remain prereleases, are never latest, and do not enter automatic update
feeds. A signed Stable Release remains gated on #22/#27.

The prototype was imported from SimplexAI Agent-First Control Plane commit
`e4c5cb0f41a1944b369fbe20da72af456f806d2f`. It is evidence, not the production
foundation.

## Product Boundary

- Delegate skill discovery and mutations to `npx skills`; do not build another
  skill installer or scan skill directories independently.
- The current product supports Local Target only. Accepted SSH architecture is
  not a shipped capability: Inventory waits for Milestone 3, and mutation waits
  for Milestone 4.
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
`packages/remote-bootstrap` is retained for gated SSH work; it is not a current
public capability. Production skill discovery and mutation must keep using
argument-array invocations of the pinned `npx skills` package.
## Unsigned Developer Previews And Local Candidates

Unsigned Developer Previews are public early-access prereleases, not stable
releases. They have no Apple or Windows publisher trust. Verify the exact
downloaded bytes before following the platform-owned override and local-signing
steps in the [installation guide](docs/unsigned-developer-preview.md). Paid
signing, notarization, and stable publication remain deferred under #22/#27.

The macOS preview is not signed or notarized yet. After verifying the download's
SHA-256 value and moving `Skills Desktop.app` into `/Applications`, remove the
quarantine attribute from this application bundle only:

```bash
sudo xattr -r -d com.apple.quarantine /Applications/Skills\ Desktop.app
```

Do not use this command on a broader directory or on an unverified download.

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
sidecar.

Two tag schemes exist; they are not interchangeable:

- **Current public Unsigned Developer Previews** on GitHub Releases use
  `preview-v{version}-{full commit sha}` from `workflow_dispatch` on `main`
  (a separate manual publication workflow on `main` remains available as a
  fallback). The current public tag is
  `preview-v0.1.0-34ff7b72b63773bfde8b37e6eb01ec44bdb2583f`. Download that
  prerelease; do not download `v0.1.0`.
- **Tagged CI path** (`on.push.tags: v*.*.*`) is an exact version tag after
  all workspace and lockfile versions have been updated and merged. The
  `git tag -a v0.1.0` example below is that path. It is not the tag currently
  listed as a public pre-release.

```bash
git tag -a v0.1.0 -m "Skills Desktop v0.1.0"
git push origin v0.1.0
```

That example tag must match the package version and point into `main`
history. It is not currently published as a public GitHub pre-release. When
that path is used, CI builds macOS arm64/x64, Windows x64, and Linux x64
candidates, attests and verifies the exact bytes, stages a private draft,
reverifies the uploaded assets, and only then publishes the same tag as a
non-latest GitHub prerelease. These artifacts remain unsigned and are not
Stable Releases.

## Run The Prototype

```bash
cd prototype
npm install
npm run prototype:electron
```

The browser-only design preview is available with `npm run prototype`. The
Electron mode invokes the real read-only `npx skills list --json` boundary.

The prototype remains design evidence and is not a production dependency.
