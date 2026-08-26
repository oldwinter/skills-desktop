# Separate package origins in canonical skillpacks

Status: Accepted

## Context

Reviewed Official Collections already have immutable release bytes, digests,
receipts, and a maintainer trust root. User-authored and imported recipes need
portable interchange without impersonating that trust or becoming a second
installed-state authority.

## Decision

Official Collection, User Package, Imported Package, and Installed Skill are
distinct identities. Origin is immutable. Matching an ID, title, source,
receipt-shaped object, or digest never promotes User or Imported data to
Official. An edited import becomes a new User Package.

`.skillpack` v1 is a strict metadata/source-only UTF-8 JSON envelope. It binds
kind, schema version, package ID, release, title, description, a portable
Source Descriptor, exact Skill names, and exact dialect/harness compatibility.
It contains no Skill content, scripts, assets, credentials, Target, host,
workspace, Inventory, installed-state claim, argv, preview, raw output, Guard,
or Official receipt.

Canonical bytes use RFC 8785 JSON Canonicalization Scheme semantics.
`documentDigest` is SHA-256 over the canonical `{kind, schemaVersion, package}`
bytes, avoiding a self-referential digest while binding every semantic field.
The schema is strict and bounded to 1 MiB, 128 Skills, 77 harnesses, safe
integer releases, and unique case-sensitive and case-folded Skill names.
Unknown fields, duplicate keys, BOM, invalid UTF-8, non-canonical bytes,
credentials, or unsupported/newer schemas fail closed.

Import performs no network request. The same package ID, release, and digest is
idempotent. The same ID and release with a different digest is a retained
conflict. Different releases produce explicit upgrade or downgrade deltas.
Assessment remains dimensioned by Target, scope, harness, source, revision,
fingerprint, and freshness. Apply expands to ordinary sequential guarded
mutations, stops on first failure or uncertainty, does not roll back, and never
claims a Package or Collection is installed.

## Alternatives considered

- Embed Skill content in the envelope. Rejected because it creates a new
  distribution and execution authority.
- Treat all matching imports as Official. Rejected because bytes alone do not
  transfer the Official review trust root.
- Persist desired package versions. Rejected because only CLI Inventory can
  describe installed Skills.

## Consequences

Package interchange is deterministic and offline at import time. Origin and
conflicts remain visible. Existing Official release bytes, digests, receipts,
status, and supersedes chains remain valid and are not reserialized.

## Relationship to earlier decisions

This record amends ADR 0008 and the package persistence consequences of ADR
0007. It extends the recipe model without weakening Official trust, CLI
installed-state authority, or guarded child execution.
