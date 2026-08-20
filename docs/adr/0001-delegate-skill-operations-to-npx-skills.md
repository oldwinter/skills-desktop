# Delegate all skill operations to npx skills

Skills Desktop treats `npx skills` as the sole authority for skill discovery,
addition, removal, and updates. The application may normalize CLI output into
an Inventory Snapshot and may turn Collection selections into reviewed Command
Plans, but it does not scan skill directories, define a registry, or implement
another installation protocol. This avoids a competing source of truth and
keeps behavior aligned with the upstream tool as its formats and capabilities
evolve.

## Consequences

- The CLI process and parser form an explicit compatibility seam.
- An Inventory is evidence captured from the CLI, never an authoritative cache.
- Missing upstream Revision evidence remains unknown unless a separately named
  Content Fingerprint policy is accepted.
