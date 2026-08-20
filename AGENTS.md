# Repository Guidance

Read `CONTEXT.md`, `prototype/VERDICT.md`, and relevant files under `docs/adr/`
before changing product behavior.

## Current Phase

The repository contains a validated throwaway prototype and no production
implementation. Use the prototype to recover interaction decisions; do not
silently promote its sample data, command-preview strings, or monolithic UI
module into production.

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

## Prototype Validation

```bash
cd prototype
npm install
npm run prototype:build
xvfb-run -a npm run prototype:smoke
```

On a desktop session, `npm run prototype:smoke` does not require `xvfb-run`.
