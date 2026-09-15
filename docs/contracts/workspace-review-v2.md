# Workspace and Review protocol v2

Workspace Protocol v2 and Review Protocol v2 are the desktop's canonical
main/preload/renderer contracts. Their shared schemas live in
`apps/desktop/src/contracts/workspace.ts` and
`apps/desktop/src/contracts/review.ts`. Consumers must import those schemas and
types rather than copying projections.

Both protocols have a strict, non-negotiating boundary. A v2 application
accepts only request and Snapshot envelopes whose version is exactly `2`.
Version `1` is rejected as an invalid request or unavailable Snapshot; there is
no mixed-version negotiation or compatibility fallback across the IPC
boundary.

Target Definitions persisted by v2 use durable schema v4. Every Target has a
stable UUID, a nonempty registry-ordered `harnessIds` set, the pinned Skills
dialect and Harness Registry identity, and its execution-binding fields.
RecoveryRecords alone owns durable migration. A reviewed v3 scalar harness
alias is resolved once, the Target generation advances once, and the original
v3 bytes are retained as a verified backup. Retained Inventory remains stale
by generation mismatch, and a surviving Guard is retained as
reconciliation-required authority.

An unmapped scalar harness is never guessed. The original v3 bytes stay in
place, Target writes remain blocked, and Workspace v2 exposes the affected
Target through `blockedTargets` so recovery UI can name it without treating it
as executable authority. Stores newer than the current reader are likewise
left byte-identical and write-blocked.

The only repair is the typed `target.repair` request, which names one blocked
Target and one pinned-registry harness. Main commits it as the closed
`target.repair-legacy-harness` durable change: the legacy document is backed
up verbatim, rewritten with the reviewed harness at the same legacy schema
version, and migrated to v4 only once every Target resolves. A surviving
Mutation Guard refuses the repair. Workspace v2 reports repairs that reached
disk through `recovery.repairedTargets`, and `recovery.restartRequired` tells
the renderer that Target authority is rebuilt on the next start rather than
in place.

Add and remove intents may carry an optional `harnessIds` subset. Preparation
resolves it against the Target's scoped harness set and refuses any harness
outside that set; an omitted subset binds the whole set, so pre-existing
intents are unchanged. The resulting Command Plan records what it can touch in
`harnessEffect`: `bound` lists the harnesses whose links change (the exact
`--agent` set), while `cli-unscoped` marks `update`, which the pinned CLI runs
across every CLI-managed link in the scope regardless of the Target's set.
Trusted Review and the Inventory Command Plan render that field; a plan
without it is read as bound unless its operation is `update`.

The only browser-opening capability is the closed `handoff.skills-sh`
request (ADR 0021). Main derives `skillsShHandoffs` records from Fresh
Inventory entries whose declared source is a GitHub `owner/repository`; each
record is publication data plus an opaque id bound to the session epoch and
Target, and the Snapshot never carries a URL. The request names a record id.
Main rebuilds `https://skills.sh/{owner}/{repository}/{skill}`, allowlists the
exact scheme, host, path shape, and length, and only then hands it to the
system browser; the composition root repeats the allowlist check at the
process edge. Success means a page was opened, never that anything was
published. A record id from another session or a renderer-supplied URL is
`invalid_request`.

Both Snapshots carry an optional `preferences` projection (ADR 0023): the
resolved `locale` (`en` or `zh-CN`), the stored `localePreference` (`system`
or an explicit locale), the OS-derived `systemLocale`, and the `appearance`
(`system`, `light`, `dark`, or `high-contrast`). Main owns the projection and
the durable `preferences.json` record; the renderer applies `lang` and
`data-appearance` to the document from the Snapshot and never flips locally.
The only way to change them is the closed `preferences.update` request whose
patch names at least one of `appearance` or `localePreference`; a patch with
unknown fields or values is `invalid_request`. Message catalogs live in
`apps/desktop/src/contracts/i18n/`; `en` defines the key set and the parity
test refuses a `zh-CN` catalog that adds, drops, or changes placeholders on
any key. Identifiers, Harness IDs, source values, digests, and command
previews are interpolated into messages and never translated.

