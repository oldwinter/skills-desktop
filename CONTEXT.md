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

**Fresh Inventory**: The latest complete Inventory observed for an unchanged
Target. It is the only Inventory that may serve as the basis for a Prepared
Mutation.

**Skill Identity**: A stable, case-sensitive skill name plus its declared
source. Missing source provenance leaves identity incomplete. A filesystem path
is evidence, not identity.

**Declared Source**: The exact, case-sensitive `(sourceType, source)` pair
reported by `npx skills`. Skills Desktop does not rewrite or equate source
aliases. `sourceUrl` is potentially sensitive provenance and replay evidence,
not identity. A null `source` leaves Skill Identity incomplete.

**Comparison Key**: A skill's case-sensitive name, used only to align possible
matches across Target inventories. It is not Skill Identity; aligned entries
with different declared sources remain a source mismatch.

**Revision**: An opaque, immutable source revision explicitly reported through
an authoritative `npx skills` interface and retained with its kind and
authority. Unknown remains unknown; it is not converted into an app-defined
semantic version.

**Source Reference**: A branch, tag, or other potentially mutable source ref.
It is provenance, not a Revision or Content Fingerprint.

**Content Fingerprint**: A content digest reported through an authoritative
`npx skills` interface. Skills Desktop does not scan or hash installed skill
directories to derive one. When none is reported, it remains unknown.

**Unknown Evidence**: An authoritative field that is absent or unsupported.
Unknown evidence establishes neither equality nor drift and does not make an
Inventory stale.

**Stale Inventory**: The last successful Inventory retained after a later
refresh fails or its Target changes. Elapsed time alone does not make an
Inventory stale. A stale Inventory may be inspected and compared, but cannot
authorize a mutation.

**Comparison**: A dimensioned diff between two Target inventories. It preserves
presence, Declared Source, selected-harness availability, Revision, Content
Fingerprint, and Inventory freshness outcomes rather than collapsing them into
one status.

**Mutation Intent**: A structured request to add, remove, or update explicitly
named skills in an explicit scope. It contains no command text or arbitrary CLI
options.

**Prepared Mutation**: A validated Mutation Intent bound to one Target and a
fresh Inventory, paired with a Command Plan for review. It has no execution
authority.

**Confirmed Mutation**: Single-use authorization for one exact Prepared
Mutation after its Command Plan is accepted. Any change requires a new
confirmation.

**Mutation Outcome**: Evidence from attempting a Confirmed Mutation. It keeps
the process disposition separate from verification of observable effects; a
zero exit alone is not success.

**Command Plan**: A reviewable description of a Prepared Mutation. Its preview
strings are explanatory output and never executable input.

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
- SSH transport, host-key policy, cancellation, and structured error mapping.
- Persistence format for targets, collections, and non-authoritative snapshots.
- Collection provenance, review, pinning, and update policy.
- macOS, Windows, and Linux signing, packaging, and application updates.

Record durable answers under `docs/adr/` before implementation depends on them.
