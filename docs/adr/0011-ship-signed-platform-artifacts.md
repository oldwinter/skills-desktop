# Ship signed platform artifacts through gated releases

> **Amended by ADR 0013:** This record remains authoritative for Stable
> Releases. ADR 0013 creates a separate, explicitly non-stable Unsigned
> Developer Preview surface and narrowly supersedes this record's former ban on
> every public unsigned artifact. A preview does not satisfy, weaken, or bypass
> any signing, update, approval, or publication requirement below.

V1 distributes native desktop artifacts directly from GitHub Releases rather
than through platform stores or Linux package repositories. Each supported
platform keeps its own packaging, signing, and update authority; a shared
release version and provenance do not imply that one cross-platform update
mechanism can safely install every artifact.

## Distribution Surface

macOS ships separate `arm64` and `x64` artifacts. Each architecture receives a
Developer ID DMG for direct installation and a ZIP containing the same signed
application for Squirrel.Mac updates. V1 does not produce a Universal
application or enter the Mac App Store.

Windows ships `x64` only through Squirrel.Windows: a signed installer EXE, the
full NuGet package, and its `RELEASES` metadata. V1 does not ship MSIX, enter the
Microsoft Store, or claim native Windows ARM64 support. Early SmartScreen
reputation warnings are an accepted limitation, not a reason to publish an
unsigned Stable Release. ADR 0013 separately permits an attested unsigned
developer pre-release with explicit manual-install warnings and no stable-feed
authority.

Linux ships `x64` DEB and RPM files for manual installation and upgrade. V1
does not operate APT or DNF repositories, implement a Linux in-application
updater, or add Snap, Flatpak, or AppImage confinement and update contracts.
The About surface may open the controlled GitHub Releases page but cannot
present a package-manager operation as an application-managed update.

The supported operating-system set for a release is the intersection of the
versions still maintained by their vendor and the versions supported by the
pinned Electron major. Every release records the exact matrix it exercised.
Linux release qualification covers the latest Ubuntu LTS and Fedora Stable at
release time; compatible DEB- and RPM-based systems outside that matrix are
best effort. Remote Target architecture is independent of this desktop artifact
matrix and remains governed by the accepted Remote Bootstrap contract.

## Build And Packaging

The production workspaces use explicit Vite builds for Electron main, preload,
workspace renderer, and review renderer entries. Electron Forge packages those
prebuilt entries and uses its official DMG, ZIP, Squirrel.Windows, DEB, and RPM
makers. V1 does not couple the production build to Forge's experimental Vite
plugin and does not use a Forge publisher as a combined build-and-release step.

Platform and architecture are explicit build inputs. Artifacts are produced
from one protected commit, one root lockfile, and one application version on
the corresponding operating-system runners. Package, sign, verify, attest, and
publish remain separately observable stages. The Remote Bootstrap embedded in
the application is the digest-bound output from that same source and dependency
set, as required by the production-module decision.

## Update Contract

Published stable macOS and Windows releases use GitHub Releases through
`update.electronjs.org`, with feed identities partitioned by platform and
architecture. V1 has one automatic channel, `stable`. Release candidates are
signed GitHub pre-releases installed by testers and never opt ordinary users
into a beta or nightly stream. A custom update service, percentage rollout,
forced minimum version, and background update daemon are outside V1.

A main-owned `UpdateCoordinator` is the only caller of Electron's
`autoUpdater`. It checks after a startup delay, no more than once in 24 hours,
and when the user explicitly requests a check from About. Because Electron
downloads an available update as part of that flow, the coordinator exposes
download and verification state but never gives a renderer a feed URL or update
authority.

A downloaded update is installed only when the user chooses restart or on a
later normal application restart. The application never forces an active
session to quit. Immediate restart is unavailable while a mutation, protected
process, Trusted Review, or reconciliation transition would make shutdown
unsafe. Update failures leave the current binary usable and produce bounded,
redacted diagnostics.

Stable artifacts and version numbers are immutable. If a stable release is
bad, maintainers remove it from further stable distribution and issue a higher
patch version. V1 does not automatically downgrade an installed application or
overwrite an existing release, because an older binary might not safely own
state written by a newer one. Emergency manual downgrade instructions require
a separate human compatibility assessment.

## Signing And Integrity

The macOS application and all nested code use a Developer ID Application
identity, Hardened Runtime, minimal reviewed entitlements, and a secure
timestamp. The release flow notarizes the application, staples the ticket where
the artifact format permits, signs and notarizes the DMG, and verifies the
result with both `codesign` and Gatekeeper before release. The ZIP contains the
same signed and notarized application used to construct the DMG.

Windows signs every signable PE payload and the Squirrel installer with
Authenticode and verifies them with the Windows signing tools. Azure Artifact
Signing is the preferred authority when the organization and release region
are eligible. Otherwise, release is blocked until maintainers provision an OV
certificate backed by an appropriate hardware or managed signing service. The
signing provider is hidden behind the release workflow boundary; unsigned
public Windows Stable Releases are not a fallback. ADR 0013's Unsigned
Developer Preview is a separate pre-release classification and cannot be
promoted in place.

Every final platform artifact has a published SHA-256 checksum, an SPDX SBOM,
and a GitHub artifact attestation binding its bytes to the repository, workflow,
commit, and event. Attestation is supplementary to Apple and Microsoft platform
signatures and is the V1 provenance mechanism for standalone Linux packages.
V1 does not introduce a separate long-lived Linux package-signing key when it
does not operate a signed package repository. Release verification covers
platform signatures, checksums, and `gh attestation verify` against the
expected repository.

## CI Trust And Human Gates

Pull requests, forked code, ordinary continuous-integration builds, and
unsigned packaging jobs receive no signing or publication credentials. Release
tags must identify a protected commit. GitHub Actions and other reusable build
inputs are pinned to immutable revisions, jobs use least-privilege permissions,
and OIDC replaces stored cloud credentials where the selected provider supports
it.

An approval-protected `release-signing` environment grants credentials only to
minimal platform signing and notarization jobs. Those jobs consume identified
candidate artifacts; they do not rebuild, run tests, execute the packaged
application, or run package lifecycle hooks after credentials are available.
Their output is verified before final checksums, SBOM associations, and
attestations are recorded.

The verified bytes enter a draft GitHub Release. Humans install and launch
those exact artifacts across the recorded support matrix and exercise the
candidate update path. A separate approval-protected `production-release`
environment may then publish those same bytes without rebuilding them. A
post-publication stable-feed smoke check completes release verification; a
failure invokes the stop-distribution and forward-fix procedure.

Developer-account enrollment, certificate or managed-signing procurement,
acceptance of provider agreements, the final Windows signing backend, access to
each signing environment, stable publication, emergency stop-distribution, and
credential rotation or revocation are explicit human gates. CI may verify that
these prerequisites exist, but it cannot create, relax, or silently bypass
them.

## Consequences

The release pipeline has more platform-specific jobs and cannot promise one
installer or updater behavior everywhere. In return, each artifact follows its
native trust model, renderer code gains no update authority, signed candidates
can be inspected before publication, and the exact public bytes retain
verifiable source provenance. New stores, architectures, Linux repositories,
channels, or rollout controls require later decisions because each would add a
new trust or update authority rather than a packaging-only variation.

The implementation tickets must test artifact naming and architecture
partitioning, updater state and frequency, inactive-versus-active-operation
restart behavior, immutable version handling, signature verification, final
digest promotion, and the absence of credentials from untrusted jobs. The
official Electron, Apple, Microsoft, Electron Forge, and GitHub attestation
documentation remain the external constraints for those tests.
