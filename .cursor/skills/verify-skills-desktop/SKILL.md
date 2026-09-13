---
name: verify-skills-desktop
description: Drive the packaged Skills Desktop Electron app over CDP. Use when proving a user-visible Local-only change in Inventory, Comparison, Collections, Targets, About, or Trusted Review.
---

# Verify Skills Desktop

This skill is for the next agent, mid-task, who has never seen the app.

Skills Desktop is a packaged Electron client. The user-facing surface is the
workspace window at `skills-desktop://workspace/index.html` plus a separate
Trusted Review window at `skills-desktop://review/index.html`. V1 is
**Local-only**. SSH Target chrome may render as `SSH · 未在 V1 开放` / `未开放`;
that is a closed door, not a path to drive.

The product delegates list/add/remove/update to pinned `npx skills@1.5.23`.
Verification launches an isolated fixture whose `PATH` starts with a stub
`npx`. That stub is the production CLI boundary, not a renderer test double.
Do not point the app at the developer's real `HOME` or skill inventory.

Do not use `prototype/` as the verification surface. It is design evidence
only. Do not run `npm run qa:packaged-ui` as a substitute for this skill:
that suite is a closed accessibility/keyboard gate and deletes its fixture
artifacts on teardown.

## Launch

From the repository root, Node `>=22.20.0`:

```bash
npm install
npm run package:linux
```

Override an already packaged binary with
`SKILLS_DESKTOP_PACKAGED_EXECUTABLE`. Default Linux x64 path:

`apps/desktop/out/Skills Desktop-linux-x64/skills-desktop`

Headed desktop (a `DISPLAY` or `WAYLAND_DISPLAY` is set):

```bash
node .cursor/skills/verify-skills-desktop/helpers/launch.mjs
```

No graphical session:

```bash
xvfb-run -a node .cursor/skills/verify-skills-desktop/helpers/launch.mjs
```

Ready means the helper printed `verification session ready` and the workspace
CDP page shows `h1` `Inventory` plus fixture skill `qa-project-skill`. Session
metadata is written to `.scratch/verify-skills-desktop/session.json`.

Launch always creates a disposable fixture:

- unique `HOME`, `XDG_*`, `NPM_CONFIG_CACHE`, `TMPDIR`, and
  `--user-data-dir`
- unique loopback CDP port
- `SKILLS_DESKTOP_WORKSPACE` inside the fixture
- stub `npx` first on `PATH` serving `qa-project-skill` (project,
  `example/skills-desktop-qa`) and `qa-global-skill` (global, null source)
- default Local Target label `This device`, harness `codex`

The app calls `app.requestSingleInstanceLock()`. Isolated
`--user-data-dir` values can run side by side. **Refuse to attach to a
developer instance**, a packaged binary launched without this fixture, or a
second drive of an already-owned session. If `session.json` points at a live
PID, stop and use that session or run cleanup first.

Never pass `--no-sandbox`. Never export `SKILLS_DESKTOP_QA_DISABLE_CHROMIUM_SANDBOX`.

Teardown is `helpers/cleanup.mjs` (see Cleanup). It stops only the PID in
`session.json` and deletes only that fixture root.

## Doctor

Run this first whenever anything looks off:

```bash
node .cursor/skills/verify-skills-desktop/helpers/doctor.mjs
```

A useful instance has all of:

- session file present
- owned Electron PID alive
- packaged executable path still the one recorded at launch
- fixture root, user-data, workspace, and `inventory.json` still on disk
- CDP `/json/list` advertises `skills-desktop://workspace/index.html` titled
  `Skills Desktop`
- rail text `skills 1.5.23`
- fixture inventory (`qa-project-skill`) or an intentional empty/error banner
  you just asked for

Exit 1 means do not drive. Launch again or clean up the stranded session.

## Drive

Harness: Chromium DevTools Protocol against the packaged workspace (and, when
opened, the Trusted Review page). Helpers reconnect per command; they do not
keep a CDP socket open.

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs nav Inventory
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click-skill qa-project-skill
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot inventory-selected.png
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs state after-select
```

| Command | What it does |
| --- | --- |
| `nav <view>` | Clicks Primary nav by `aria-label`. Views: `Inventory`, `Comparison`, `Collections`, `Targets`, `About`. |
| `click <name>` | Clicks a `button` whose `aria-label` or trimmed `textContent` matches. |
| `click-skill <name>` | Clicks `button.skill-button` and waits for `.inspector h2` to match. |
| `fill <label> <value>` | Fills an input by wrapping `<label><span>` or `aria-label`. |
| `toggle <aria-label> <true\|false>` | Clicks a checkbox/radio if its checked state differs. |
| `wait <js> <label>` | `CdpPage.waitFor` on a workspace expression. |
| `eval <js>` | `Runtime.evaluate` on the workspace, JSON to stdout. |
| `state [name]` | Writes heading, freshness pill, skill names, banners to evidence. |
| `screenshot <file>` | `Page.captureScreenshot` into the run evidence dir. |
| `invocations` | Copies fixture `invocations.log` (stub `npx` argv arrays). |
| `inventory` | Copies fixture `inventory.json`. |
| `set-mode <success\|empty\|failure>` | Changes stub `npx` behavior, then Refresh to observe. |
| `review-wait` / `review-click` / `review-screenshot` | Same recipe on `skills-desktop://review/index.html`. |

