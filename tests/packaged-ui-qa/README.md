# Packaged UI QA

Isolated Local-only packaged Electron UI/UX suite for issue #85.

## What it owns

The runner creates one disposable root and never reads developer skill state:

- `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and Electron `--user-data-dir`
- a unique loopback CDP port and session name
- a stub `npx` on `PATH` that serves fixture inventory
- a pinned `axe-core` source; an unavailable dependency fails the run closed
- on Windows, `node.exe`, npm shims, and npm's `npx-cli.js` resolver layout
- ephemeral logs and optional screenshots under `<fixture>/artifacts`

Teardown deletes only that fixture root and the Electron process group it spawned.

## Setup

```bash
npm run package:linux
```

Or set `SKILLS_DESKTOP_PACKAGED_EXECUTABLE` to an already packaged binary.

On a headed desktop, `npm run qa:packaged-ui` is enough. On CI or a machine without a session:

```bash
xvfb-run -a npm run qa:packaged-ui
```

Linux one-shot:

```bash
npm run qa:packaged-ui:linux
```

Protected `main` runs the same runner on Linux x64, macOS arm64/x64, and Windows x64 via `.github/workflows/packaged-ui-qa.yml`. Failures upload only redacted logs from `SKILLS_DESKTOP_QA_ARTIFACTS`.

Print commands without launching:

```bash
node tests/packaged-ui-qa/run.mjs --help
```

## Scenarios

- keyboard-workflow
- focus-order
- axe-semantics
- narrow-layout
- reduced-motion
- empty-state
- error-state
- console-failures

Screenshots and videos stay in the fixture artifact directory. Do not commit them.

Contract tests in `harness.test.mjs` run with `npm test` and do not launch Electron.
