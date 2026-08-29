# Qualify an unsigned mission candidate

Status: Accepted

## Context

The comprehensive evolution spans CLI, Electron, SSH, HTTP, Git, persistence,
accessibility, and release surfaces. The current environment can prove these
through isolated Linux fixtures but cannot establish live external service
behavior, macOS or Windows native accessibility, or paid platform signing.
Qualification language must not turn fixture evidence into broader public
claims.

## Decision

Each milestone is accepted only after its deterministic contracts, production
adapter tracer, visible packaged result, recovery path, and full repository
gate pass. Permanent tracers remain active in later milestones. No renderer
mock, private module, document, or ADR is evidence that a capability shipped.

The hard mission surfaces are:

- packaged Linux Electron in an isolated profile;
- real `npx --yes skills@1.5.23` in isolated HOME, workspace, and npm cache;
- disposable localhost POSIX `sshd` with generated keys and app-owned trust;
- ephemeral local HTTP serving exact well-known bytes; and
- fixture-owned local bare Git for publication and readback.

Tests use OS-selected ports and worker-owned temporary roots and stop only exact
owned processes. They never read or change user Inventory, HOME, SSH
credentials or configuration, Git worktrees or configuration, browser
profiles, or external accounts.

Live external SSH and Git, cross-machine production qualification, macOS and
Windows native dialogs, VoiceOver, NVDA, platform signing, notarization, and
publisher identity are deferred. Results from localhost or Linux are labelled
accordingly and are not generalized to those environments.

The mission release outcome is an exact unsigned candidate. If published under
ADR 0013 it is an Unsigned Developer Preview, remains a prerelease and not
latest, uses manual installation and upgrade, and does not enter automatic
update feeds. It is never called signed, notarized, publisher-trusted, or a
Stable Release. ADR 0011's Stable Release requirements remain unchanged and
must be satisfied separately.

Public documentation changes only after the corresponding milestone tracer and
validators pass. The accepted architecture may describe the destination, but
current capability sections must identify what is still gated.

## Alternatives considered

- Treat architecture acceptance as shipped evidence. Rejected because design
  does not exercise production adapters or recovery.
- Require live external accounts for the hard gate. Rejected because that
  would make acceptance credential-dependent and non-reproducible.
- Call unsigned candidates Stable. Rejected because it would bypass platform
  trust, update, and approval requirements.

## Consequences

Handoffs and release notes must name the exact surfaces tested and deferred.
Linux, localhost SSH, local HTTP, and bare Git provide the automated mission
gate. Later native and external qualification adds evidence without weakening
the accepted safety contracts.

## Relationship to earlier decisions

This record amends ADR 0012's tracer order and qualification matrix for the
expanded mission. It preserves ADR 0011 as the Stable Release authority and
ADR 0013 as the only public unsigned preview classification.
