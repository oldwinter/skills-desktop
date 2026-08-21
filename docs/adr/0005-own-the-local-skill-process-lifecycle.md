# Own the local skill process lifecycle

One deep `LocalSkillsProcess` Module owns local Inventory observation,
Prepared Mutation creation, and Confirmed Mutation execution through a narrow
three-method Interface. It binds one trusted Local Target to an exact supported
`npx skills` dialect and hides executable argument arrays, environment policy,
process control, parsing, redaction, and post-mutation verification. Keeping the
whole lifecycle behind one Interface prevents a generic process runner,
renderer-provided preview, or split planning Module from redistributing
security-critical CLI knowledge across callers.

## Consequences

- Project and global reads produce one atomic Fresh Inventory; partial reads do
  not replace the prior Inventory.
- A Prepared Mutation privately retains its executable plan while exposing only
  a reviewable Command Plan. Confirmation is bound, expiring, and single-use.
- V1 supports explicit named `add`, `remove`, and `update` intents. It exposes
  no arbitrary flags, wildcard mutation, source-list parsing, or experimental
  lockfile restore.
- Mutation Outcomes separate process disposition from observable effects and
  use a postflight Inventory whenever termination is confirmed.
- Process policy and evidence are bounded, structured, and redacted. The main
  verification surface is the `LocalSkillsProcess` Interface, backed by an
  internal scripted process Adapter and a small read-only real-CLI smoke test.
