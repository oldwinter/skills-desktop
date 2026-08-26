# Architecture Decision Records

Use this directory for durable decisions that constrain multiple implementation
tickets or are expensive to reverse. Each ADR should state the decision,
context, alternatives, consequences, and superseded records.

Do not create an ADR for routine implementation detail. The initial decision
map is produced by `wayfinder`; accepted decisions can then be recorded here
before `to-spec` collapses them into a buildable product specification.

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

ADRs 0001 through 0013 remain accepted except where one of these records
explicitly narrows or supersedes a statement. In particular, the installed
state authority, typed execution, Trusted Review, Guard, recovery, renderer
isolation, and Stable Release requirements remain in force.
