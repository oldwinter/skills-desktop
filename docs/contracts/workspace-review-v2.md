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