The application menu is main-owned (ADR 0023) and described by the separate
`apps/desktop/src/contracts/menu.ts` contract beside the About bridge, not by
Workspace v2. `buildApplicationMenu(locale, platform)` is a pure projection of
top-level menus and items (ids, catalog labels, optional Electron accelerator,
its `aria-keyshortcuts` mirror, and either an allowlisted Electron role or one
closed command); the Electron adapter renders exactly that projection and
reinstalls it after every durable preference change, and the native About
panel is set from the same version and release channel the update snapshot
reports. The workspace bridge exposes `menu.getMenu()` (read-only, workspace
main frame only) so the renderer can mirror accelerators and packaged QA can
enumerate the menu, and `menu.subscribeMenuCommand` for the closed relay
event `{ command, schemaVersion: 1 }`. Relayed commands carry no arguments:
`inventory.refresh`, `navigate.*`, and `update.check` are resolved by the
renderer against its own Snapshot and executed through the existing closed
requests (`inventory.refresh` with the active Target, the About update
check); `about.show` and `workspace.show` never reach a renderer. Main relays
only to the workspace attachment that is live at activation and otherwise
recreates or focuses the workspace window; no menu item bypasses
`DesktopCapabilities`.

Source Inspection (ADR 0015) enters through the closed `source.inspect`
request: `{ source, targetId }`. Main classifies the text with
`describeSource` into a `SourceDescriptorV1` (family, `portable` or
`local-only` locality, `mutable` or `pinned` mutability, optional ref) before
anything spawns; option-shaped, whitespace, credential-bearing, control-
character, and out-of-dialect text is `source_unsupported`, and local
directories and archives are refused until a main-owned filesystem grant
exists. A Fresh Target Session is required (`stale_inventory` otherwise), and
an inspection is one exclusive operation like an observation: it runs the
exact read-only argument array `add <source> --list` under a 60-second cap,
never installs, and is cancelled through `inventory.cancel` with the
`activeOperationId` the Snapshot publishes. The Workspace Snapshot carries the
result in the optional `sourceInspection` projection (`phase`,
`activeOperationId`, `lastError`, and one `inspection` with the parsed
candidates, the descriptor, an `inspectionId`, a SHA-256 `digest` of the
canonical descriptor plus listing, and the Target id and Generation it was
taken at). The projection is session evidence only: never persisted, replaced
by the next inspection, and cleared when the Target or its Generation
changes.

An add intent may name either the legacy GitHub `{ source, sourceType:
"github", revision? }` or an inspected source `{ descriptor, inspection:
{ id, digest }, sourceType: "inspected" }`. For an inspected add, main refuses
`mutation.prepare` with `source_inspection_stale` unless the id and digest
name the current inspection for that Target at its current Generation, the
descriptor matches exactly, and every name is among the listed candidates; it
repeats the same check before creating the Mutation Guard at review approval.
The resulting Command Plan `source` is a union of the legacy GitHub shape and
`{ sourceType: "inspected", family, mutability, ref, source, inspectionId,
inspectionDigest }`; `describeCommandPlanSource` in
`apps/desktop/src/contracts/source-disclosure.ts` labels the family and
pinned/mutable status that the Inventory Command Plan and the Trusted Review
disclose before approval. SSH Targets reject `source.inspect` and inspected
adds as next scope; the Wire protocol is unchanged.

Imported Packages (ADR 0017) enter through the closed `package.import`
request, which carries no payload: main opens its own native file dialog
(`SkillpackPicker`), reads at most `SKILLPACK_MAX_BYTES` from the chosen
`.skillpack`, and parses it with the canonical codec; a renderer can never
name a path, and a request with extra fields is `invalid_request`. A build
without a main-owned picker answers `package_import_unavailable`; a document
that fails the codec, its digest, or its schema is `skillpack_invalid`; a
second import while one is open is `mutation_conflict`. Everything is
offline. Accepted documents land in the isolated Package store
(`packages.json`, schema version 1, atomic replace, quarantined when corrupt
or newer than the app understands) through the single `packages.replace`
`DurableChange`; the store keeps at most one record per package ID and never
touches Official acknowledgements. Importing the same ID, release, and
document digest again is idempotent (`identical`); the same ID and release
with a different digest is refused and retained as a bounded `conflict` on the
kept record; a different release replaces the record and records an explicit
`upgrade` or `downgrade` delta. The Workspace Snapshot publishes the result in
`collections.lastImport` (`status`, `packageId`, `release`, `relatedRelease`,
`documentDigest`, `fileName`, `recordedAt`) and the store in
`collections.packages`, each `PublicImportedPackage` carrying
`origin: "imported"`, the document digest, `importedAt`, the declared GitHub
source with a nullable pinned revision, compatibility, retained conflicts, the
last delta, and the same two dimensioned assessments Official releases get;
an unpinned source can never prove a present skill `unchanged`. A Package is
never described as installed.

