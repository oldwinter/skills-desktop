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
