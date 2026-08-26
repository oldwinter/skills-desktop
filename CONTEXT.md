# Skills Desktop Context

## Product Intent

Skills Desktop is a cross-platform Electron client for developers who manage
agent Skills across local harnesses and remote machines. It provides inventory,
comparison, mutation planning, and curated collections while delegating actual
skill operations to `npx skills`.

## Language

**Harness**: One exact canonical CLI integration identified by `HarnessId`.
Display names and translations are presentation only and never become CLI
input.

**Harness Compatibility Registry**: Versioned, reviewed compatibility metadata
bound to one pinned Skills Dialect. It defines the exact supported `HarnessId`
set and evidence mappings without claiming installed state or discovering
future upstream harnesses.

**Skills Dialect**: The exact reviewed command and parser contract for one
pinned `npx skills` version. It defines supported operations and evidence
grammar without exposing generic command or option authority.

**Target**: An application-owned, stable `TargetId` selecting one machine, one
canonical workspace, and a non-empty canonical Harness set. Its display label,
SSH Connection Reference, and scopes are attributes or operation dimensions,
not identity.

**Target Definition**: The application-owned, non-secret description of a
Target's machine, display label, workspace, Harness set, Skills Dialect, and
Connection Reference.

**Target Generation**: A monotonic revision of everything that can affect a
Target's execution. A change to its definition, effective transport binding,
host trust, Skills Dialect, Harness Compatibility Registry, Wire Protocol, or
Remote Bootstrap advances the generation, makes its Inventory stale,
and invalidates its Prepared Mutations.

**Connection Reference**: The configured OpenSSH host alias used to resolve and
connect to an SSH Target. It is neither the Target identity nor proof of the
remote host's identity.

**Effective Target Binding**: The resolved execution facts for one Target
Generation, including effective OpenSSH endpoint and host-key lookup identity,
Effective OpenSSH endpoint and host-key lookup identity, workspace, Harness
set, host trust, Skills Dialect, Harness Compatibility Registry, Wire Protocol,
and Remote Bootstrap. It is frozen while a Skills Process is used and
re-resolved for a later operation rather than silently drifting.
**Skills Process**: The shared `observeInventory`, `prepareMutation`, and
**Skills Process**: The shared `observeInventory`, `inspectSource`,
`prepareMutation`, and `executeConfirmed` interface returned after opening a
Target. Opening freezes an Effective Target Binding; it does not establish or
retain an SSH connection. Local and SSH implementations are substitutable at
this interface.
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

**Wire Protocol v3**: The fail-closed, length-prefixed structured frames
exchanged with a Remote Bootstrap over SSH stdin and stdout. Every operation
binds the exact protocol, Target Generation, Skills Dialect, Harness
Compatibility Registry, Remote Bootstrap, POSIX workspace, and Harness set. It
transports closed Skill operations and evidence, never renderer-generated
command text or generic argument vectors.

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

**Inventory**: One complete normalized project-and-global observation through
the pinned `npx skills list --json` dialect for a Target. It is a snapshot, not
a second source of truth.

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

**Source Descriptor**: A closed, versioned description of one user-approved
source form. It preserves the exact case-sensitive form and separately names
its source family and mutable Source Reference, if any. A local source enters
through a main-owned Filesystem Grant.

**Source Inspection**: Session-only candidate evidence produced by the pinned
CLI for one Source Descriptor and exact Target binding. It grants no mutation
authority and proves no installed Revision or Content Fingerprint.

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
per-scope presence, Declared Source, per-Harness coverage, Revision, Content
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

**Filesystem Grant**: An opaque, main-owned, purpose-bound authorization for one
named file operation under one canonical local root. It is bound to a renderer
document epoch and never becomes a generic path or filesystem capability.

**Trusted Review**: A main-owned, single-use opportunity to approve or reject
one exact review projection. An ordinary renderer may request its presentation
but cannot make the decision; approval is accepted only from the dedicated
role-bound confirmation surface and never crosses IPC as execution authority.

**Collection**: A reviewed recipe selecting exact skill names from one existing
source for one or more Targets. It can produce Mutation Intents but never owns
installed Skills, defines desired state, or creates a second installation
protocol.