Applying an Imported Package reuses the guarded Collection path:
`collection.prepare` and `collection.prepare-many` accept an optional
`origin` (`official` by default, or `imported`), where for imported recipes
`collectionId` is the package ID and `manifestDigest` the document digest.
Main resolves the recipe strictly by origin, so a matching ID, release, and
digest never promotes an import to Official (`mutation_ineligible`). The
resulting Collection Plan carries `releaseEvidence` as a union: the Official
shape (`status`, `receipt`, review facts) or the Imported shape (`origin:
"imported"`, `documentDigest`, `importedAt`, `compatibility`, the declared
source), and `source.reviewedRevision` is `null` for an unpinned import. The
Trusted Review titles the approval as an Imported Package and shows the
import evidence in place of an Official review receipt; approval creates the
same Mutation Guard and stop-on-failure execution without rollback. SSH
Targets stay excluded as for every other Collection prepare.

Publication (ADR 0019 / ADR 0020) is projected as an optional
`publication` state on the Workspace Snapshot; a build without a
main-owned publication host omits it and answers every publication request
with `publication_unavailable`. The renderer never sees a path or a Git
argument. `publication.choose-source` opens main's native folder dialog,
reads every `<folder>/<skill>/**` regular file (no links, no dot-entries,
exporter limits) and runs the deterministic well-known exporter; the
Snapshot then carries `publication.source` as an opaque `grantId`, a display
`label`, the sorted Skill names, `fileCount`, `treeDigest`, and
`exporterVersion`. `publication.export` writes the exact tree into a new or
empty folder chosen in a second main-owned dialog and invokes no Git
(`publication.export` projection: `destinationLabel`, `fileCount`,
`treeDigest`, `writtenAt`); a non-empty destination or a folder without
Skills is `export_invalid`. `publication.prepare` carries exactly two user
strings, `remote` and `branch`. Main sanitizes the remote to `https://`,
loopback `http://`, `ssh://`, or `user@host:path` with no credentials,
options, query, or other scheme (`remote_unsupported`), and the branch to one
exact `refs/heads/*` name (`branch_unsupported`); a build without a
`GitPublisher` answers `git_unavailable` while export-only keeps working. A
request with any other field is `invalid_request`. Preparation runs system
Git only inside an application-owned 0700 temporary root with hooks,
signing, attributes, redirects, and every other transport disabled, and the
Snapshot publishes the sealed `PublicationPlanV1` (`remote`, `branch`, `ref`,
`base` as a commit or `unborn`, `candidateCommit`, every managed path with
its digest, `treeDigest`, `skills`, `createdAt`, `expiresAt`, `planDigest`)
as `publication.plan` with `phase: "planned"`.

`publication.review.request` names a `planId` and opens a `publication-push`
Trusted Review whose projection is the sealed plan and its expiry; an
unknown or expired plan is `review_invalid`. Approval revalidates every byte
against the plan, commits the durable Publication Guard through the single
`publication.guard.replace` `DurableChange` (`publication-guard.json`,
schema version 1, quarantined when corrupt or newer than the app), fetches
the exact branch again, and pushes one exact fast-forward refspec with no
force, lease, tags, hooks, or deletes. Drift, revalidation, or reachability
failures before transport cause no push and release the Guard
(`publication_drift`, `publication_invalid`, `remote_unreachable`). Exact
remote-ref readback records `publication.lastOutcome` as `published`,
`not-published`, `diverged`, or `uncertain`; an uncertain result (including
Git dying mid-transport) retains the Guard as `publication.guard` with
`phase: "uncertain"`, blocks another `publication.prepare`
(`publication_guarded`), and survives restart. `publication.reconcile`
performs readback only, never a second push, and clears the Guard on any
known result. `publication.discard` releases the prepared root for the named
plan; rejecting or closing the review does the same. Rejecting, closing, or
shutting down never touches a user worktree: cleanup removes only the proven
application-owned root.
