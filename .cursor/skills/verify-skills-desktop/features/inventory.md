# Inventory

Normalized project-plus-global observation of the selected Local Target
through pinned `npx skills list --json`. Default view after launch. Default
Target label is `This device`.

## Sub-features

- Freshness pill in the header: `Fresh evidence`, `Stale evidence`,
  `No evidence`, plus loading/error variants.
- Table columns Skill, Scope, Harness, Declared source, Evidence.
- Search (`aria-label="Search inventory"`), `/` focuses search, Escape or
  **Clear inventory search** clears the query.
- Scope group **All scopes** / **Project scope** / **Global scope**.
- Inspector **Skill evidence** (scope, harness, source type, declared
  source, revision, content fingerprint). Unknown stays Unknown.
- **Refresh inventory** / **Cancel refresh**.
- **Add Skill** form: GitHub source `owner/repository`, exact name,
  Project/Global scope, **Prepare add**.
- **Prepare update** / **Prepare removal** on the selected skill;
  **Update scope** only when scope is not All.
- Command Plan (preview is not executable) → **Open Trusted Review** →
  Review window `Reject` / `Approve mutation` → workspace
  `completed / verified` (fixture stub).

## How to get to it (user POV)

1. Launch the packaged app. Inventory is the default page
   (`aria-current="page"` on **Inventory**).
2. From any other page, click Primary **Inventory**.
3. After Comparison **Prepare for Left/Right**, the app returns here with a
   Command Plan.

## Driving it with CDP

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs nav Inventory
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.querySelector("h1")?.textContent === "Inventory" && document.body.textContent.includes("qa-project-skill")' \
  "inventory fixture"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot 01-inventory-loaded.png
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click-skill qa-project-skill
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot 02-inventory-selected.png
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs fill "Search inventory" qa-project
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.body.textContent.includes("1 matching skill")' \
  "search filter"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click "Clear inventory search"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs invocations
```

Empty / error (after the happy path, or in a dedicated run):

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs set-mode empty
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click "Refresh inventory"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.body.textContent.includes("No skills found")' \
  "empty inventory"
```

Mutation (fixture stub; still the real Review window):

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click-skill qa-project-skill
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click "Prepare removal"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.body.textContent.includes("Open Trusted Review")' \
  "command plan"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click "Open Trusted Review"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs review-wait
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs review-click "Approve mutation"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.body.textContent.includes("completed / verified")' \
  "mutation outcome"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs invocations
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs inventory
```

End state that proves browse: `Fresh evidence`, two skills
(`qa-global-skill`, `qa-project-skill`), inspector source
`example/skills-desktop-qa` for the project skill, `invocations` contains
`list`. End state that proves removal: outcome `completed / verified`,
invocations contain `remove`, fixture `project` array no longer includes
`qa-project-skill`.

## Gotchas

- First filtered row is auto-selected. Do not assume the inspector is empty
  on load.
- Prepare buttons disable unless freshness is `fresh` and mutation phase is
  idle. Copy: `需要先刷新 inventory 证据` / reconciliation / in-progress.
- **Update scope** is disabled on **All scopes**.
- Add source must look like `owner/repository` or
  `#add-skill-github-source-error` appears.
- Command Plan preview must not be copied into a shell. Proof is Review plus
  stub argv.
- `set-mode` only changes the stub. Inventory does not change until Refresh.
- Trusted Review is another CDP target. Workspace clicks will not reach it.
- Review initial focus is **Reject**. Approve is the second button.
- Xvfb screenshots may look like letters are glued together. `state` JSON
  still reports `qa-project-skill` and `Fresh evidence`.
