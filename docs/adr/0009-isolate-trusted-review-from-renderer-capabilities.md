# Isolate trusted review from renderer capabilities

Skills Desktop exposes purpose-built, versioned preload methods to an ordinary
sandboxed renderer while a deep main-process Desktop Capabilities Module owns
authorization, state, confirmation binding, execution, cancellation, event
ordering, and redaction. A separate, role-bound confirmation window receives
only the immutable review selected by main and can approve or reject it; the
ordinary renderer can request that review be shown but can never receive or
submit execution authority.

## Consequences

- Every window keeps Node integration off, context isolation, renderer
  sandboxing, and web security on. Production windows load allowlisted bundled
  assets from secure role-specific custom-protocol URLs and deny unexpected
  navigation, child windows, webviews, permissions, downloads, and remote
  content.
- Preloads expose no Electron objects, generic channel names, filesystem or
  process APIs, command text, argument vectors, environment, or working
  directory. Purpose-built methods map through fixed channels to one closed,
  versioned request union inside main; adding privilege requires a new schema,
  role grant, handler, redaction projection, and contract tests.
- Main authorizes every call from its registered live `WebContents` role, exact
  main frame, exact packaged URL, and current session epoch, then validates a
  strict bounded plain-data schema. Renderer-provided identifiers are lookup
  references, not capabilities.
- A review window is bound to one private Prepared Mutation or Collection Plan.
  Approval has no renderer-supplied plan or token: main atomically revalidates
  expiry, digests, Target Generations and bindings, Fresh Inventories,
  Collection status, Target availability, and Mutation Guards; it consumes the
  review before writing the durable guard and starting execution.
- Long operations are main-owned. Ordinary renderer teardown cancels its
  pending reads and unconfirmed reviews but does not silently cancel an active
  mutation or clear its guard. Observation cancellation is direct and
  idempotent; interrupting a mutation requires a new Trusted Review because it
  may leave effects uncertain.
- One fixed typed event feed uses a session epoch, monotonic sequence, state
  revision, bounded buffering, coalesced progress, and a resync-required state.
  Events are hints; a fresh Snapshot is the recovery authority after a gap,
  overflow, or renderer reload.
- Expected failures cross IPC only as bounded `Result` errors with stable code,
  phase, retryability, effects certainty, and allowlisted evidence. Exceptions,
  stacks, raw payloads, paths, host details, arguments, environment values, and
  process or SSH streams never cross the renderer or diagnostic-log boundary.
- Release builds disable Electron's Node runtime escape fuses and extra
  `file:` privileges, and enable packaged-ASAR-only loading and embedded ASAR
  integrity where Electron supports them. The distribution decision remains
  responsible for applying and verifying the platform-compatible fuse set.
- Contract tests exercise the main Module through in-memory Adapters and the
  same schemas used by Electron. Packaged Electron smoke tests cover window
  preferences, role and sender isolation, malicious frames and payloads,
  confirmation replay and state drift, cancellation certainty, event resync,
  renderer teardown, output validation, and redaction sentinels.

This hybrid keeps the renderer API explicit and auditable without scattering
security policy across IPC handlers. It costs a dedicated review lifecycle and
bounded event protocol, but prevents compromise of the ordinary renderer from
self-confirming privileged execution.
