# Verify deep interfaces through staged tracers

V1 verification treats the accepted deep Interfaces as its long-lived behavior
contracts and uses a staged sequence of end-to-end tracer bullets to carry the
specification into implementation tickets. Deterministic contract evidence
blocks ordinary changes; small external smoke suites check the true CLI, SSH,
Electron, and distribution seams without duplicating the behavior model or
making developer state part of a test fixture.

## Durable Verification Surfaces

Four suites define the stable architecture test surface:

1. `skills-runtime` conformance covers the pinned CLI dialect, normalized
   Inventory schema, evidence and Comparison semantics, and Wire Protocol.
2. The common `SkillsProcess` contract runs against Local and scripted SSH
   Adapters through `observeInventory`, `prepareMutation`, and
   `executeConfirmed`.
3. The `RecoveryRecords` transition contract runs against memory and production
   JSON/fault-injection Adapters through `restore()` and
   `commit(DurableChange)`.
4. The `DesktopCapabilities` role-session contract drives application
   workflows through in-memory Adapters and the same strict request, result,
   Snapshot, review, and event schemas used by Electron.

Tests enter through those Interfaces and assert observable results rather than
private state. Comparison, Collection assessment, state transitions, renderer
projections, and other private Modules do not become public seams for test
convenience. Focused internal tests remain appropriate only where a public
result cannot fully prove a security-critical mechanism, including exact local
argument arrays, process-tree termination, the constant SSH command and Wire
framing, atomic filesystem replacement, Electron fuses, and platform signature
verification.

Packaged Electron, the pinned real CLI, disposable localhost SSH, and final
platform artifacts are external smoke surfaces. They check that production
Adapters still meet the contracts but do not create a second, weaker behavior
specification.

## Evidence Policy

Required change gates use version-labelled input and output fixtures, scripted
executables, temporary directories, controlled clocks and identifiers, and
explicit barriers for concurrency. Tests do not use arbitrary sleeps to infer
ordering and never read or mutate the developer's real Inventory, Targets,
credentials, or recovery records.

The normal real-CLI smoke is read-only and invokes the exact supported
`npx skills` version. A real add, remove, or update compatibility exercise is
reserved for a release candidate running with a disposable HOME and workspace
against an explicitly reviewed fixture source. Network or upstream availability
therefore cannot make an ordinary pull-request contract nondeterministic.
Disposable localhost SSH exercises the system OpenSSH and Remote Bootstrap
integration without relying on a durable external host.

Global coverage percentages are diagnostic and never substitute for acceptance.
Every member of a closed operation, request, result, error, schema-version, and
effects-certainty union has a named behavior case. Security failure cases prove
the absence of authority or data loss: no process spawn, no unauthorized state
transition, no overwrite of a newer schema, and no secret sentinel in public or
logged evidence. Schema parsers, migrations, and Wire framing receive boundary,
generated, and malformed inputs. Stable snapshots are limited to bounded public
structured projections; tests do not snapshot private state, whole rendered
pages, or raw command output.

## Contract Scenarios

`skills-runtime` fixtures cover empty and non-empty project and global lists,
valid stdout with non-empty stderr, null provenance, bounded additive fields,
duplicate and conflicting entries, output limits, invalid JSON, known-field
incompatibility, and unsupported versions. Comparison tables independently
exercise presence, Declared Source, selected Harness, Revision, Content
Fingerprint, and freshness. Unknown Evidence establishes neither equality nor
drift, and Stale Inventory never becomes mutation authority.

The `SkillsProcess` contract covers exact named and scoped add, remove, and
update intents, expansion of an explicit update-all request during preparation,
Fresh Inventory eligibility, and rejection of wildcard, arbitrary option, stale,
or otherwise unsupported input. Tests observe the safe Command Plan through the
Interface. One concentrated internal planner test proves that the public review
and private executable arguments derive from the same normalized intent, with a
fixed dialect and argument order; preview text is never sent back for execution.

Deterministic lifecycle traces exercise prepare, expiry, drift, review,
single-use confirmation, durable Mutation Guard, spawn, termination, postflight,
and Reconciliation Required. A missing or failed durable Guard, expired or
replayed review, changed binding, newer Inventory, concurrent consumption, or
digest mismatch produces no spawn. Process disposition and observable effects
remain separate. Postflight runs only when termination is known, cancellation
and timeout retain the correct effects certainty, started operations are not
retried, and per-Target conflicts fail rather than queue.

The `RecoveryRecords` contract covers every allowed transition and field
allowlist. JSON-specific fault injection covers flushed temporary writes,
replacement and directory-sync failures, last-known-good retention, quarantine,
store-specific failure isolation, deterministic version-by-version migration,
and refusal to overwrite a newer schema. A surviving, unreadable, or uncertain
Mutation Guard restores the affected Target fail closed and continues to block
mutation until explicit reconciliation.

