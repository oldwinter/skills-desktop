# Ship reviewed, pinned Collection recipes

V1 treats a Collection as a reviewed recipe for producing typed Mutation
Intents, not as installed desired state, a package, or another registry. Only
Official Collections owned by Skills Desktop maintainers and delivered through
the verified application release are executable. User-authored manifests,
third-party catalogs, remote feeds, and catalog hot updates are outside V1 so
the meaning of "curated" has one accountable trust root.

Every immutable Collection Release binds a stable Collection identity and
monotonic release number to a canonical manifest digest, one public GitHub
repository, one full 40-character Reviewed Source Revision, exact
case-sensitive skill names, explicit compatibility claims, and a Collection
Review Receipt. The receipt identifies the author and at least one different
reviewer and binds their review to the complete manifest and review policy.
Unknown or mutable source revisions and other CLI source forms cannot enter the
executable catalog. The commit constrains what was reviewed and requested from
`npx skills`; it is not evidence of the Revision actually installed.

## Consequences

- Manifests have an independently versioned strict schema. Unknown fields,
  duplicate or case-conflicting names, invalid digests, and broken supersedes
  chains make a release non-executable. Collection persistence must match the
  catalog shipped by the verified application release.
- Compatibility explicitly allowlists stable Harness IDs, operating-system
  platforms, the supported pinned CLI dialect, and any required Target
  capabilities. Missing or unverifiable compatibility fails closed.
- A Collection Update means a newer reviewed manifest delivered with an
  application update, not upstream branch drift or an installed Skill update.
  Active releases may be planned; deprecated and revoked releases remain
  inspectable but cannot produce new Mutation Intents and never alter installed
  Skills automatically.
- Collection metadata and release deltas remain available offline. Skill
  content is never vendored, cached, proxied, or copied between Targets; each
  Local or SSH Target fetches the pinned public source through its own
  `npx skills` Adapter. Source failures are structured per-Target outcomes with
  no fallback revision or automatic retry.
- Assessment against a Fresh Inventory preserves missing,
  present-content-unknown, source-conflict, removal-candidate, and incompatible
  outcomes. Missing entries produce pinned named `add` intents. Same-source
  entries are unchanged unless the user explicitly requests pinned reapply;
  source conflicts require a separate remove/add decision, and entries removed
  from a later release are never removed automatically.
- Collection planning uses no wildcard, runtime `add --list` parsing, generic
  `update`, command text, or separate argument planner. A review-only Collection
  Plan aggregates the canonical `SkillsProcess` child Command Plans and binds
  an aggregate confirmation to their exact release, Targets, scopes,
  selections, generations, Inventories, and review digests.
- Confirmed child mutations execute one Target at a time in the reviewed order.
  A failure, drift, or uncertain outcome prevents later children from starting;
  successful children are not rolled back and remaining confirmations are
  discarded. Continuing requires new Fresh Inventories, plans, and
  confirmation.
- Outcomes stay per Target and skill. Content remains unverified when the
  authoritative Inventory supplies no Revision or Content Fingerprint, and the
  application never claims an installed Collection version. A Collection
  Acknowledgement records only that a user reviewed a release or delta.

This deliberately trades extensibility and instant catalog updates for a
small, auditable supply-chain boundary that continues to delegate discovery and
mutation to the pinned `npx skills` contract.
