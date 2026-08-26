# Export deterministic well-known artifacts

Status: Accepted

## Context

Validated Skills need a portable discovery tree that can be hosted or committed
without inventing a `skills` CLI export command. Reproducibility requires exact
paths, bytes, archive metadata, and digests rather than platform-dependent file
creation.

## Decision

Skills Desktop will export the Agent Skills discovery v0.2.0 profile. The
reviewed schema is pinned locally; runtime export never fetches the schema URI.
The index path is `.well-known/agent-skills/index.json`, and the schema URI is
`https://schemas.agentskills.io/discovery/0.2.0/schema.json`.

Index keys and entry keys use the specified order. Skills sort by bytewise
canonical name. JSON is UTF-8 with two-space indentation, LF line endings, and
exactly one trailing newline. A Skill containing only `SKILL.md` uses type
`skill-md` and `./<name>/SKILL.md`. A Skill with resources uses type `archive`
and `./artifacts/<name>.tar.gz`. Every index digest is SHA-256 over the exact
referenced artifact bytes.

Deterministic archives sort forward-slash paths bytewise, use fixed regular
file modes, zero mtime, uid, gid, user, group, and gzip timestamp, and emit no
host-dependent PAX variation. Traversal, links, special files, invalid names,
unbounded trees, and archive expansion risks fail before publication.
Identical validated input and exporter version must produce byte-identical
trees and the same tree digest across repeated exports.

Export-only writes a new directory and invokes no Git. Acceptance serves the
exact tree from an ephemeral local HTTP server and proves discovery and install
with the real pinned CLI in isolated HOME, workspace, and npm cache.

## Alternatives considered

- Fetch the schema at runtime. Rejected because export must be deterministic
  and available offline.
- Call a nonexistent CLI validate or export command. Rejected because it would
  claim an upstream capability that does not exist.
- Use ordinary platform tar defaults. Rejected because metadata and ordering
  vary by host.

## Consequences

The exporter profile is independently versioned. Changing discovery version or
canonical byte rules requires a later decision. Digests always describe bytes
that were actually written, and real CLI consumption is part of acceptance.

## Relationship to earlier decisions

This is a new distribution-content decision. It preserves ADR 0001 by using
the pinned CLI for final discovery and installation evidence and does not add
another CLI operation or installed-state authority.
