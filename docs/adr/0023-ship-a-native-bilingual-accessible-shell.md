# Ship a native bilingual accessible shell

Status: Accepted

## Context

The existing production shell proves the Local tracer but does not define the
native, bilingual, accessible interaction contract required by the expanded
product. New workflows also outgrow Workspace and Review v1. Copying the
prototype monolith or adding generic IPC would preserve the wrong seams.

## Decision

Electron remains the desktop runtime. The production renderer is reorganized
by feature and continues to consume one purpose-built `DesktopClient`
projection. Main owns localized application menus, accelerators, context
menus, About, native file and directory dialogs, and focus restoration. Menu
commands enter the same `DesktopCapabilities` authorization and eligibility
path as renderer requests.

Every user-facing message uses a stable key with complete English (`en`) and
Simplified Chinese (`zh-CN`) catalogs. The operating-system locale supplies the
initial default; an explicit user preference wins thereafter. Identifiers,
domain codes, Harness IDs, source values, and evidence are never translated or
parsed from localized text.

Appearance is `system`, `light`, `dark`, or `high-contrast`. System mode tracks
OS changes; explicit modes do not. All workflows must remain keyboard-complete
with visible focus, semantic status, reduced-motion support, 200% and 400%
zoom, narrow-window layouts, forced-colors support, and WCAG 2.2 AA contrast.
After a native dialog or Trusted Review closes, focus returns to the invoking
control when it exists, otherwise to the nearest route heading.

Workspace Protocol v2 and Review Protocol v2 are strict bundled contracts.
Workspace v2 is a closed request/result/event union for the named product
capabilities. Review v2 is a closed projection union for mutation execution,
mutation cancellation, host trust, Collection apply, and publication push.
Neither protocol exposes generic process, filesystem, URL, SSH, Git, argv,
channel, confirmation, or persistence authority. They do not negotiate with
v1; a v1 sender in a v2 document is rejected. Main still validates role, main
frame, role URL, document epoch, schema, bounds, and current state.

## Alternatives considered

- Build separate web-style shells per feature. Rejected because they would
  duplicate navigation, state, and authorization.
- Keep v1 and add optional messages indefinitely. Rejected because security
  roles and multi-harness semantics need one strict bundled contract.
- Copy prototype UI and command previews into production. Rejected because the
  prototype is evidence, not authority or production structure.

## Consequences

Locale, appearance, menu, focus, accessibility, and protocol matrices become
release gates. Renderer reload or event gaps recover from a fresh Snapshot;
view-local state remains disposable and never becomes domain authority.

## Relationship to earlier decisions

This record amends ADRs 0009 and 0010. It preserves sandboxed role isolation,
main-owned authority, strict schemas, Trusted Review, event resynchronization,
and the four principal deep interfaces while replacing bundled Workspace and
Review v1 with v2.
