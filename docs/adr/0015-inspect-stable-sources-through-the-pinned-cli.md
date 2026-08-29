# Inspect stable sources through the pinned CLI

Status: Accepted

## Context

Users need to inspect sources before selecting Skills to add. Building a
repository or archive scanner would create another discovery authority, while
passing arbitrary source text or parser output into mutation would weaken the
typed lifecycle.

## Decision

`SourceDescriptorV1` is a closed, bounded union for the stable forms accepted
by `skills@1.5.23`: GitHub, GitLab, generic Git, HTTP `SKILL.md` or archive,
local directory, local archive, well-known discovery, and skills.sh Pack
source. It retains the exact case-sensitive user-approved source form and
separately records its family and mutable ref, if any. Credential-bearing,
option-shaped, control-character, and unsupported URL forms fail before spawn.
Local paths enter only through a main-owned filesystem grant.

Source inspection invokes exactly
`npx --yes skills@1.5.23 add <source> --list` in the selected Target context.
The versioned parser is byte-, entry-, string-, duplicate-, and
structure-bounded. Unexpected grammar, contamination, or partial output fails
the whole inspection as `source-inspection-incompatible`; it never publishes a
partial or empty-looking candidate list.

A successful Source Inspection is session evidence bound to the Target,
Generation, Effective Target Binding, dialect, registry, exact Source
Descriptor, and result digest. It grants no mutation authority and proves no
installed Revision or Content Fingerprint. Selecting exact names creates an
ordinary add intent that enters the existing Fresh Inventory, planning,
Trusted Review, Guard, execution, and postflight lifecycle. Mutable sources are
identified as mutable in review.

`SkillsProcessV2` adds `inspectSource` while keeping process planning private.
Portable network sources may later cross Wire v3. Desktop-local directories and
archives are Local-Target-only and are rejected before SSH spawn or upload.

## Alternatives considered

- Scan repositories and archives in Skills Desktop. Rejected because it would
  duplicate upstream source interpretation.
- Persist candidate lists as durable authority. Rejected because source
  contents and Target bindings can change.
- Accept generic URLs or CLI options. Rejected because they enlarge renderer
  and process authority beyond the reviewed dialect.

## Consequences

Source listing remains under the sole pinned CLI authority. Inspection can be
cancelled without publishing partial evidence. Add preparation must bind the
exact inspection and source digests and must revalidate them before Guard
creation.

## Relationship to earlier decisions

This record amends ADRs 0001, 0005, and 0012. It supersedes ADR 0005 only where
that Local-only record excluded source-list parsing; the closed typed process,
private plan, confirmation, and postflight rules remain unchanged.
