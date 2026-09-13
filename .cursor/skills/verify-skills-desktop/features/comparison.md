# Comparison

Dimensioned diff of two Local Target inventories, aligned by skill name
(Comparison Key). Presence, declared source, harness, revision, content
fingerprint, and freshness stay separate. There is no single good/bad status.

## Sub-features

- Empty: `Needs a second Local Target` and disabled **Compare** when fewer
  than two Local Targets exist.
- **Left Target** / **Right Target** `<select>`, **Swap comparison Targets**,
  **Compare**.
- Table: Skill, left evidence, Dimensions, right evidence, Summary
  (`Matched`, `Missing`, `Source mismatch`, `Unknown evidence`,
  `Revision or content drift`).
- **Search comparison skills**, **Clear search**, Escape clears search and
  keeps Differences only.
- **Differences only** checkbox (`aria-label="Differences only"`).
- Inspector `aria-label="Selected comparison evidence"` with
  **Prepare for Left** / **Prepare for Right** (returns to Inventory with a
  Command Plan).
- Per-side **Refresh \<label\>**.

## How to get to it (user POV)

1. Create a second Local Target under **Targets** (see `targets.md`).
2. Refresh Inventory on both Targets so both can be Fresh.
3. Click Primary **Comparison**.
4. Choose different Left and Right, click **Compare**.

## Driving it with CDP

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs nav Comparison
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.querySelector("h1")?.textContent === "Comparison"' \
  "comparison heading"
```

With only the launch Target, prove the empty door:

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.body.textContent.includes("Needs a second Local Target")' \
  "needs second target"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot 01-comparison-needs-second.png
```

After two Local Targets exist and both have been refreshed:

```bash
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs click Compare
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs wait \
  'document.querySelector("table.comparison-table") !== null' \
  "comparison table"
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs screenshot 02-comparison-table.png
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs fill \
  "Search comparison skills" qa-project
node .cursor/skills/verify-skills-desktop/helpers/drive.mjs toggle \
  "Differences only" true
```

End state that proves the empty door: subtitle `Needs a second Local Target`,
**Compare** disabled, banner tells the user to add a Local Target. End state
that proves a compare: table rows exist; summaries are one of the five labels
above; search/filter change `N of M aligned skill keys`.

## Gotchas

- SSH Targets appear in the selects as `\<label\> · 未开放` and are disabled.
  They cannot be a comparison side.
- Left and Right must differ. Same-side shows
  `Left and Right must be different Targets`.
- Prepare on a side requires fresh inventory on both Targets and a row that
  is Missing or Revision or content drift for that side.
- Comparison search ignores case and trims whitespace. **Clear search** keeps
  Differences only and restores focus to the search box.
- `Prepare for Left/Right` is not the proof of Comparison itself; it is a
  mutation entry that continues on Inventory + Trusted Review.
