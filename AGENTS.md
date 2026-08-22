# Repository Guidance

Read `CONTEXT.md`, `prototype/VERDICT.md`, and relevant files under `docs/adr/`
before changing product behavior.

## Current Phase

The production Local Target tracer exists and is the source of truth together
with the accepted ADRs: inventory via the pinned skills CLI, allowlisted stale
Snapshot restore, and mutation confirmation. **V1 public commitment is
Local-only.** SSH Target, remote-bootstrap, and cross-machine reconciliation
are out of V1 scope / next (they may stay in-tree as experiments).

V1 docs accept a reliable local tracer, unsigned candidates that are buildable,
and docs that match reality — not a signed public release. The prototype
remains evidence only; do not silently promote its sample data,
command-preview strings, or monolithic UI module into production.

For the initial product-definition pass, use this sequence:

1. `wayfinder` for unresolved decision tickets.
2. `to-spec` after the decision map is clear.
3. `to-tickets` for blocking tracer-bullet implementation tickets.
4. `implement` per unblocked ticket in a fresh context.

## Engineering Constraints

- Fully reuse `npx skills` for skill discovery and mutation.
- Keep process, SSH, persistence, and renderer responsibilities behind narrow
  interfaces with structured inputs and outputs.
- Never execute renderer-generated shell text. Use argument arrays locally and
  a deliberately specified remote transport contract.
- Add tests around CLI parsing, command planning, IPC boundaries, diff
  semantics, and mutation confirmation before relying on them.
- Preserve backward compatibility for any shipped inventory or collection
  schema.
- Do not commit credentials, raw SSH output containing sensitive data, or
  generated visual-QA artifacts.
- Do not widen V1 acceptance to remote without an explicit product decision.

## Prototype Validation

```bash
cd prototype
npm install
npm run prototype:build
xvfb-run -a npm run prototype:smoke
```

On a desktop session, `npm run prototype:smoke` does not require `xvfb-run`.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues for `oldwinter/skills-desktop`.
See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels without renaming.
See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.
