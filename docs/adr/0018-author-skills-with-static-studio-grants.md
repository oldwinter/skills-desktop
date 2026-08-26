# Author Skills with static Studio grants

Status: Accepted

## Context

Authoring Skills requires local file access, validation, preview, draft
recovery, and export. Giving a renderer paths or generic filesystem methods
would violate the existing capability model. Running authored tools or active
Markdown during validation would turn preview into execution.

## Decision

Studio is a Local-only static authoring module inside
`DesktopCapabilities`. Main opens native directory dialogs, canonicalizes the
chosen root, and returns an opaque, purpose-bound, document-epoch-bound
Filesystem Grant. A grant authorizes only its named Studio operation under that
root and expires on renderer teardown, explicit release, or restart. It is
never a generic path capability.

Validation reads bounded regular UTF-8 files and never executes scripts, tools,
hooks, lifecycle commands, Markdown plugins, or embedded commands. A versioned
validator profile checks `SKILL.md`, frontmatter, Agent Skills name and
description rules, path agreement, Markdown structure, links, resources,
bounds, traversal, case conflicts, symlink escape, hardlink ambiguity where
detectable, and special files. Findings use stable codes and root-relative
locations without raw content.

Preview disables raw HTML and plugins, sanitizes against a fixed semantic
allowlist, serves bounded local resources through a read-only main-owned
protocol, and blocks scripts, forms, frames, active SVG, remote resources,
navigation, and network fetching.

Each Studio Draft is an independent versioned record with optimistic revision.
Autosave uses compare-and-swap and atomic replacement. Conflicts are explicit;
one corrupt or newer Draft can be quarantined without hiding others. Draft
content is sensitive and excluded from diagnostics.

Export defaults to one new destination directory. Main writes an owned sibling
temporary tree, verifies it, flushes it, and commits by no-replace atomic
rename. Traversal, symlink escape, special files, overlap, races, and silent
overwrite fail closed. Authored content remains inert throughout.

## Alternatives considered

- Give the renderer a file path or generic filesystem bridge. Rejected because
  identifiers and paths are not capabilities.
- Run community validators or Markdown plugins. Rejected because authored
  content is untrusted and Studio is not a tool runner.
- Store all Drafts in one document. Rejected because one corrupt record would
  hide unrelated work.

## Consequences

Studio needs purpose-built IPC, native dialogs, grant lifetime tests, static
filesystem adapters, draft migration and fault tests, sanitized preview, and
atomic export recovery. Filesystem grants never survive restart.

## Relationship to earlier decisions

This record extends ADRs 0009 and 0010. It keeps all filesystem, persistence,
preview protocol, and export authority in main and adds no generic renderer
capability or public filesystem interface.
