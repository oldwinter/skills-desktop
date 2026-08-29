# Adopt multi-harness Targets and a pinned registry

Status: Accepted

## Context

The pinned `skills@1.5.23` dialect accepts many harness identifiers, but it has
no supported machine-readable discovery interface for them. The released
Target model selects one harness, which cannot describe a workspace shared by
several harnesses. Display labels and private upstream implementation details
are not safe substitutes for exact CLI identifiers.

## Decision

A Target selects one machine, one canonical workspace, and a non-empty set of
exact `HarnessId` values. Scope remains an Inventory and mutation dimension,
not part of Target identity. Target Definition v4 preserves the stable
application-generated `TargetId`, stores harnesses in registry order, and
advances Target Generation when any execution-relevant selection changes.

`packages/skills-runtime` will own Harness Compatibility Registry v1, bound to
the exact `skills-1.5.23` dialect. It contains the 77 reviewed canonical CLI
identifiers, their reviewed inventory tokens, localized display-message keys,
and explicit direct, shared, absent, or unknown coverage rules. Display names
are presentation only. Unknown tokens remain unknown. Runtime code will not
inspect upstream private source, package keywords, installation paths, or
agent objects to discover additional harnesses.

Add and remove bind an explicit non-empty subset of the Target harness set.
Update remains CLI-unscoped because `skills@1.5.23 update` has no `--agent`;
its review must disclose possible effects on every CLI-managed harness link in
the selected scope.

Future harness support requires either a formal upstream discovery interface
accepted by a later ADR or a reviewed registry and dialect upgrade.

## Alternatives considered

- Discover harnesses from upstream private code at runtime. Rejected because
  it would make private implementation an unstable authority.
- Derive identifiers from localized display labels. Rejected because labels
  are neither exact nor stable CLI input.
- Keep one Target per harness. Rejected because it misstates shared workspace
  identity and makes atomic multi-harness evidence impossible.

## Consequences

Target, Inventory coverage, plans, Wire frames, and reviews share one canonical
`HarnessId` vocabulary. The registry digest becomes execution binding evidence.
Target v3 records require a deterministic migration, and existing Inventory
restores only as Stale after that migration. Unsupported harness evidence is
visible but cannot authorize mutation.

## Relationship to earlier decisions

This record amends ADRs 0001, 0004, 0005, and 0010. It narrowly supersedes ADR
0001's statement that the application does not define a registry: Skills
Desktop now defines compatibility metadata for the pinned dialect, but still
does not define installed state or replace `npx skills` discovery.
