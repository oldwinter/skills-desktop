# Recover through versioned records and typed repairs

Status: Accepted

## Context

Multi-harness Targets, Wire v3, Packages, Studio, and Git add durable records
and failure states. Recovery must preserve existing shipped data, avoid
clearing safety evidence, and give users repair paths without a generic
"clear" or replay command.

## Decision

`RecoveryRecords` remains the only durable safety-transition seam, exposing
`restore()` and `commit(DurableChange)`. `DurableChange` is extended as a
closed union for Target v4, Inventory Snapshot replacement, Mutation Guard v3,
Publication Guard v1, host trust plus multi-Target invalidation, Package
identity and acknowledgement, and typed recovery completion. Studio Draft
content may use a separate main-only Draft Store because it grants no process
or mutation authority.

Target v3 migrates its singular harness to a canonical non-empty `harnessIds`
set in Target v4. Known legacy labels map only through reviewed rules. TargetId
is preserved, Generation advances exactly once, and existing Inventory remains
retained but Stale. An unknown legacy harness blocks migration and remains
recoverable; it is never guessed. A surviving Guard stays attached to the same
Target and blocks execution.

Mutation Guard v2 migrates to v3 with binding, dialect, registry, and
harness-set digests. A legacy surviving Guard restores Reconciliation
Required. Workspace and Review v1 are ephemeral and receive no durable
migration; v2 rejects v1 senders. Wire v3 has no downgrade. Existing Inventory
Snapshot v3 and Official Collection catalog v1 remain readable without
reinterpretation. New Package, Draft, Preference, and Publication Guard stores
start at v1.

Every durable store uses strict allowlists, deterministic adjacent-version
migration, a verified pre-migration backup, flushed same-directory temporary
write, atomic replacement, and quarantine or failure markers. Newer schemas are
retained and write-blocked. Corrupt or failed migration is never treated as
empty.

Recovery Center is a main-owned projection with state-specific typed actions.
It may reconcile an expired Mutation Guard, read back a Publication Guard,
repair a Target when no Guard blocks it, or quarantine a damaged Draft. It
offers no generic Guard clear, mutation retry, push retry, accept-any-host,
clear-all-corruption, or overwrite-newer action. Forced shutdown never clears
a Guard merely because the app exits.

## Alternatives considered

- Reset unknown or corrupt state to defaults. Rejected because it discards
  evidence and can reopen consequential operations unsafely.
- Add a generic recovery JSON editor. Rejected because it transfers durable
  authority outside the closed domain transitions.
- Migrate all stores as one global document. Rejected because unrelated
  failures should remain isolated where safety permits.

## Consequences

Every migration needs old, corrupt, interrupted-write, newer-version,
idempotence, backup, and retained-authority fixtures. Recovery is explicit and
can remain blocked when certainty cannot be established.

## Relationship to earlier decisions

This record amends ADR 0007. It preserves its single-writer, stale restore,
minimal Guard, atomic write, backup, quarantine, newer-schema refusal, and
non-authoritative persistence rules while extending the closed transition set.
