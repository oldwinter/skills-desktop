# Targets

Application-owned Local Target Definitions. V1 can create, edit, and delete
Local Targets only. The first Target is created at launch as **This device**
with harness `codex` and workspace `SKILLS_DESKTOP_WORKSPACE`.

## Sub-features

- List cards: label, workspace path, Kind **Local**, Harness, Connection
  **This device**, inventory pill Fresh / Stale / No evidence / Loading.
- **New Target** opens the inspector as **New Definition**.
- Editor fields: Target kind (Local only), **Display label**,
  **Canonical workspace**, **Harness** (`codex`), **Save Target**.
- **Edit \<label\>** / **Delete \<label\>**. Last remaining Target cannot be
  deleted (`deletionBlocked`).
- Saved banners: `Target created`, `Target updated`, `Target deleted`.
- Residual SSH cards, if present, show `SSH · 未在 V1 开放` /
  `aria-label="SSH 未开放"` and cannot be saved.

## How to get to it (user POV)

1. Click Primary **Targets**.
2. Heading is `Targets`. Subtitle includes `V1 is Local-only`.
3. Click **New Target**, fill the editor, **Save Target**.
4. Click a rail Target row to change the observed Target from any page.

## Driving it with CDP

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs nav Targets
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.querySelector("h1")?.textContent === "Targets"' \
  "targets heading"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot 01-targets-list.png
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click "New Target"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.body.textContent.includes("New Definition")' \
  "new definition"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs fill "Display label" "Verify second"
```

Canonical workspace must be an existing directory. Use the fixture workspace
from `session.json` (`workspace`) or a directory you created under the
fixture root — never the developer's real project.

```bash
# replace PATH with session.workspace or another fixture-owned directory
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs fill \
  "Canonical workspace" PATH
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click "Save Target"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.body.textContent.includes("Target created") && document.body.textContent.includes("Verify second")' \
  "second target saved"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot 02-targets-created.png
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs state targets-created
```

End state that proves it: list shows **This device** and **Verify second**;
`aside[aria-label="Target Definition editor"]` heading matches the saved
label; Primary rail **Targets** section lists both.

## Gotchas

- Kind control is Local-only. There is no V1 control to create SSH.
- Workspace path is canonicalized (`realpath`). A missing path fails save
  with a renderer error banner.
- Creating a second Local Target is the prerequisite for Comparison.
- Deleting the last Target is disabled. Do not treat that as a product bug.
- After save, Inventory for the new Target starts empty or loading until
  Refresh. Comparison needs inventory on both sides.
