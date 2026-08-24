# Packaged UI QA

Isolated Local-only packaged Electron UI/UX suite for issue #85.

## What it owns

The runner creates one disposable root and never reads developer skill state:

- `HOME`, platform profile/config/cache/temp directories, and Electron `--user-data-dir`
- a unique loopback CDP port and session name
- a stub `npx` on `PATH` that serves fixture inventory
- a pinned `axe-core` source; an unavailable dependency fails the run closed
- on Windows, `node.exe`, npm shims, and npm's `npx-cli.js` resolver layout
- ephemeral logs and optional screenshots under `<fixture>/artifacts`

Teardown deletes only that fixture root. On POSIX, process ownership is the
packaged Electron direct child and the detached process group created for it;
on Windows it is the `taskkill /t` tree rooted at that child. A descendant that
deliberately creates a new POSIX session is outside this portable ownership
boundary. The harness never claims system-wide process-tree cleanup and fails
closed when it cannot confirm cleanup inside its owned boundary.

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

Protected `main` runs the same runner on hosted Ubuntu x64, macOS arm64/x64, and Windows x64 via `.github/workflows/packaged-ui-qa.yml`, preserving the packaged Chromium sandbox posture. On Ubuntu 24.04, the workflow installs an executable-scoped AppArmor `userns` profile and removes both the loaded profile and its temporary file on success, failure, or interruption. Local AppArmor hosts need equivalent privilege or preconfiguration; the runner intentionally never passes `--no-sandbox`.

Failures upload only `failure.json`, a mode-`0600` receipt containing allowlisted stage and check codes, error class, platform, architecture, and schema version. Raw exception text and Electron output stay in the disposable fixture and are never uploaded.

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
