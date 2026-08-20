# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `oldwinter/skills-desktop`.
Use the `gh` CLI for all operations.

## Conventions

- Create, read, update, comment on, label, and close issues with `gh issue`.
- Use stdin or a body file for multiline descriptions and comments.
- Verify published multiline payloads contain real newlines.
- Infer the repository from `origin`.
- Pull requests are not a triage request surface.

## Skill operations

- Publishing to the issue tracker means creating a GitHub issue.
- Fetching a ticket means reading the issue, labels, assignees, and comments.

## Wayfinding operations

- The map is one issue labelled `wayfinder:map`.
- Decision tickets are GitHub sub-issues labelled `wayfinder:research`,
  `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Use native issue dependencies for blocking when available; otherwise record
  `Blocked by:` links in the child body.
- The frontier consists of open, unblocked, unassigned child issues.
- Claim a ticket by assigning it to the current developer before working it.
- Resolve by posting the answer, closing the ticket, and appending a linked gist
  to the map's `Decisions so far`.
