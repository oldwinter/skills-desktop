# Compare only authoritative skill evidence

Skills Desktop aligns comparison candidates by exact, case-sensitive skill
name, defines Skill Identity from that name plus the exact Declared Source
reported by `npx skills`, and does not scan installed files to manufacture a
Revision or Content Fingerprint. Comparison keeps presence, source,
selected-harness availability, revision, fingerprint, and freshness as
independent outcomes so missing evidence remains unknown rather than becoming
false equality or drift. This preserves `npx skills` as the authority and
avoids introducing a platform-specific filesystem observation protocol.

## Consequences

- With the current `list --json` contract, Revision and Content Fingerprint are
  unknown for every entry.
- Source aliases are not rewritten or treated as equivalent; `sourceUrl`
  remains potentially sensitive provenance and replay evidence, not identity.
- Inventory freshness is event-based rather than age-based. A stale snapshot
  may be inspected or compared, but mutation planning requires a fresh read.
- The normalized Inventory schema is versioned. Readers migrate older versions,
  additive unknown CLI fields stay in a bounded in-memory extension envelope,
  and incompatible known-field changes produce an unsupported-schema error.
