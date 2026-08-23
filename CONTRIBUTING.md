# Contributing

## Product scope

V1 public commitment is **Local-only**. SSH Target, remote-bootstrap, and cross-machine reconciliation are out of V1 / next unless an explicit product decision widens acceptance. Do not silently promote remote behavior into V1 docs or acceptance.

## Before you change code

1. Read `AGENTS.md`, `README.md`, and relevant ADRs under `docs/adr/`.
2. Prefer narrow interfaces for process, persistence, and renderer boundaries.
3. Never commit secrets, credentials, signing keys, raw sensitive SSH output, or generated visual-QA artifacts.

## Pull request format

Use this body structure (Chinese is preferred for this repo):

- **现象** — what is wrong or missing today
- **想改成啥** — the intended change
- **验收标准** — how a reviewer can verify the change

## Local verification

Run:

```bash
npm run verify
```

This covers typecheck, lint when configured, import checks, tests, and build. Do not skip it for behavior changes.

## Issues

Track work in GitHub Issues for `oldwinter/skills-desktop`. See `docs/agents/issue-tracker.md` and triage label guidance under `docs/agents/`.
