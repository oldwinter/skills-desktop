# Architecture Decision Records

Use this directory for durable decisions that constrain multiple implementation
tickets or are expensive to reverse. Each ADR should state the decision,
context, alternatives, consequences, and superseded records.

Do not create an ADR for routine implementation detail. The initial decision
map is produced by `wayfinder`; accepted decisions can then be recorded here
before `to-spec` collapses them into a buildable product specification.

## Foundation records (0001–0013)

These records remain accepted except where a later ADR explicitly narrows or
supersedes a statement.

1. [ADR 0001: Delegate skill operations to npx skills](0001-delegate-skill-operations-to-npx-skills.md)
2. [ADR 0002: Execute only typed, confirmed skill operations](0002-execute-only-typed-confirmed-skill-operations.md)
3. [ADR 0003: Leave SSH secrets with OpenSSH](0003-leave-ssh-secrets-with-openssh.md)
4. [ADR 0004: Compare only authoritative skill evidence](0004-compare-only-authoritative-skill-evidence.md)
5. [ADR 0005: Own the local skill process lifecycle](0005-own-the-local-skill-process-lifecycle.md)
6. [ADR 0006: Bind SSH Targets to one Skills Process](0006-bind-ssh-targets-to-one-skills-process.md)
7. [ADR 0007: Persist bounded recovery records](0007-persist-bounded-recovery-records.md)
8. [ADR 0008: Ship reviewed, pinned Collection recipes](0008-ship-reviewed-pinned-collection-recipes.md)
9. [ADR 0009: Isolate trusted review from renderer capabilities](0009-isolate-trusted-review-from-renderer-capabilities.md)
10. [ADR 0010: Center production on Desktop Capabilities](0010-center-production-on-desktop-capabilities.md)
11. [ADR 0011: Ship signed platform artifacts](0011-ship-signed-platform-artifacts.md)
12. [ADR 0012: Verify deep interfaces through staged tracers](0012-verify-deep-interfaces-through-staged-tracers.md)
13. [ADR 0013: Publish attested unsigned developer previews](0013-publish-attested-unsigned-developer-previews.md)

## Accepted comprehensive-evolution decisions

The following records accept the architecture decisions required for the
Local-plus-POSIX-SSH evolution. Acceptance authorizes dependent implementation
work. It does not claim that a capability has shipped. Public documentation
must continue to describe the last milestone whose production tracer and
validators passed.

1. [ADR 0014: Multi-harness Targets and pinned registry](0014-adopt-multi-harness-targets-and-a-pinned-registry.md)
2. [ADR 0015: Stable source inspection](0015-inspect-stable-sources-through-the-pinned-cli.md)
3. [ADR 0016: POSIX SSH and Wire v3](0016-promote-posix-ssh-with-wire-v3.md)
4. [ADR 0017: Package origins and canonical skillpacks](0017-separate-package-origins-in-canonical-skillpacks.md)
5. [ADR 0018: Static Studio and filesystem grants](0018-author-skills-with-static-studio-grants.md)
6. [ADR 0019: Deterministic well-known artifacts](0019-export-deterministic-well-known-artifacts.md)
7. [ADR 0020: Isolated guarded Git publication](0020-publish-through-isolated-guarded-git.md)
8. [ADR 0021: External skills.sh handoff](0021-handoff-to-skills-sh-through-the-system-browser.md)
9. [ADR 0022: Recovery Center and schema migrations](0022-recover-through-versioned-records-and-typed-repairs.md)
10. [ADR 0023: Native bilingual accessible shell](0023-ship-a-native-bilingual-accessible-shell.md)
11. [ADR 0024: Mission qualification and unsigned outcome](0024-qualify-an-unsigned-mission-candidate.md)

The foundation records above remain in force except where one of these
evolution records explicitly narrows or supersedes a statement. In particular,
the installed-state authority, typed execution, Trusted Review, Guard,
recovery, renderer isolation, and Stable Release requirements remain in force.
