# Collections

Official Collections are reviewed recipes shipped with the app. They do not
own installed skills and do not invent a second installer. Current bundle:
**Skills Desktop Starter** (`skills-desktop-starter`, release 1, skill
`find-skills`, source `vercel-labs/skills`).

## Sub-features

- Heading **Official Collections**. Release `<select>` shows
  `Skills Desktop Starter / release 1`.
- Per-Target card: **Include \<label\>** checkbox, Scope Project/Global,
  assessment table (Include, Skill, Assessment, Action).
- Assessment labels: Missing, Present, content unknown, Removal candidate,
  Source conflict, Incompatible, Unchanged.
- **Prepare plan** → inspector **Collection Plan** → **Open Trusted Review**.
- Execution list after approval (sequential, non-transactional) with per-child
  Reconcile / Refresh.
- Empty build copy `No Official Collections` only if the catalog has no
  releases. Current production catalog is non-empty.
- SSH Targets stay visible, Include disabled, marked
  `SSH · 未在 V1 开放`.

## How to get to it (user POV)

1. Click Primary **Collections**.
2. Confirm the Starter release is selected.
3. Include one Local Target, choose Project or Global, tick
  **Select find-skills** (or `Select find-skills on <label>`).
4. **Prepare plan**, then **Open Trusted Review** if proving apply.

## Driving it with CDP

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs nav Collections
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.querySelector("h1")?.textContent === "Official Collections"' \
  "collections heading"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot 01-collections.png
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs eval \
  'document.body.textContent.includes("Skills Desktop Starter") && document.body.textContent.includes("find-skills")'
```

To prepare a plan, the Target needs **Fresh** inventory and a selectable
assessment row. `find-skills` is usually **Missing** on the fixture (the stub
inventory does not include it):

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click "Select find-skills"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click "Prepare plan"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.body.textContent.includes("Collection Plan")' \
  "collection plan"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot 02-collection-plan.png
```

If **Select find-skills** is missing, use `eval` to list
`[...document.querySelectorAll("input[aria-label]")].map(i => i.getAttribute("aria-label"))`
and click the exact label. When two Targets exist the label is
`Select find-skills on This device`.

End state that proves browse: heading Official Collections, release title
Skills Desktop Starter, skill `find-skills`, inspector digest present. End
state that proves plan: **Collection Plan** with `find-skills` in the order
list and **Open Trusted Review** enabled.

## Gotchas

- **Prepare plan** stays disabled until at least one skill is selected and
  blockers are empty. Common blockers: stale inventory, incompatible
  release, reconciliation required.
- Include defaults to the currently selected Target only. Other Local
  Targets start unchecked.
- Approving a Collection plan would call stub `npx` `add` for `find-skills`.
  The stub treats unknown verbs as exit 2, so a full apply may fail closed.
  That is a fixture limit, not a product Collection browse proof. Stop at
  Collection Plan unless you extend the stub.
- SSH Include must remain disabled. Do not force-check it via DOM.