Stable handles (do not click by coordinates or tab order unless you are
proving keyboard focus):

- Primary nav: `button[aria-label="Inventory"|Comparison|Collections|Targets|About]`, `aria-current="page"` when active
- Refresh: `button[aria-label="Refresh inventory"]`
- Search: `input[aria-label="Search inventory"]`, clear `button[aria-label="Clear inventory search"]`
- Scope group: `[role="group"][aria-label="Inventory scope"]` buttons `All scopes`, `Project scope`, `Global scope`
- Skill rows: `button.skill-button` text is the skill name
- Inspector: `aside[aria-label="Selected skill evidence"]`, `dl[aria-label="Skill evidence details"]`
- Mutation: `Prepare add`, `Prepare update`, `Prepare removal`, `Update scope`, then `Open Trusted Review`
- Review: title `Skills Desktop Trusted Review`; buttons `Reject`, `Approve mutation`, later `Close review`
- Targets: `New Target`, fields `Display label` / `Canonical workspace`, `Save Target`, `aria-label="Edit <label>"` / `Delete <label>"`
- Comparison: `Compare`, `aria-label="Swap comparison Targets"`, `Search comparison skills`, `Differences only`
- Collections: `Prepare plan`, `aria-label="Include <label>"`, `aria-label="Select <skill>"` (or `Select <skill> on <label>` when more than one Target)
- About: `h2` `Manual upgrade` on unsigned/preview builds; `Export release diagnostics`

The first filtered inventory row is auto-selected. Click a skill anyway when
the proof is about inspector contents.

After `set-mode empty|failure`, click `Refresh inventory` and wait for
`No skills found` or `Inventory unavailable` / `本地进程执行失败`.

Read `features/` before driving. A proof that only opens the default
Inventory view is incomplete when the map lists another entry point.

## Evidence

Proof root (survives cleanup, gitignored via `.scratch/`):

`.scratch/verify-skills-desktop/evidence/<runId>/`

`launch.mjs` prints the exact directory. `session.json` has `evidenceDir`.
Do not commit that directory. Do not put screenshots under
`tests/packaged-ui-qa/` or `visual-qa/`.

Standards:

1. Exercise the real workspace window and, for mutations, the real Trusted
   Review window. Do not call `window.skillsDesktop` internals or invent a
   second IPC client.
2. Capture the action and the resulting state: a screenshot before the click,
   a screenshot after, plus `state` JSON. A single final frame is not a proof.
3. Verify the CLI-boundary side effect. After Refresh, `invocations` must
   contain `["--yes","skills@1.5.23", ... "list", ...]`. After an approved
   removal, it must contain `remove` and `inventory.json` must drop that
   skill. After Target create, the Targets list and header label must show
   the new name.
4. The stub `npx` is allowed because `npx skills` is already the production
   isolation boundary. Do not treat the stub as "the app succeeded" without
   reading `invocations.log` / `inventory.json`. Do not run a real
   add/remove against a developer inventory to prove UI.
5. Preview strings in Command Plan are not executable. Proof of a mutation is
   Trusted Review approval plus stub argv plus fixture inventory change, not
   the preview text.
6. On Xvfb / missing UI fonts, `Page.captureScreenshot` can smash Latin
   spacing so OCR reads `Thisdevice` or `qa-oproject-skill`. Trust
   `drive.mjs state`, `eval`, and fixture files for text. Keep the PNG as
   layout evidence, not as the source of truth for copy.

## Cleanup

```bash
node .cursor/skills/verify-skills-desktop/helpers/cleanup.mjs
```

Stops the Electron PID from `session.json` (SIGTERM then SIGKILL on the
owned POSIX process group). Deletes only that fixture root. Removes
`session.json`. Leaves `.scratch/verify-skills-desktop/evidence/<runId>/`
in place and writes `cleanup.json` there.

Never `pkill skills-desktop` or kill by process name. If launch or drive
fails, run cleanup anyway so the CDP port and fixture are not stranded.

After cleanup, confirm the evidence directory still exists before treating
the run as done.

## Helpers

All helpers are executable Node ESM. Run them from the repository root.
They import the existing packaged QA modules under `tests/packaged-ui-qa/`
and do not reimplement launch or CDP.

```bash
node .cursor/skills/verify-skills-desktop/helpers/launch.mjs
node .cursor/skills/verify-skills-desktop/helpers/doctor.mjs
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs --help
node .cursor/skills/verify-skills-desktop/helpers/cleanup.mjs
```

One-shot seed proof (Inventory browse/filter only):

```bash
node .cursor/skills/verify-skills-desktop/helpers/prove-inventory.mjs
```

On a machine without `DISPLAY`, prefix that line with `xvfb-run -a`.