Local and SSH Adapters run the same `SkillsProcess` lifecycle cases. SSH-only
coverage includes `ssh -G` resolution, first host trust, key change and explicit
rotation, configuration drift, the fixed remote command, shell metacharacters
inside structured data, Wire version and length errors, protocol contamination,
missing remote runtime, and non-specific OpenSSH exit 255. Cancellation with a
valid final Remote Bootstrap frame may establish cleanup; local SSH termination
without that frame yields Remote Outcome Uncertain, retains the Guard, blocks
later mutation, and requires explicit reconciliation. Sentinel cases prove that
host, user, path, proxy, agent, payload, and raw-stream data do not escape the
Adapter.

The `DesktopCapabilities` suite covers the complete request-by-role matrix,
strict input and output schemas, malicious or stale senders, subframes and
navigations, review expiry/replay/concurrency/drift, renderer teardown, event
ordering, bounded buffering, gaps and resynchronization, and redaction on every
result, event, and exception path. It proves that no ordinary renderer request
sequence can execute a mutation without one valid role-bound Trusted Review and
a successfully committed Mutation Guard.

Official Collection cases cover manifest versions and digests, independent
reviewer evidence, compatibility, active/deprecated/revoked status, every
Collection Assessment result, source conflicts, pinned reapply, and unchanged or
removed entries. Multi-Target traces prove stable reservation, sequential child
execution, failure stop, discard of later confirmations, no rollback of
completed children, and no aggregate claim that a Collection is installed.

## Tracer-Bullet Order

Implementation tickets follow eight user-observable vertical slices:

1. **Local Inventory** establishes the production workspaces, a Local Target,
   pinned CLI observation and parsing, persisted stale-on-restart Snapshot, the
   `DesktopCapabilities` read path, preload capability, and the validated
   inventory shell.
2. **Local safe mutation and recovery** adds Command Plans, Trusted Review,
   durable Guard ordering, local execution, postflight, cancellation, restart
   recovery, and reconciliation before any remote mutation exists.
3. **Targets and Comparison** adds durable Target management and the
   Fresh/Stale, authority-preserving multidimensional comparison workflow.
4. **SSH Inventory and Host Trust** adds system OpenSSH resolution, explicit
   trust, Remote Bootstrap and Wire compatibility, and remote observation
   without remote mutation.
5. **SSH mutation and uncertain recovery** reuses the local review and Guard
   lifecycle, then adds remote cleanup evidence, transport-loss handling, and
   reconciliation.
6. **Single-Target Official Collection** adds shipped catalog validation,
   assessment, pinned planning, and a locally executed Collection child.
7. **Multi-Target Collection** adds stable reservation and sequential Local and
   SSH children with fail-stop and no-rollback outcomes.
8. **Cross-platform release** completes platform packaging, install and update
   exercises, signing, integrity evidence, and stable publication gates.

Each slice crosses a renderer capability, `DesktopCapabilities`, the owning deep
Interface, and a production or scripted Adapter, then returns a visible result.
IPC authorization, schema validation, redaction, accessibility, and packaged
Electron smoke grow with every slice instead of being postponed to a final
hardening phase. A slice is not complete when only its mock, renderer, or
private implementation exists.

## Promotion Gates

Every pull request runs type and import-direction checks, all deterministic
contract and schema tests, the Linux packaged Electron smoke, and affected
Windows and macOS process, path, and persistence cases. Protected-main runs add
the complete desktop operating-system test matrix, the pinned real-CLI read-only
smoke, disposable localhost SSH, and unsigned package-generation smoke.

A release candidate adds the isolated real-mutation compatibility exercise,
complete user workflows, package installation and upgrade, security
configuration, and artifact-integrity checks. Stable release then requires the
approved signing environment, verification of the exact candidate bytes across
the recorded support matrix, independent production approval, and publication
without rebuilding. Infrastructure failures may be rerun to classify them but
do not convert a failed required behavior into a pass; a quarantined flaky test
blocks promotion of the slice whose invariant it protects.

The signed candidate matrix covers fresh install, launch, and update from the
previous stable release on macOS `arm64` and `x64` and Windows `x64`. Ubuntu and
Fedora `x64` cover DEB and RPM fresh install, launch, and manual upgrade, while
also proving that Linux exposes no false in-application update authority. Every
platform verifies artifact names and architectures, SHA-256 checksums, SPDX
SBOM association, GitHub attestation, immutable version handling, deferred
restart, and the active-mutation restart block.

Release-workflow checks prove that pull requests receive no credentials,
signing and publication permissions remain separate, final digests do not
change between approval and publication, and reusable Actions are pinned.
Human candidate QA covers the main keyboard workflow, focus, screen-reader
semantics, narrow layouts, and diagnostic export; generated screenshots remain
ephemeral and are not committed. A post-publication check of the real stable
feed completes the release. Failure invokes the accepted stop-distribution and
forward-fix procedure.

## Consequences

This strategy spends more effort on reusable contract matrices and explicit
failure evidence than on tests for private functions. In return, internal
organization can change without rewriting the behavioral suite, Local and SSH
remain substitutable at their real seam, dangerous operations prove negative
properties before execution, and each implementation ticket ends in an
observable vertical result. External tools and platform infrastructure still
require smoke coverage, but their variability cannot weaken the deterministic
merge contract or transfer authority into test-only Interfaces.
