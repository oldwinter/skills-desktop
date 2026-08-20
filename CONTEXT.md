# Skills Desktop Context

## Product Intent

Skills Desktop is a cross-platform Electron client for developers who manage
agent Skills across local harnesses and remote machines. It provides inventory,
comparison, mutation planning, and curated collections while delegating actual
skill operations to `npx skills`.

## Language

**Target**: One machine and one harness selection, such as local Codex or a Pi
installation on an SSH host.

**Inventory**: The normalized result of a read-only `npx skills list --json`
invocation for one target. It is a snapshot, not a second source of truth.

**Skill Identity**: A stable skill name plus its declared source. A filesystem
path is evidence, not identity.

**Revision**: A content or source revision explicitly reported by an upstream
source. Unknown remains unknown; it is not converted into an app-defined
semantic version.

**Comparison**: A diff between two target inventories covering presence,
source, harness availability, and known revision.

**Command Plan**: Structured mutation intent rendered for review before any
local or remote process is started. Preview strings are not executable input.

**Collection**: Reviewed metadata selecting skills from an existing source for
one or more targets. It never defines a second installation protocol.

## Non-Negotiable Boundaries

- `npx skills` remains authoritative for list, add, remove, and update.
- Local commands use argument arrays at the process boundary, never shell-built
  command strings.
- SSH host identity, target selection, and mutation confirmation are explicit.
- Renderer code receives narrow typed IPC capabilities and no Node.js access.
- Secrets, SSH credentials, and raw customer data are never persisted in logs.
- The prototype is preserved for interaction evidence but is not promoted into
  production code unchanged.

## Open Decisions

- Production module/package layout and state model.
- Revision and content-fingerprint semantics when the CLI reports no version.
- SSH transport, host-key policy, cancellation, and structured error mapping.
- Persistence format for targets, collections, and non-authoritative snapshots.
- Collection provenance, review, pinning, and update policy.
- macOS, Windows, and Linux signing, packaging, and application updates.

Record durable answers under `docs/adr/` before implementation depends on them.
