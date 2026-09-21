# About

Product identity and update policy. Packaged unsigned / preview builds use
manual upgrade. They are not a Stable Release and do not use the automatic
update feed.

## Sub-features

- Product block: **Skills Desktop**, `Version 0.1.0`,
  `platform / architecture` (linux / x64 on the Linux package).
- **Last check** / **Next eligibility** facts.
- Update status **Manual upgrade** plus `policy.message` and
  `policy.releasePageUrl` when `policy.mode === "manual"`.
- **Export release diagnostics** (native save dialog; in this fixture the
  dialog is real OS UI — do not treat a cancelled dialog as a product
  failure).
- Automatic-channel chrome (**Check for updates**, **Restart to update**,
  restart guards) exists in code but is not the unsigned-preview path.

## How to get to it (user POV)

1. Click Primary **About**.
2. Read the product heading and update status.

## Driving it with CDP

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs nav About
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.querySelector("h1")?.textContent === "About" && document.body.textContent.includes("Manual upgrade")' \
  "about manual upgrade"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot 01-about.png
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs state about
```

End state that proves it: `h1` About, `h2` Skills Desktop, version `0.1.0`,
update status heading **Manual upgrade**, no claim of a signed Stable
Release or live Squirrel feed.

One-shot:

```bash
node .cursor/skills/verify-skills-desktop/helpers/prove-about.mjs
```

## Gotchas

- Loading state shows `Loading application details` until the about
  snapshot arrives. Wait for **Manual upgrade** or **Checks unavailable**,
  not merely the `h1`.
- **Export release diagnostics** opens a main-process file dialog. CDP
  cannot complete that OS picker. Screenshot the button; do not fail the
  run because the dialog was dismissed.
- Do not click **Restart to update** even if a future build shows it.
  Restart would kill the owned verification session.
