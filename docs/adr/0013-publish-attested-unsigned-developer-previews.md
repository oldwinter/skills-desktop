# Publish attested unsigned developer previews before signed stable releases

This decision narrowly supersedes ADR 0011 where that record prohibited every
public unsigned macOS or Windows artifact. ADR 0011 remains authoritative for
Stable Releases, platform signing, notarization, update feeds, production
approval, and immutable stable publication.

## Context

The cross-platform product and unsigned native candidate pipeline can be
exercised before the paid Apple Developer and Windows trusted-signing
prerequisites are available. Keeping every candidate private prevents early
users from testing real installation and complete workflows, while pretending
that locally or self-signed bytes satisfy platform publisher trust would weaken
the stable-release contract accepted in ADR 0011.

Electron documents that unsigned macOS and Windows applications require
advanced manual steps. Apple Gatekeeper does not treat an ad-hoc signature as a
Developer ID identity or notarization, and Windows does not trust a self-signed
certificate unless the user or device administrator separately installs that
trust. These paths are suitable only for informed preview users.

## Decision

Skills Desktop may publish an **Unsigned Developer Preview** from the existing
candidate pipeline while paid signing prerequisites are deferred.

The preview pipeline:

- runs either by explicit manual dispatch against `main` or automatically when
  an exact `vX.Y.Z` tag is pushed;
- rejects a tag before dependency installation unless its version matches every
  application/workspace package and lockfile version and its commit belongs to
  `main` history;
- rebuilds nothing after candidate identity, SHA-256, SPDX SBOM, and GitHub
  artifact attestations are verified;
- stages a private GitHub draft, verifies its exact assets, and only then changes
  that release to a public pre-release without replacing assets;
- keeps `stableEligible: false`, `prerelease: true`, and `latest: false`;
- states prominently that Apple notarization, Developer ID, Authenticode, and
  publisher reputation are absent;
- links installation guidance to the exact source commit and requires users to
  verify checksums and provenance before overriding platform protection;
- does not provide an application, installer, or script that installs a local
  certificate as a trusted root or disables platform security globally;
- may document a manual quarantine-attribute removal command scoped to the
  verified `/Applications/Skills Desktop.app` bundle while signing and
  notarization are deferred.

On macOS, an informed user may apply an ad-hoc signature to the verified local
application copy and use Apple's per-application **Open Anyway** flow. The
signature seals those local bytes but proves no publisher identity and does not
replace notarization.

On Windows, the preview remains unsigned. A self-signed certificate is a
developer or managed-enterprise mechanism, not a public trust mechanism. The
project does not tell public users to add an unverified certificate to Trusted
Root; users may proceed only when Windows exposes its own per-file override and
local policy permits it.

Linux preview packages rely on the published checksum and GitHub attestation;
V1 still does not introduce a package repository or long-lived Linux signing
key.

Unsigned Developer Previews do not participate in automatic updates. GitHub
marks them as pre-releases, which the accepted `update.electronjs.org` stable
feed excludes. Preview upgrades are manual.

For an automatic tag publication, the GitHub Release uses the triggering tag
itself. The workflow verifies that the tag already exists, stages the assets in
a private draft, verifies the exact uploaded bytes, and then publishes that
same release as a non-latest pre-release. The workflow does not synthesize or
move the triggering tag.

## Alternatives

- **Keep all artifacts private until signing is funded.** Safest, but blocks
  early installation and user feedback.
- **Call self-signed artifacts stable.** Rejected because platform trust,
  publisher continuity, notarization, independent approval, and update safety
  would all be missing.
- **Teach users to install a project self-signed root certificate.** Rejected
  because it creates durable local trust without a trusted distribution path
  for that root.
- **Remove quarantine or disable Gatekeeper/SmartScreen globally.** Rejected
  because the scope exceeds this application and weakens the user's machine.

## Consequences

Early users can install exact attested candidate bytes without maintainers
paying for signing identities. The experience includes prominent warnings and
may be blocked by managed-device policy. macOS users must explicitly approve
the application, Windows users see an unverified publisher and may be unable to
continue, and preview-to-preview updates are manual.

Maintainers can publish the complete native matrix by tagging an already merged
versioned commit. This removes the manual publication switch for tagged
previews, so write access to version tags is release authority for this
explicitly unsigned channel. It does not grant Stable Release, signing,
notarization, or automatic-update authority.

Issues #27 through #33 remain the path to a Stable Release and are deferred,
not satisfied. Funding or provider eligibility resumes that chain without
changing this preview contract.
