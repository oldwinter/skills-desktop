# Promote POSIX SSH with Wire v3

Status: Accepted

## Context

The current public product is Local-only, although ADR 0006 defines an SSH
shape. Multi-harness Targets and source inspection require a breaking remote
contract. Existing trust behavior also needs two corrections before public
SSH use: binding or trust drift must not clear a surviving Guard, and host-key
rotation must invalidate every Target sharing the effective host-key identity.

## Decision

The accepted product destination is Local plus POSIX Remote SSH. Promotion is
staged: SSH Inventory and source inspection remain unavailable until the
Milestone 3 packaged trust and observation gate passes; SSH mutation remains
unavailable until the Milestone 4 uncertainty and recovery gate passes.
Windows may run the desktop client but is not a Remote SSH Target.

System OpenSSH remains the transport and credential authority. Each check,
observation, inspection, mutation, cancellation, postflight, or reconciliation
uses a fresh non-interactive SSH session. Skills Desktop stores only non-secret
aliases and explicitly reviewed public host keys in its own trust store. A
rotation invalidates all Targets sharing the resolved host-key identity.
Generation and session authority change, but an existing Guard is retained.

Wire Protocol v3 is a breaking, fail-closed protocol between main and the fixed
Remote Bootstrap. Every request binds protocol, request, Target Generation,
CLI dialect, registry version and digest, bootstrap digest, canonical POSIX
workspace, and exact harness set. It accepts only observe, inspect source,
closed mutation, and matching cancel frames. Dynamic values travel only in
bounded length-prefixed UTF-8 JSON; the SSH remote command remains a build-time
constant. There is no downgrade, generic command, generic argv, helper install,
connection pool, or automatic retry.

Mutation cleanup proof and complete project/global postflight remain in the
same session. Missing terminal evidence yields Remote Outcome Uncertain,
retains the Guard, blocks retry and ordinary refresh, and requires explicit
deadline-aware reconciliation.

## Alternatives considered

- Keep the final product Local-only. Rejected because the approved mission
  explicitly expands the product scope after safety gates.
- Reuse Wire v2 through optional fields. Rejected because registry, generation,
  source, and cleanup binding are security-critical and require strict peers.
- Use persistent SSH sessions or retry transport loss. Rejected because neither
  resolves uncertainty about consequential remote effects.

## Consequences

Local and SSH remain substitutable at `SkillsProcessV2`, not at a generic
transport seam. Public claims must lag implementation until the named packaged
gates pass. Live external hosts and Windows SSH Targets are not qualification
requirements.

## Relationship to earlier decisions

This record amends ADRs 0003, 0006, 0010, and 0012. It preserves OpenSSH secret
ownership and ADR 0006's fixed-command, explicit-trust, fresh-session, and
uncertain-outcome rules while replacing its earlier Wire contract with Wire
v3. It authorizes eventual public SSH scope only after the stated gates.
