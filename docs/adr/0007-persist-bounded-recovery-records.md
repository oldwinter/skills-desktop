# Persist bounded recovery records without transferring authority

Skills Desktop persists only the application records and recovery evidence
needed to restore a useful, safe state. `npx skills` remains the sole authority
for installed Skills: a persisted Inventory Snapshot is allowlisted observation
evidence, never a cache that can authorize mutation, and is always restored as
stale after application restart. Prepared or Confirmed Mutations, confirmation
tokens, trust challenges, executable plans, derived comparisons, raw process
streams, and unrecognized fields are never persisted.

V1 uses independently versioned UTF-8 JSON documents for Target Definitions,
Collection metadata, Inventory Snapshots, and Mutation Guards, plus the
OpenSSH-format public host-key store established by ADR 0006. Only the Electron
main process writes these stores. Each write uses a flushed same-directory
temporary file and atomic replacement under a single-writer application lock;
the parent directory is synchronized where the platform supports it. Before a
mutation process may start, its minimal per-Target Mutation Guard must be
durable. The guard records recovery identity, phase, deadline, and effects
certainty, but no intent, skill names, arguments, preview, or execution
authority.

## Consequences

- Each Target retains at most one last-known-good Inventory Snapshot. A
  complete observation atomically replaces it; failed or partial observations
  do not. A Target Generation change leaves the prior Snapshot inspectable as
  stale until a new complete observation replaces it.
- Filesystem paths reported by the CLI, `sourceUrl`, unknown CLI extensions,
  raw stdout or stderr, SSH transport evidence, effective network identity,
  credentials, environment values, executable arguments, and executable
  previews are excluded by field allowlists. User-configured Target labels,
  workspaces, harnesses, and OpenSSH aliases may be stored as sensitive local
  configuration.
- A Target with a Mutation Guard cannot be mutated or deleted. A guard that
  survives restart or lacks terminal certainty yields Reconciliation Required;
  a conservative extra reconciliation is preferable to losing an uncertain
  mutation. Host Trust Records require separate explicit deletion or rotation
  because multiple Targets may share one host identity.
- V1 stores no long-term Mutation Outcome history. Bounded diagnostic logs
  contain only minimal structured evidence, expire after seven days or 10 MiB,
  whichever comes first, and can be cleared immediately.
- Every document declares its kind and schema version. Readers use explicit,
  deterministic version-by-version migrations; writers emit only the current
  version. Migrations validate in memory and atomically replace the document,
  retaining one last-known-good pre-migration copy. Unknown fields do not pass
  through automatically, and released field meanings are not reinterpreted.
- A newer unsupported schema is never overwritten by an older application.
  Corrupt or failed-migration input is retained and quarantined rather than
  treated as empty. Failures are isolated by store: an Inventory Snapshot can
  be regenerated, while unreadable Target or host-trust data disables its use
  and unreadable initialized Mutation Guard data fails closed for affected
  Targets.
- Internal stores are not a stable interchange, backup, or synchronization
  format. V1 offers only a redacted diagnostic export, excluding Target
  Definitions, host trust, Inventory contents, Mutation Guard payloads, and raw
  logs. Collection governance defines which metadata enters its store without
  changing these persistence constraints.

This trades general history, synchronization, and database querying for a
small, auditable persistence boundary with explicit crash and downgrade
behavior. Moving to a database later remains possible behind the store
interfaces without changing data authority or recovery semantics.
