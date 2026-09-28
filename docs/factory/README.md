# Devin factory

A small local pipeline that moves one backlog item at a time through ordered
factory states — intake, implementation, review, verification, delivery —
using only this repository's existing commands. It records evidence under
`.codex/runtime/devin-factory/` (git-ignored) and never merges, pushes, or
deploys anything. Manual approval is still required for merge, deployment,
purchases, destructive actions, and expanded permissions.

## Layout

- `docs/factory/backlog.json` — the persistent queue. Every item has an
  `id`, `order`, `kind` (`code-change` | `verification`), explicit
  `acceptance` criteria, an optional `gates` subset, and a `state` from the
  ordered set `queued → claimed → implementing → reviewing → verifying →
  verified → delivered`, with `failed` (retryable) and `abandoned` aside.
- `docs/factory/backlog.json#gateCommands` — named gates mapped to existing
  npm scripts (`typecheck`, `lint`, `check:imports`, `check:context`,
  `test`, `test:coverage`, `build`, `package:darwin`, `packaged-ui`,
  `prove-inventory`, `prove-about`). Gates run as argument arrays; no shell.
- `.codex/runtime/devin-factory/` — runtime evidence: `progress.jsonl`
  (append-only), `status.md`, `runs/<id>/ledger.json`, per-attempt gate logs
  (`attempt-<n>/<gate>.log`), review diffs, and `deliveries/*/report.md`.

## Run it

```bash
npm run factory -- list              # queue overview
npm run factory -- next              # next queued item
npm run factory -- show SDF-001      # acceptance criteria + gate plan
npm run factory -- run --dry-run     # plan for the next item, nothing written
```

The normal cycle (done by an operator or agent, one item at a time):

```bash
npm run factory -- claim SDF-001     # queued -> claimed
npm run factory -- implement SDF-001 # claimed -> implementing
# ... make the bounded change for SDF-001 ...
npm run factory -- review SDF-001    # captures diff + HEAD evidence
npm run factory -- verify SDF-001    # runs the item's gates fail-fast
npm run factory -- deliver SDF-001   # writes deliveries/ report, marks done
```

`run <id>` performs claim → implement → review → verify → deliver in one go
and stops at the first failure. `verify` exits non-zero on a gate failure,
marks the item `failed`, and records the failing gate log; nothing records
success for a failed attempt.

## Inspect

- `npm run factory -- status` regenerates `status.md` and prints it.
- Gate output: `.codex/runtime/devin-factory/runs/<id>/attempt-<n>/<gate>.log`.
- Event trail: `.codex/runtime/devin-factory/progress.jsonl`.
- Per-item ledger (attempts, reviews, deliveries):
  `.codex/runtime/devin-factory/runs/<id>/ledger.json`.

## Recover

- `verify` again after a `failed` item — retries are recorded as new attempts.
- `requeue <id>` returns a `failed`/`abandoned` item to the queue.
- `abandon <id> --reason "<text>"` parks an item.
- `deliver` refuses when HEAD moved since the passing verify; re-run
  `verify` to re-certify.
- A crash mid-`verify` leaves the item in `verifying`; re-running `verify`
  resumes it as a new attempt.

## Stop

There is no daemon: every command is a one-shot Node process. `Ctrl-C` during
`verify` kills the running gate's process tree; the item is left in
`verifying` with a partial attempt log and can be retried. Deleting
`.codex/runtime/devin-factory/` removes only volatile evidence — the queue
state lives in `docs/factory/backlog.json` and survives.

## Rules it enforces

- Gates run sequentially, fail-fast, as argument arrays (no shell text from
  queue data is ever executed).
- `deliver` requires a passing `verify` at the current HEAD.
- Re-running `deliver` for an already delivered item is a no-op.
- Runtime evidence stays out of git (`.codex/` is ignored); secrets are never
  written to evidence files.
