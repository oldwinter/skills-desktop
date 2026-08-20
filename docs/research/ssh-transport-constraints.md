# SSH Transport Constraints

Research for [issue #3](https://github.com/oldwinter/skills-desktop/issues/3),
"Establish desktop SSH transport constraints". Read on 2026-08-20.

This note records facts and usable primitives. It does not choose a transport,
define the target schema, or decide a host-key policy. Those are later product
and architecture decisions.

## Executive Summary

- A spawned system `ssh` client gives the application the host operating
  system's OpenSSH configuration, known-hosts database, agent integration,
  jump-host support, and platform updates. Its cost is a runtime dependency,
  platform-specific installation/configuration, a text-oriented diagnostic
  interface, and a remote command boundary that is still one shell command
  string rather than a remote `argv[]`.
- An embedded Node SSH implementation can expose host-key callbacks, separate
  stdout/stderr streams, exit code/signal events, and connection lifecycle
  callbacks directly. It does not automatically inherit the user's complete
  OpenSSH configuration or trust database: the application must provide those
  policies and keep its protocol, key, agent, and algorithm behavior current.
- Local argument safety and remote argument safety are different problems.
  Node can launch `ssh` with an argument array and no local shell. OpenSSH then
  joins remote command arguments with spaces and sends one SSH `exec` command
  string; the remote server/shell interprets that string.
- Cancellation can reliably stop or disconnect the local transport process,
  but SSH does not guarantee that a remote command tree stops. The SSH `signal`
  request is optional, and OpenSSH documents that closing an inactive session
  need not remove shell processes. Any stronger guarantee needs an explicit
  remote protocol or command contract.
- The result boundary should preserve transport phase, spawn/connection error,
  exit code, signal, stdout, stderr, and cancellation/timeout state separately.
  Raw command arguments, private-key paths, prompts, debug output, and command
  output must be redacted or bounded before logging or persistence.

## Scope and Source Standard

The sources below are primary sources: OpenSSH/OpenBSD manuals and source
documentation, the SSH connection protocol specification, official Node and
Electron documentation, Microsoft documentation for its OpenSSH distribution,
and the first-party `ssh2` repository documentation. Claims about product
behavior are deliberately marked as implications or later decisions rather
than presented as facts about these sources.

## Availability and Runtime Boundary

### OpenSSH availability

Portable OpenSSH describes itself as a port of OpenBSD OpenSSH to most Unix-like
systems, explicitly including Linux and macOS (called OS X in that README), and
lists `ssh`, `sshd`,
`ssh-agent`, `ssh-keygen`, `scp`, and `sftp` as part of the distribution. This
means a system-client transport is a dependency on the host installation, not a
binary that Electron automatically supplies. [Portable OpenSSH README](https://github.com/openssh/openssh-portable/blob/master/README.md)

Microsoft documents OpenSSH for Windows beginning with Windows 10 build 1809
and Windows Server 2019. On Windows 10 and Windows Server 2019/2022 the client
is an optional feature rather than installed by default; Windows Server 2025
lists it as installed but not enabled. The client and `ssh-agent` are separate
components that can be checked/installed as Windows capabilities. [Microsoft:
OpenSSH for Windows overview](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-overview)

OpenSSH client configuration is also platform-dependent. Windows searches, in
order, a `-F` path, `%userprofile%\\.ssh\\config`, and
`%programdata%\\ssh\\ssh_config`; Unix OpenSSH documents command-line options,
`~/.ssh/config`, and `/etc/ssh/ssh_config`. [Microsoft: Windows OpenSSH
configuration](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration)
  [OpenBSD `ssh_config(5)`](https://man.openbsd.org/ssh_config)

### Electron and Node

The prototype's `prototype/package.json` declares Electron `^43.4.1`, so the
packaged runtime is the relevant compatibility target for the current product
definition. Electron 43's official release notes identify its bundled Node.js
version as `v24.17.0`; a later packaged Electron version could change the
available Node primitives and must be checked separately. [Electron 43 release
notes](https://www.electronjs.org/blog/electron-43-0)

Electron's main process runs in a Node.js environment and can use Node APIs;
renderer processes do not have direct `require` or Node API access by default.
Electron's IPC guidance therefore puts native operations such as spawning a
client in the main process (or behind a narrow main-process/utility-process
boundary), with a typed capability exposed to the renderer. [Electron process
model](https://www.electronjs.org/docs/latest/tutorial/process-model)
  [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)

Electron bundles its own Node runtime; an end user does not need a separate
system Node installation, and the app can inspect `process.versions` to learn
the embedded version. The exact Node API contract must therefore be checked
against the packaged Electron version, not assumed from the developer's shell
Node. [Electron prerequisites](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites)

Electron also provides `utilityProcess.fork()` for a Node-enabled child
process, with a `kill()` method that uses `SIGTERM` on POSIX and reaps the child
on exit. That is an Electron process-isolation primitive; it does not change
the semantics of an arbitrary `ssh` child or of remote process cancellation.
[Electron `utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process)

## Explicit Target Identity and OpenSSH Configuration

OpenSSH accepts a destination as `[user@]hostname` or an SSH URI and supports
explicit `-l` (user), `-p` (port), `-i` (identity file), `-F` (configuration
file), and `-o key=value` options. `ssh -G destination` prints the effective
configuration after `Host` and `Match` evaluation, which is a useful diagnostic
primitive but is output text, not a typed API. [OpenBSD `ssh(1)`](https://man.openbsd.org/ssh)

OpenSSH applies configuration sources in this order: command-line options,
the user's config, then the system config. For each directive, the first value
obtained is used, and `Host` sections match the hostname argument supplied on
the command line (subject to canonicalization). A caller that lets arbitrary
user config participate must account for this precedence and for directives
that execute commands. [OpenBSD `ssh_config(5)`](https://man.openbsd.org/ssh_config)

### Aliases are not host-key identity

`Host` is a pattern used to select configuration. `HostName` maps the selected
name to the real host name or address to which OpenSSH logs in. In contrast,
`HostKeyAlias` changes the name used when looking up or saving the host key in
known-hosts files and when validating host certificates. Therefore, a friendly
host alias by itself does not pin a host key; the key lookup name and the
network destination must be represented separately. [OpenBSD
`ssh_config(5)`: `HostName` and `HostKeyAlias`](https://man.openbsd.org/ssh_config)

The same manual exposes `User`, `Port`, `IdentityFile`, `IdentitiesOnly`, and
`IdentityAgent` as per-host configuration. `IdentityAgent` overrides
`SSH_AUTH_SOCK`, can select a specific socket, or can be set to `none` to
disable agent use. `IdentitiesOnly yes` restricts authentication to configured
identity/certificate files even when an agent offers more identities. [OpenBSD
`ssh_config(5)`: identity directives](https://man.openbsd.org/ssh_config)

The target contract consequently needs to distinguish, at minimum, the user,
network host/port, the user-facing alias, the config source, identity source,
agent mode, and host-key lookup identity. Whether a product target is allowed
to inherit the user's config or must use an app-controlled config is an
unresolved product decision.

## Agent Reuse and Non-Interactive Mode

OpenSSH locates a Unix authentication agent through `SSH_AUTH_SOCK`; the
`ssh-agent(1)` manual describes the agent as holding private keys and using
environment variables so `ssh` can use those identities without sending the
private keys over the network. The socket is accessible to the current user
and can be abused by root or another process running as that user. [OpenBSD
`ssh(1)` environment](https://man.openbsd.org/ssh)
  [OpenBSD `ssh-agent(1)`](https://man.openbsd.org/ssh-agent)

On Windows, Microsoft documents an `ssh-agent` service that is disabled by
default, can be started for the user's security context, and is then used by
the OpenSSH client after `ssh-add` loads a key. This is a service/configuration
prerequisite, not a guarantee that every Windows installation has an active
agent. [Microsoft: key-based authentication and `ssh-agent`](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement)

`BatchMode yes` disables password prompts and host-key confirmation requests;
it is the OpenSSH primitive for a no-UI operation. It does not make an
otherwise unsafe target trusted and it does not supply a missing key or agent.
`AddKeysToAgent` can add a key loaded from a file to a running agent, so a
caller should treat it as a state-changing authentication option. [OpenBSD
`ssh_config(5)`: `BatchMode` and `AddKeysToAgent`](https://man.openbsd.org/ssh_config)

Agent forwarding is a separate operation. OpenSSH warns that a remote user who
can access the forwarded agent socket can use the identities to authenticate,
even though private key material is not obtained. The normal local-client
transport should not silently enable `ForwardAgent`/`-A`; whether forwarding is
needed is a later product decision. [OpenBSD `ssh(1)`: `-A`](https://man.openbsd.org/ssh)

The evaluated embedded library exposes an explicit `agent` config (a Unix
socket path, or Windows Pageant/Cygwin forms) and an `agentForward` flag. It
also exposes `OpenSSHAgent`, `PageantAgent`, and `CygwinAgent` helpers. Unlike
system `ssh`, the library API requires the application to select/pass the
agent; it does not by itself reproduce all OpenSSH config discovery. [First-party
`ssh2` README: agent and client configuration](https://github.com/mscdex/ssh2/blob/master/README.md#client)

## Known-Host Verification

OpenSSH maintains host keys in user and system known-hosts files and warns when
an existing host's identification changes. The `StrictHostKeyChecking` values
have materially different behavior:

- `yes` never adds a new key automatically and refuses changed keys.
- `accept-new` adds new keys automatically but refuses changed keys.
- `ask` (the documented default) asks before adding a new key and refuses
  changed keys.
- `no`/`off` adds new keys and permits changed keys subject to restrictions.

`BatchMode yes` disables the confirmation step, so it must be paired with an
already-established trust source if a non-interactive connection is expected.
[OpenBSD `ssh_config(5)`: `StrictHostKeyChecking`](https://man.openbsd.org/ssh_config)
  [OpenBSD `ssh(1)`: verifying host keys](https://man.openbsd.org/ssh)

The client can select `UserKnownHostsFile` and `GlobalKnownHostsFile`, use
`KnownHostsCommand` to emit known-host lines, reject keys via
`RevokedHostKeys`, and use `HostKeyAlias` for a stable lookup name. `CheckHostIP`
can additionally check the destination IP against the known-hosts database.
`UpdateHostKeys` can learn replacement keys after an already trusted
authentication, subject to its documented restrictions. These are usable
primitives for either user-owned or app-owned trust stores, but the choice of
store and enrollment/rotation workflow is not made here. [OpenBSD
`ssh_config(5)`](https://man.openbsd.org/ssh_config)

The embedded `ssh2` library exposes `hostHash` and `hostVerifier`. The callback
receives either the raw host-key buffer or a selected hash and must return (or
asynchronously callback) true to continue. Its documented default is to
auto-accept when `hostVerifier` is absent. An embedded transport must therefore
install an explicit verifier and implement the chosen known-host lookup/pin
format; omitting the callback is not equivalent to OpenSSH's normal known-host
workflow. [First-party `ssh2` README: `hostHash` and `hostVerifier`](https://github.com/mscdex/ssh2/blob/master/README.md#client)

## Argument-Safe Remote Invocation

### Local process boundary

Node's `spawn(command, args, { shell: false })` passes a command and an
argument array without starting a shell. `execFile(file, args, ...)` likewise
spawns the file directly by default; shell redirection and globbing are not
available. Node explicitly warns that enabling `shell` with unsanitized input
can result in arbitrary command execution. This is the correct primitive for
constructing the *local* `ssh` invocation from typed values. [Node
`child_process`](https://nodejs.org/api/child_process.html)

Windows still has a distinct argument-quoting layer: Node documents
`windowsVerbatimArguments`, which disables its quoting/escaping when enabled,
and `windowsHide` for suppressing the console window. The adapter should leave
verbatim argument handling at its documented default unless it has a tested
reason to opt out of Node's quoting. [Node `spawn` options](https://nodejs.org/api/child_process.html#child_process_spawn_command_args_options)

### SSH remote command boundary

OpenSSH's own synopsis accepts `destination command [argument ...]`, but its
manual states that additional arguments are appended to the command,
separated by spaces, before being sent to the server. The SSH protocol defines
the `exec` channel request with one `command` string; it does not define a
remote `argv[]` field. [OpenBSD `ssh(1)`](https://man.openbsd.org/ssh)
  [RFC 4254 section 6.5](https://www.rfc-editor.org/rfc/rfc4254#section-6.5)

The server starts the requested command in the remote environment. OpenBSD's
`sshd(8)` documents that a non-interactive command is executed through the
user's login shell with its `-c` option; Windows OpenSSH documents that its
default remote shell starts as `cmd.exe` unless the server is configured
otherwise. OpenSSH's `RemoteCommand` and `ProxyCommand` options are explicitly
command strings and some config directives execute through the user's shell
without filtering shell-special characters. [OpenBSD `sshd(8)`](https://man.openbsd.org/sshd)
  [OpenBSD `ssh_config(5)`](https://man.openbsd.org/ssh_config)
  [Microsoft: Windows OpenSSH default shell](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration)

The `ssh2` API has the same protocol limitation: `Client.exec()` accepts a
single string `command`; it does not accept a remote argument array. Its
documented server example receives `info.command` as a string. [First-party
`ssh2` README: `exec()`](https://github.com/mscdex/ssh2/blob/master/README.md#client)

**Implication for a later command contract:** an argument array protects the
local process boundary, but cannot make arbitrary remote shell text safe. The
adapter must either restrict remote commands to a fixed grammar with validated
fields, invoke a fixed remote wrapper and send structured data over stdin, or
use an SSH subsystem/protocol with its own framing. It must never treat a
renderer preview string as executable input. The exact wrapper/grammar and
supported remote shells remain product decisions.

For non-interactive machine output, OpenSSH `-T` disables pseudo-terminal
allocation and the manual notes that a session without a pty is transparent
and suitable for reliable binary transfer. A transport carrying JSON or other
framed output should not request a pty unless the remote command explicitly
requires terminal behavior. [OpenBSD `ssh(1)`](https://man.openbsd.org/ssh)

## Cancellation and Process Cleanup

### Local client process

Node provides three related controls:

- `AbortSignal` on `spawn`/`execFile` can close the child; the callback/event
  reports an `AbortError` for the signal path.
- `subprocess.kill(signal)` sends a signal to the child and defaults to
  `SIGTERM`; a successful send does not prove that the process terminated.
- `exit` reports the child exit code or signal, while `close` occurs after the
  stdio streams close and is the reliable completion point for captured output.

Node also documents `timeout`/`killSignal` and warns that a signal may be
handled without terminating the child. [Node `child_process`](https://nodejs.org/api/child_process.html)

`subprocess.kill()` targets the child process, not an arbitrary descendant
tree. Node's own example starts a shell which starts a Node process and notes
that killing the shell does not terminate the nested Node process. On POSIX,
`detached: true` creates a new process group and session; on Windows it gives
the child an independent console and can let it outlive the parent. Those are
building blocks for platform-specific cleanup, not a cross-platform tree-kill
guarantee. [Node `subprocess.kill()` and process groups](https://nodejs.org/api/child_process.html#subprocesskill_signal)
  [Node `detached`](https://nodejs.org/api/child_process.html#optionsdetached)

### Remote command

RFC 4254 defines a `signal` channel request, but explicitly says systems that do
not implement signals may ignore it. The same RFC defines `exit-status` and
`exit-signal` messages, with exit-status return only recommended. [RFC 4254
sections 6.9-6.10](https://www.rfc-editor.org/rfc/rfc4254#section-6.9)

OpenSSH's multiplexing `ssh -O cancel` command cancels forwardings; it is not a
remote-exec cancellation API. Its `ChannelTimeout` documentation warns that
terminating an inactive session does not guarantee removal of associated shell
processes, which may continue to execute. [OpenBSD `ssh(1)`](https://man.openbsd.org/ssh)
  [OpenBSD `ssh_config(5)`: `ChannelTimeout`](https://man.openbsd.org/ssh_config)

The embedded `ssh2` Channel exposes `signal(signalName)`, but its own README
also warns that some server implementations may ignore the request. Closing
the channel/connection therefore provides a local transport stop, not proof
that the remote command tree stopped. [First-party `ssh2` README: Channel
signals](https://github.com/mscdex/ssh2/blob/master/README.md#channel)

**Resulting boundary:** cancellation should record at least `requested`,
`localTransportExited`, and `remoteExitObserved`. A product that promises
remote cancellation needs a remote-side command contract (for example, a
cooperating wrapper with an explicit stop protocol) and must state what happens
when the server, shell, or child process does not cooperate. No such promise is
selected by this research.

## Structured Results and Errors

### System `ssh`

OpenSSH documents that `ssh` exits with the remote command's exit status, or
with `255` when an error occurs. The protocol separately carries remote
`exit-status`/`exit-signal` and stderr as SSH extended data. The process adapter
therefore has reliable primitive fields for the final local exit status,
captured stdout, captured stderr, and (on the Node side) a local signal or
spawn error, but OpenSSH's CLI boundary does not provide a portable structured
error object. [OpenBSD `ssh(1)`](https://man.openbsd.org/ssh)
  [RFC 4254 sections 6.6 and 6.10](https://www.rfc-editor.org/rfc/rfc4254#section-6.6)

Node's `execFile` callback receives `(error, stdout, stderr)`; `error.code` is
the process exit code and `error.signal` is the terminating signal. `spawn`
emits `error` for failures to spawn or kill and reports `code`/`signal` on
`exit` and `close`. The promisified form keeps `stdout` and `stderr` on the
rejected error. [Node `execFile`](https://nodejs.org/api/child_process.html#child_processexecfilefile_args_options_callback)
  [Node ChildProcess events](https://nodejs.org/api/child_process.html#class-childprocess)

`exec`/`execFile` buffer output and have a `maxBuffer` limit; exceeding it
terminates the child and can truncate output. A transport that handles
inventories or diagnostics of unbounded size should use streaming `spawn`, a
deliberate bound, or an explicit truncation marker rather than silently
claiming a complete result. [Node `maxBuffer`](https://nodejs.org/api/child_process.html#maxbuffer-and-unicode)

The documented OpenSSH exit convention makes `255` a collision point: the
outer client uses it for a transport error, while a remote program can itself
return an integer status. A result model should retain the outer process
status, whether an SSH session/remote exit-status was observed, and the raw
remote status separately; it should not infer a precise failure category from
the number `255` alone.

### Embedded `ssh2`

The first-party `ssh2` client emits an `error` event with a `level` identifying
socket-level versus SSH-disconnect errors and may include a description. Its
exec channel has separate readable stdout and `stderr` streams and emits exit
/ close information including code or signal (the SSH specification makes exit
messages optional). These callbacks are convenient inputs to a typed result
model, but connection/authentication errors and remote command errors still
need an application-defined taxonomy. [First-party `ssh2` README: client
events](https://github.com/mscdex/ssh2/blob/master/README.md#client)
  [First-party `ssh2` README: Channel](https://github.com/mscdex/ssh2/blob/master/README.md#channel)

A useful transport-neutral result shape can therefore contain:

```text
transport: system-ssh | embedded-ssh2
phase: spawn | connect | host-key | authenticate | open-session | execute | close
ok: boolean
exitCode: integer | null
signal: string | null
remoteExitCode: integer | null
remoteExitSignal: string | null
stdout: bytes/text (bounded and marked if truncated)
stderr: bytes/text (bounded and marked if truncated)
errorKind: spawn | timeout | cancelled | host-key | auth | network | remote | protocol | output-limit
errorCode: stable local/library code when available
```

This is a proposed evidence shape, not a product API decision.

## Redaction and Sensitive Data

OpenSSH documents private identity files as sensitive and warns that access to
an agent socket allows use of loaded identities. It also supports verbose
debugging (`-v`/`LogLevel`) that prints connection, authentication, and
configuration diagnostics. These facts make private-key contents, passphrases,
agent paths, hostnames/usernames, and verbose stderr inappropriate for
unfiltered persistent logs. [OpenBSD `ssh(1)`](https://man.openbsd.org/ssh)
  [OpenBSD `ssh-agent(1)`](https://man.openbsd.org/ssh-agent)

Node exposes `subprocess.spawnargs` as the full argument list used to launch a
child, and its result/error objects can retain stdout and stderr. A command
argument, environment-derived path, or remote output can contain a secret even
when the transport itself did not log it. Redaction must therefore happen
before telemetry, error serialization, or persistence; retaining the raw
streams should be an explicit, bounded, user-visible choice. [Node
`spawnargs` and stderr](https://nodejs.org/api/child_process.html#subprocessspawnargs)
  [Node `execFile` result](https://nodejs.org/api/child_process.html#child_processexecfilefile_args_options_callback)

## Fact-Based Trade-Offs (No Selection)

| Concern | Spawn system OpenSSH | Embed a Node SSH library (`ssh2` evaluated) |
| --- | --- | --- |
| Host identity and trust | Uses mature OpenSSH `HostName`, `HostKeyAlias`, known-hosts files, host certificates, config precedence, and `StrictHostKeyChecking`; behavior varies with installed version/config. | `hostVerifier` and key hash are direct callbacks, but the app must implement known-host lookup, alias semantics, enrollment, and rotation. The documented default auto-accepts without a verifier. |
| User config and agent reuse | Reuses `~/.ssh/config`, system config, `SSH_AUTH_SOCK`/platform agent, `ProxyJump`, and OpenSSH options; it may also execute config commands and inherit surprising policy. | Explicit host/user/key/agent objects; supports OpenSSH agent sockets and Windows Pageant/Cygwin forms, but no equivalent full config-discovery contract is documented in the evaluated API. |
| Platform footprint | No embedded protocol code, but `ssh` may be absent or optional, especially on Windows; installed version and path must be checked. | NPM dependency ships with the app and does not require a system `ssh` binary, but protocol/key/algorithm behavior and dependency packaging become app-owned. |
| Local invocation safety | Node `spawn`/`execFile` can pass local args without a shell. OpenSSH then serializes remote args into one command string. | `exec()` takes one command string directly; it avoids the local child process boundary but has the same SSH protocol command-string limit. |
| Output and errors | Separate stdout/stderr and exit status are available, but diagnostics are CLI text and `255` is the documented outer error status. | Events/streams expose typed code/signal/error metadata more directly, but the app still defines stable error categories and must handle optional protocol messages. |
| Cancellation | Kill/disconnect the local `ssh` process; process-tree and remote-command stop are not guaranteed. | Close the connection or send `Channel.signal`; servers may ignore signals, and remote descendants are not guaranteed to stop. |
| Maintenance/security ownership | Benefits from OS OpenSSH updates and user security tooling; behavior must be tested across installed versions and platform packaging. | Avoids system-client availability but makes the app responsible for protocol implementation updates, host-key policy, agent integration, and dependency audits. |

These are factual trade-offs only. The product transport remains intentionally
unselected.

## Decisions Still Required Before Implementation

1. Whether a target stores a friendly alias, a network destination, or both;
   how `HostKeyAlias` maps to a verified host key; and whether the app may
   mutate or only read user config/known-hosts files.
2. Which trust sources are supported: an existing known-hosts file, an
   app-owned file, a pre-pinned key/fingerprint, host certificates, or a
   controlled `KnownHostsCommand`; and how first enrollment and key rotation
   are confirmed.
3. Whether agent reuse is opt-in, which platform agent forms are supported,
   whether `IdentitiesOnly` is forced, and whether agent forwarding is ever
   allowed.
4. The remote invocation contract: fixed command grammar, wrapper/subsystem,
   stdin framing, supported remote shells, allowed argument characters, output
   framing, and maximum output size.
5. The cancellation promise: local transport cancellation only, best-effort
   remote signal, or a cooperating remote cancellation protocol.
6. The stable error schema, log retention/redaction policy, and whether raw
   stdout/stderr may ever be shown or persisted.
7. The eventual choice between spawning system OpenSSH and embedding a protocol
   library, after the above policies and cross-platform acceptance tests are
   specified.

## Primary References

- [Portable OpenSSH README](https://github.com/openssh/openssh-portable/blob/master/README.md)
- [OpenBSD `ssh(1)` manual](https://man.openbsd.org/ssh)
- [OpenBSD `ssh_config(5)` manual](https://man.openbsd.org/ssh_config)
- [OpenBSD `ssh-agent(1)` manual](https://man.openbsd.org/ssh-agent)
- [RFC 4254: SSH Connection Protocol](https://www.rfc-editor.org/rfc/rfc4254)
- [Node.js `child_process` API](https://nodejs.org/api/child_process.html)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron `utilityProcess` API](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron runtime prerequisites](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites)
- [Microsoft OpenSSH for Windows overview](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-overview)
- [Microsoft Windows OpenSSH configuration](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration)
- [Microsoft OpenSSH key management](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement)
- [`ssh2` first-party README](https://github.com/mscdex/ssh2/blob/master/README.md)
