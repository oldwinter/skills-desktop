# Center production on Desktop Capabilities

V1 uses one deep main-process `DesktopCapabilities` Module as its application
orchestrator, while retaining `SkillsTargets`, `SkillsProcess`, and
`RecoveryRecords` as the other principal Interfaces. This concentrates domain
state, authorization, review, execution ordering, events, and redaction in main
without turning every workflow or source directory into a public seam.

## Module Interfaces

The Electron Adapter attaches an already verified endpoint to
`DesktopCapabilities` and receives a role-specific session. A workspace session
provides a Snapshot, a closed versioned request union, an ordered event sink,
and teardown; a review session can only read and decide its one assigned Trusted
Review. Role-specific preloads translate those internal requests into
purpose-built renderer methods and never expose the union, channel names, or
main-owned authority.

`SkillsTargets` owns Target Definitions and Generations, host-trust decisions,
Local or SSH selection, and `open(TargetId)`. Each successful refresh creates a
main-owned Target Session that binds one Target Generation, frozen Effective
Target Binding, `SkillsProcess`, and Fresh Inventory. Preparing, reviewing, and
executing a mutation use that same session; a later refresh, Target change, or
binding drift replaces it and invalidates dependent work without retaining an
SSH connection.

`SkillsProcess` keeps the accepted `observeInventory`, `prepareMutation`, and
`executeConfirmed` Interface. Local and SSH are its production Adapters and run
the same contract suite. There is no public command planner, process runner,
SSH command builder, transport plugin registry, or arbitrary argument seam.

`RecoveryRecords` exposes only `restore()` and `commit(DurableChange)`, where
`DurableChange` is a closed union of the accepted record transitions. Its JSON
Adapter hides the application lock, independently versioned documents,
migrations, allowlists, flushed same-directory temporary files, atomic
replacement, directory synchronization, backups, and quarantine. Tests use an
in-memory and fault-injection Adapter; callers never receive a generic file or
JSON repository.

Comparison, Official Collection validation and assessment, application state
transitions, and renderer projections are in-process parts of the
`DesktopCapabilities` Implementation. They may be organized into private
Modules and tested through their owning Interface, but V1 does not promote them
to public ports with hypothetical Adapters.

## State Ownership

- Durable state comprises Target Definitions and Generations, allowlisted
  Inventory Snapshots, Mutation Guards, Collection acknowledgements, public
  Host Trust Records, and bounded diagnostic logs. `RecoveryRecords` owns their
  bytes and migrations; the domain Modules own their meanings and transitions.
- Refreshed main-session state comprises Target Sessions, Fresh Inventories,
  Effective Target Bindings, active operations and cancellation controls,
  Prepared and Confirmed Mutations, Trusted Reviews, current outcomes, and
  event epochs, sequences, and revisions.
- Derived state comprises Comparisons, Collection Assessments, Command and
  Collection Plans, eligibility and blocking reasons, and redacted Snapshot,
  result, and event projections. It is recomputed from identified inputs and is
  never persisted.
- View-local state comprises routes, selected rows and Targets, search, sort,
  filters, expanded regions, focus, scroll, and unsubmitted form drafts. It is
  owned by the renderer and may be discarded at any time.

The renderer's Snapshot mirror is presentation data, not another source of
truth. V1 does not persist domain state in renderer storage. Renderer reload or
loss invalidates its unconfirmed work but does not cancel a main-owned active
mutation or clear its Mutation Guard.

Per-Target coordination rejects conflicting work instead of creating an
implicit queue; duplicate observations may share one operation. A Collection
reserves all affected Targets in stable order before its first child starts and
then executes the confirmed children sequentially under the accepted fail-stop,
no-rollback semantics.

## Workspace And Dependency Layout

Production uses three private npm workspaces built from one commit, root
lockfile, and application version:

```text
apps/desktop/
  src/contracts/
  src/main/{application,targets,persistence,adapters}/
  src/main/composition-root.ts
  src/preload/{workspace,review}.ts
  src/renderer/features/
  src/review-renderer/
packages/skills-runtime/
packages/remote-bootstrap/
```

`apps/desktop` contains the Electron main process, role-specific preloads,
ordinary and review renderers, all desktop Modules, and production Electron,
process, OpenSSH, and filesystem Adapters. `skills-runtime` contains only the
environment-neutral closed skill operations, supported CLI dialect and parser,
and Wire Protocol schemas and codec shared by the desktop and Remote Bootstrap.
`remote-bootstrap` is the separately built fixed remote entry point and imports
only `skills-runtime`.

Renderer code imports only bounded renderer contracts and renderer code.
Preloads import only those contracts and the permitted Electron renderer
surface. Main-only authority types, persistence schemas, executable plans, and
Wire frames never enter renderer contracts. The desktop composition root is the
only place that imports every production Adapter; package exports, TypeScript
project references, and import lint rules enforce these directions.

All workspaces remain private and are not independently published or
semantically versioned. IPC, persistence, CLI dialect, and Wire Protocol data
retain explicit schema versions, while the built Remote Bootstrap digest is
embedded into the desktop release. The validated `prototype/` remains outside
the production workspaces and is neither imported nor promoted.

## Composition And Renderer

Startup acquires the single-writer lock, restores each recovery record with
failure isolation, validates the bundled Official Collection catalog, converts
surviving Mutation Guards into Reconciliation Required state, constructs the
Modules and Adapters, and only then opens windows and IPC. Shutdown stops new
requests, invalidates unused reviews, and applies the accepted bounded
cancellation and uncertain-outcome rules before releasing resources.

Main uses explicit state transitions and a monotonic state revision, not event
sourcing or a persisted global store. Events are bounded notifications about
state changes; a Snapshot remains the recovery authority.

The production renderer uses TypeScript and React with one `DesktopClient`
Adapter, one replaceable Snapshot mirror, and feature-local views, selectors,
and reducers for inventory, comparison, Collections, Targets, operations, and
reconciliation. V1 adds no third-party global state library. The production UI
recovers the prototype's validated interaction and design decisions but does
not copy its monolithic module, sample records, or command-preview builders.

## Verification Consequences

The durable architecture test surfaces are the `DesktopCapabilities` session
contract, the common Local and SSH `SkillsProcess` contract, the memory and JSON
`RecoveryRecords` contract, and `skills-runtime` CLI and Wire conformance.
Packaged Electron smoke, a small read-only real-CLI smoke, and a disposable
localhost SSH integration cover the true external seams. The dependent
verification decision defines the concrete scenarios and tracer-bullet order.

This layout deliberately accepts a large `DesktopCapabilities` Implementation
behind a small Interface. Deleting that Module would redistribute authorization,
state ownership, Trusted Review, guard ordering, operation recovery, events,
and redaction across IPC handlers and renderer callers, so the Module earns its
Depth and keeps those rules local.