**Official Collection**: A Collection owned by Skills Desktop maintainers and
shipped with the application under the Official review trust root. Matching
metadata never gives a User Package or Imported Package Official identity.

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

**Package**: A metadata and source recipe that may be assessed or expanded into
ordinary Mutation Intents. It is never installed state or desired state.

**User Package**: A mutable Package authored by the user. It has no Official
trust and keeps its own origin identity.

**Imported Package**: An immutable Package accepted from one canonical
`.skillpack` document. Editing it creates a User Package rather than changing
its imported origin.

**Skillpack**: A strict, canonical, metadata/source-only JSON interchange
document. It contains no Skill content, credentials, Target data, installed
state, executable arguments, raw output, review, or Guard authority.

**Studio Draft**: A versioned, independently recoverable local authoring record
for static Agent Skills metadata, Markdown, and resource references. It is not
execution authority.

**Deterministic Artifact**: A validated discovery file or Skill artifact whose
path, raw bytes, digest, ordering, and archive metadata are fixed by one
exporter profile. Identical inputs under that profile produce identical output.

**Publication Plan**: An expiring review projection binding one sanitized Git
remote, exact branch, reviewed base, candidate commit, managed files and
digests, and deterministic tree digest. It grants no push authority.

**Publication Guard**: Durable safety evidence written before a reviewed Git
push may start. An uncertain push retains the Guard until exact remote-ref
readback reconciles the outcome.

**Browser Handoff**: One explicit main-owned request to open a generated,
allowlisted HTTPS URL in the system browser. It proves only that the operating
system accepted the open request, not that an external publication succeeded.

**Workspace Protocol v2**: The strict bundled request, result, event, and
Snapshot vocabulary shared by the ordinary renderer, preload, and main. It is
a closed product interface with no generic process, filesystem, SSH, Git, URL,
or confirmation operation.

**Review Protocol v2**: The strict bundled projection and decision vocabulary
for one role-bound Trusted Review. It carries explanatory facts and
`approve`/`reject`, never executable input or a reusable confirmation token.

**Recovery Center**: A main-owned projection of fail-closed durable and session
states with only state-specific typed repair actions. It has no generic clear,
retry, replay, or overwrite-newer action.

**Unsigned Candidate**: Exact prerelease bytes that passed the stated
reproducible candidate gates but carry no Apple or Windows publisher trust. An
Unsigned Candidate is not automatically public.

**Unsigned Developer Preview**: A public GitHub pre-release containing exact
unsigned candidate bytes, checksums, an SPDX SBOM, GitHub artifact attestations,
and source identity. It is an early-access distribution surface, not a Stable
Release, carries no Apple or Windows publisher trust, is never marked latest,
and is excluded from automatic update feeds. Users verify the downloaded bytes
before following explicit platform-owned manual installation or override steps.

**Stable Release**: The signed, notarized, independently approved publication
defined by ADR 0011. Deferring paid signing prerequisites does not weaken its
acceptance criteria or allow an Unsigned Developer Preview to be promoted in
place.

## Non-Negotiable Boundaries

- `npx skills` remains authoritative for list, add, remove, and update.
- Local commands use argument arrays at the process boundary, never shell-built
  command strings.
- SSH host identity, target selection, and mutation confirmation are explicit.
- A Remote SSH Target provides a POSIX environment with compatible `node` and
  `npx`; Windows may host the desktop client but is not a Remote SSH Target.
- Each remote observation or execution uses a fresh SSH session. Cancellation
  keeps local transport termination distinct from confirmed remote cleanup and
  from certainty about mutation effects.
- Renderer code receives narrow typed IPC capabilities and no Node.js access;
  the ordinary renderer cannot confirm a mutation or its cancellation.
- Secrets, SSH credentials, and raw customer data are never persisted in logs.
- The prototype is preserved for interaction evidence but is not promoted into
  production code unchanged.
- Public unsigned artifacts are labelled only as Unsigned Developer Previews.
  They remain prereleases, never activate automatic updates, and never claim
  platform signing, notarization, publisher identity, or Stable Release status.

## Open Decisions

No unresolved product, architecture, or verification decisions remain for the
accepted comprehensive-evolution architecture. ADRs 0014 through 0024 record
the decisions that dependent milestone work must follow.
