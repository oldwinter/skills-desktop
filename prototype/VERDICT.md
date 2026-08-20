# Prototype Verdict

## Decision

Use variant A as the V1 shell for local skill inventory. Bring variant B's paired target selector and diff matrix into a dedicated comparison view. Reserve variant C's lanes for multi-device rollout and collection installation after SSH transport exists.

Do not ship three independent shells. They answer different task-density questions, but one product should share the same navigation, target model, and command-plan boundary.

## What The Prototype Proved

- Electron can read the current workspace and global inventory through `npx skills list --json` without implementing another directory scanner. The smoke run rendered 121 project-plus-global entries with `npx skills` 1.5.23 on this machine.
- `npx skills` does not expose a package-style semantic version for installed skills. Comparison should use presence, source, and a content revision only when the CLI exposes one; otherwise the UI must say that the revision is unknown.
- Harness comparison and device comparison are the same interaction over two target descriptors. The UI can select and swap targets, then generate a local or SSH command plan from the destination.
- A curated collection is metadata over an existing `npx skills` source. Selecting local or remote harness targets can generate one or more `npx skills add` commands without creating a second installer protocol.
- Mutation previews are useful before execution. Add, remove, update, SSH, and collection installation should remain behind a confirmation step in a production client.

## Production Boundary

The next implementation slice should keep the Electron adapter narrow:

1. Parse `npx skills list --json` at the process boundary into a typed inventory model.
2. Add confirmed local `add`, `remove`, and `update` operations by invoking `npx skills` through `execFile`, never through shell-built commands.
3. Add an SSH transport that sends the same `npx skills` commands to an explicitly selected host and returns structured stdout/stderr evidence.
4. Persist only target configuration and curated collection metadata. Do not cache a second authoritative skills inventory.
5. Treat the command previews in this prototype as explanatory output, not executable shell strings.

The prototype is disposable evidence. Production code should be started from these contracts, not promoted from this directory.
