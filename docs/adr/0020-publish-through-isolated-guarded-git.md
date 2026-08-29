# Publish through isolated guarded Git

Status: Accepted

## Context

Users may want to publish a deterministic export to Git. Running Git in a user
worktree, accepting arbitrary refspecs, or retrying an ambiguous push would
expand authority and risk unrelated data. Export must also remain useful
without Git.

## Decision

Export-only is the default and invokes no Git. Automatic publication is a
separate main-only `GitPublisher` interface accepting only a sanitized HTTPS or
SSH remote, one exact `refs/heads/*` branch, allowlisted managed paths, and the
expected deterministic tree digest. It accepts no working directory, command,
argv, config, hook, force flag, tag, delete, wildcard, or arbitrary refspec.

Preparation creates a mode-0700 application-owned temporary root and uses
system Git there. It never opens or changes a user worktree or Git config.
Hooks, signing, filters, and unsafe indirection are disabled for each
invocation. System Git and OpenSSH retain credential authority; Skills Desktop
does not read or persist credentials or helper output.

`PublicationPlanV1` binds the sanitized remote, exact branch, reviewed base or
unborn state, candidate commit, every managed path and digest, tree digest,
expiry, and plan digest. A separate `publication-push` Trusted Review displays
those facts. Approval revalidates all bytes and fetches the exact branch again.
Remote drift invalidates the review and causes no push.

Main commits a durable Publication Guard before the exact fast-forward push can
start. Exact remote-ref readback classifies `published`, `not-published`,
`diverged`, or `uncertain`. An uncertain result retains the Guard and blocks a
second push. Reconciliation performs readback only and never pushes
automatically. Cleanup removes only the proven application-owned root.

## Alternatives considered

- Publish from the user's current checkout. Rejected because unrelated files,
  hooks, config, and branches would enter the authority surface.
- Use force push or lease-based overwrite. Rejected because publication is
  fast-forward only.
- Retry when transport fails. Rejected because the first push may have reached
  the remote.

## Consequences

Git publication has its own plan, review, Guard, outcome, and recovery states.
Local bare Git is the hard acceptance surface. Live external remotes are later
qualification and cannot be claimed from fixture evidence.

## Relationship to earlier decisions

This record extends ADRs 0007, 0009, 0010, and 0012. It applies the existing
main-owned review, durable-before-consequence, redaction, and staged-tracer
rules to Git without changing mutation authority.
