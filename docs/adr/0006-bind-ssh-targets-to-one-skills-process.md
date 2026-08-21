# Bind SSH Targets to one Skills Process

## Context

Skills Desktop must apply the same structured skill operations to local and SSH
Targets without exposing a generic process runner or executing renderer-built
shell text. SSH adds identities that OpenSSH normally collapses behind a host
alias, an unavoidable remote command string, host-key enrollment, connection
loss, and cancellation that cannot by itself prove a remote mutation stopped.
These concerns must not leak into callers of the skill operation lifecycle.

## Decision

`SkillsTargets.open(TargetId)` resolves and freezes an Effective Target Binding
and returns either a ready `SkillsProcess`, a host-trust challenge, or a
structured error. Opening does not establish or retain a connection. Once
ready, Local and SSH Adapters implement the same deep three-method Interface:
`observeInventory`, `prepareMutation`, and `executeConfirmed`.

### Target identity

- `TargetId` is an application-generated stable UUID. A display label and SSH
  Connection Reference are attributes, not identity.
- An SSH Connection Reference is an OpenSSH host alias. `ssh -G` resolves its
  effective user, host, port, and host-key lookup identity for each operation.
- The Effective Target Binding also contains the canonical workspace, harness,
  confirmed host key, and Wire Protocol dialect.
- Any execution-relevant definition, effective OpenSSH configuration, host
  trust, workspace, harness, or dialect change advances Target Generation,
  makes the prior Inventory stale, and invalidates Prepared Mutations.

### OpenSSH and host trust

V1 uses the system OpenSSH client and has no embedded SSH fallback. It reuses
the user's OpenSSH configuration, credential agent, and jump-host setup, while
keeping private keys and passwords outside Skills Desktop. A missing client is
a repairable `transport-unavailable` error.

Skills Desktop owns a separate OpenSSH-format store containing only confirmed
public host keys. First use presents a short-lived challenge with the effective
host-key identity, algorithm, and SHA256 fingerprint. Confirmation writes that
exact key without changing the user's `known_hosts`; subsequent connections use
strict host-key checking. A changed key is an error and requires a separate,
explicit rotation flow rather than first-use confirmation. SSH sessions are
non-interactive and do not enable TTY, agent forwarding, port forwarding, or
application-managed multiplexing.

### Remote invocation

Each SSH operation invokes a build-time fixed, versioned Node Remote Bootstrap.
The remote command string contains no Target, workspace, skill name, Mutation,
or renderer data. All dynamic input and output uses bounded, length-prefixed,
versioned structured frames over SSH stdin and stdout; SSH stderr remains a
separate transport channel.

The Remote Bootstrap accepts only the closed observe and confirmed-mutation
operations, validates every field, and constructs the supported `npx skills`
argument arrays. It exposes neither arbitrary command text nor generic argument
vectors. V1 does not require a separately installed remote helper. An SSH
Target must provide a POSIX login shell and compatible `node` and `npx`;
Windows can run the client but is not a V1 SSH Target platform.

### Sessions, cancellation, and reconciliation

Opening and preparing are local. Inventory observation and confirmed execution
each use a new SSH session; execution includes postflight observation in that
session. V1 has no connection pool, ControlMaster use, implicit queue, retry, or
resume. Project and global reads publish one atomic Inventory.

Cancellation first sends a Wire Protocol cancellation request and waits up to
two seconds for a final frame proving remote child cleanup. If none arrives,
the Adapter terminates its local SSH process tree but reports
`remote-outcome-uncertain`; it does not claim that the remote mutation stopped,
run an automatic postflight, or retry. The Target enters
`reconciliation-required`, blocks further mutations, and can be reconciled only
through an explicit flow after the original operation deadline. Cancelling an
observation never publishes a partial Inventory and does not require mutation
reconciliation.

### Errors, evidence, and verification

Errors carry a stable code, phase, retryability, effects certainty, and bounded
structured evidence. SSH-specific codes include `transport-unavailable`,
`ssh-config-invalid`, `host-trust-required`, `host-key-changed`,
`transport-failed`, `remote-runtime-unavailable`,
`remote-protocol-mismatch`, `remote-protocol-violation`, `transport-lost`,
`remote-outcome-uncertain`, and `reconciliation-required`. OpenSSH exit 255 or
stderr text alone never establishes a precise authentication or network cause.

Hostname, username, IP address, workspace, identity paths, proxy command, agent
socket, Wire Protocol payloads, and raw SSH or CLI streams do not cross the
Adapter seam or enter logs. Permitted evidence includes TargetId, phase,
duration, exit disposition, byte counts, truncation, and effects certainty;
trust UI may show the fingerprint and Target values the user configured.

The main contract suite runs the same observe, prepare, confirm, and execute
scenarios against Local and SSH Adapters. SSH-specific tests cover alias and
host-key resolution, first trust, key changes, configuration drift, shell
metacharacters in structured data, protocol contamination, phase-specific
cancellation, connection loss, uncertain outcomes, and evidence redaction. A
scripted OpenSSH executable provides deterministic tests, with a disposable
localhost SSH server reserved for integration coverage.

## Alternatives Considered

- An embedded SSH library was rejected because it would make configuration,
  agent, trust, and protocol maintenance application responsibilities.
- A generic remote command or argument-vector Interface was rejected because
  SSH transports one remotely interpreted command string and callers could
  bypass the typed skill lifecycle.
- A preinstalled remote helper was rejected for V1 because its installation and
  upgrade contract adds another remote lifecycle without changing the required
  structured protocol boundary.
- Ambient user `known_hosts` alone and modifying that file in place were
  rejected because neither gives the application an explicit, isolated Target
  trust binding.
- Persistent connections and automatic retries were rejected because they add
  state without resolving uncertainty about remote mutation effects.

## Consequences

- Callers remain transport-agnostic after opening a Target, while the SSH
  Adapter owns configuration resolution, trust, framing, process control,
  redaction, and reconciliation.
- First-time trust and key rotation require explicit user interaction.
- Remote setup requires working system OpenSSH locally and POSIX plus Node/npx
  remotely, but no Skills Desktop daemon or helper installation.
- Losing a mutation session may deliberately block later mutations until the
  user reconciles the Target.
- The fixed Remote Bootstrap and Wire Protocol become security-sensitive,
  versioned compatibility surfaces that require focused tests.

## Superseded Records

None. This record completes the host-key policy left open by ADR 0003 and
extends the lifecycle in ADR 0005 across the shared Skills Process seam.
