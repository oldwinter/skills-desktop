# Execute only typed, confirmed skill operations

The renderer may request skill operations only through a narrow typed preload
interface. The trusted Electron main process validates the request, produces a
structured Command Plan, and requires explicit confirmation before a local or
SSH adapter starts a process. Rendered preview text is explanatory output and
is never executable input. This preserves one reviewable mutation boundary and
prevents display strings or compromised renderer content from becoming shell
authority.

## Consequences

- Local execution uses argument arrays rather than shell-built commands.
- Remote execution needs a deliberately specified transport contract with the
  same separation between intent, preview, confirmation, and execution.
- IPC validation, confirmation binding, cancellation, and adapter results are
  first-class verification seams.
