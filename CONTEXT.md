# Skills Desktop Context

## Product Intent

Skills Desktop is a cross-platform Electron client for developers who manage
agent Skills across local harnesses and remote machines. It provides inventory,
comparison, mutation planning, and curated collections while delegating actual
skill operations to `npx skills`.

## Language

**Target**: An application-owned, stable `TargetId` selecting one machine,
workspace, and harness, such as local Codex or a Pi installation on an SSH
host. Its display label and SSH connection reference are attributes, not
identity.

**Target Definition**: The application-owned, non-secret description of a
Target's kind, display label, workspace, harness, and Connection Reference.

**Target Generation**: A monotonic revision of everything that can affect a
Target's execution. A change to its definition, effective transport binding,
host trust, or wire dialect advances the generation, makes its Inventory stale,
and invalidates its Prepared Mutations.

**Connection Reference**: The configured OpenSSH host alias used to resolve and
connect to an SSH Target. It is neither the Target identity nor proof of the
remote host's identity.

**Effective Target Binding**: The resolved execution facts for one Target
Generation, including effective OpenSSH endpoint and host-key lookup identity,
workspace, harness, host trust, and wire dialect. It is frozen while a Skills
Process is used and re-resolved for a later operation rather than silently
drifting.

**Skills Process**: The shared `observeInventory`, `prepareMutation`, and
`executeConfirmed` interface returned after opening a Target. Opening freezes an
Effective Target Binding; it does not establish or retain an SSH connection.
Local and SSH implementations are substitutable at this interface.

**Target Session**: The current application-session association of one Target
Generation, its frozen Effective Target Binding, its Skills Process, and its
latest Fresh Inventory. It carries no persistent or retained SSH connection and
is replaced when its Target is refreshed or changes.

**Host Trust Record**: An application-owned OpenSSH-format binding between an
effective host-key lookup identity and an explicitly confirmed public host key.
It contains no credential and does not modify the user's `known_hosts`. A key
change requires an explicit rotation flow and is never accepted as first-use
trust.

**Remote Bootstrap**: The build-time fixed, versioned Node program invoked for
one SSH operation. Its remote command contains no Target or Mutation data; it
validates structured Wire Protocol requests and constructs only the closed set
of supported `npx skills` argument arrays.

**Wire Protocol**: The versioned, length-prefixed structured frames exchanged
with a Remote Bootstrap over SSH stdin and stdout. It transports closed skill
operations and evidence, never renderer-generated command text or generic
argument vectors.

**Remote Outcome Uncertain**: A mutation disposition used when the local SSH
transport ended without a final Remote Bootstrap frame proving remote child
cleanup and observable effects. Cancellation requested and local transport
exited are evidence, not proof that the remote operation stopped.

**Reconciliation Required**: A Target state entered when a Mutation Guard lacks
the required terminal certainty, including after a Remote Outcome Uncertain or
an application restart. It blocks further mutations until the original
operation deadline has passed and an explicit reconciliation establishes a
fresh Inventory; an ordinary refresh or automatic retry cannot clear it.

**Mutation Guard**: A durable safety marker written before a mutation can start
and retained until the required terminal certainty is recorded. Its presence
after a restart puts the Target into Reconciliation Required.

**Inventory**: The normalized result of a read-only `npx skills list --json`
invocation for one target. It is a snapshot, not a second source of truth.

**Inventory Snapshot**: The persisted, allowlisted last complete Inventory for
one Target Generation. It is non-authoritative and is always restored as a
Stale Inventory.

**Fresh Inventory**: The latest complete Inventory observed in the current
application session for an unchanged Target. It is the only Inventory that may
serve as the basis for a Prepared Mutation.

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
refresh fails, its Target changes, or it is restored in a new application
session. Elapsed time alone does not make an Inventory stale. A stale Inventory
may be inspected and compared, but cannot authorize a mutation.

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

**Renderer Capability**: A purpose-built, versioned request that an ordinary
renderer may make through its preload interface. It grants no direct process,
filesystem, persistence, confirmation, or execution authority; the main
process validates the sender, payload, and current application state before
acting.

**Trusted Review**: A main-owned, single-use opportunity to approve or reject
one exact review projection. An ordinary renderer may request its presentation
but cannot make the decision; approval is accepted only from the dedicated
role-bound confirmation surface and never crosses IPC as execution authority.

**Collection**: A reviewed recipe selecting exact skill names from one existing
source for one or more Targets. It can produce Mutation Intents but never owns
installed Skills, defines desired state, or creates a second installation
protocol.

**Official Collection**: A Collection owned by Skills Desktop maintainers and
shipped with the application. V1 executes only Official Collections; imported,
user-edited, and remotely supplied catalogs are not Official Collections.

**Collection Release**: An immutable reviewed version within a stable Official
Collection identity, ordered by a release number and identified by its manifest
digest. It binds one Reviewed Source Revision, exact skill names, compatibility
claims, and a Collection Review Receipt.

**Reviewed Source Revision**: The full immutable Git commit whose source content
was reviewed for a Collection Release. It constrains the requested source
snapshot but is not evidence of the Revision actually installed on a Target.

**Collection Review Receipt**: Evidence binding a Collection Release to its
author, an independent reviewer, review time and location, and review policy.
It explains curation provenance but grants no mutation authority.

**Collection Compatibility**: A Collection Release's explicit claim about the
Harnesses, platforms, CLI dialect, and Target capabilities it supports. Missing
or unverifiable compatibility is not assumed compatible.

**Collection Update**: A newer reviewed Collection Release, not upstream source
drift or evidence that installed Skills require an update.

**Collection Status**: Whether a Collection Release is active, deprecated, or
revoked. Only active releases can produce new Mutation Intents; other statuses
never remove or alter installed Skills automatically.

**Collection Acknowledgement**: A record that a user reviewed a Collection
Release or its delta. It is neither evidence that the Collection was applied nor
an installed Collection version.

**Collection Assessment**: The per-Target classification of a Collection
Release against an Inventory, preserving missing, present-content-unknown,
source-conflict, removal-candidate, and incompatible outcomes.

**Collection Intent**: A structured request to apply selected entries from one
active Collection Release to explicit Targets and scopes. It has no mutation
authority and contains no command text, wildcard, or generic CLI options.

**Collection Plan**: A review-only aggregation of one Collection Intent's
release evidence, assessments, and exact per-Target Command Plans. Its aggregate
confirmation authorizes only the bound single-use child Confirmed Mutations and
does not make their execution transactional.

## Non-Negotiable Boundaries

- `npx skills` remains authoritative for list, add, remove, and update.
- Local commands use argument arrays at the process boundary, never shell-built
  command strings.
- SSH host identity, target selection, and mutation confirmation are explicit.
- V1 SSH Targets provide a POSIX login shell and compatible `node` and `npx`;
  Windows may host the desktop client but is not a V1 SSH Target platform.
- Each remote observation or execution uses a fresh SSH session. Cancellation
  keeps local transport termination distinct from confirmed remote cleanup and
  from certainty about mutation effects.
- Renderer code receives narrow typed IPC capabilities and no Node.js access;
  the ordinary renderer cannot confirm a mutation or its cancellation.
- Secrets, SSH credentials, and raw customer data are never persisted in logs.
- The prototype is preserved for interaction evidence but is not promoted into
  production code unchanged.

## Open Decisions

No unresolved product, architecture, or verification decisions remain for the
V1 specification.

Record durable answers under `docs/adr/` before implementation depends on them.
