# Electron Security and Distribution Constraints

Research receipt for [GitHub issue #10](https://github.com/oldwinter/skills-desktop/issues/10).

Checked 2026-08-20. This note answers the constraints question for the
definition phase of Skills Desktop. It uses Electron, Apple, Microsoft,
Ubuntu, DNF, AppImage, and updater-project documentation as primary sources.
It records facts and derived implementation constraints; it does not select a
V1 packager, installer, updater provider, Linux format, or release channel.

## Executive Summary

- Keep every renderer at Electron's secure boundary: `nodeIntegration: false`,
  `contextIsolation: true`, and renderer sandboxing enabled. These are the
  current `BrowserWindow` defaults for the first and third settings, and
  context isolation has been the default since Electron 12. Enabling Node
  integration disables the renderer sandbox. [Electron `BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window),
  [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation),
  [Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox/)
- Expose a small, purpose-built API from preload through `contextBridge`; do
  not expose the whole `ipcRenderer` or Electron API. Validate the sender frame
  and arguments in the main process before any privileged operation. [Electron
  Security](https://www.electronjs.org/docs/latest/tutorial/security),
  [`contextBridge`](https://www.electronjs.org/docs/latest/api/context-bridge)
- Electron's built-in `autoUpdater` supports macOS and Windows only. Linux must
  use a distribution package manager or a format-specific updater. [Electron
  `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/)
- A macOS direct-distribution release needs Developer ID signing and, for the
  current macOS notarization rules, notarization with the hardened runtime.
  Electron's macOS updater additionally refuses unsigned apps. [Apple,
  Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
  [Electron `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/)
- Windows update behavior follows the package type: Electron selects the MSIX
  updater for MSIX and Squirrel.Windows for traditional installers. Windows
  public distribution also has code-signing, publisher identity, and
  SmartScreen constraints. [Electron `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/),
  [Microsoft code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- A single cross-platform feed is not a safe abstraction. Electron's static
  update metadata and artifact contract differs by platform and must be
  partitioned by platform and architecture. [Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates)

## 1. Renderer, Preload, and IPC

### Electron defaults and required posture

Electron documents the following defaults and security relationships:

| Boundary | Official fact | Design constraint for Skills Desktop |
| --- | --- | --- |
| Node integration | `nodeIntegration` defaults to `false`. Electron warns never to load remote code with Node integration enabled. [Electron `BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window), [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) | Keep the renderer unable to import Node or Electron main-process APIs. Treat any remote or navigated frame as untrusted. |
| Context isolation | `contextIsolation` is enabled by default since Electron 12. It puts preload and Electron internals in a separate JavaScript context from the page. [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) | Do not disable it to make `window` globals convenient. The renderer-visible API must cross an explicit bridge. |
| Renderer sandbox | `BrowserWindow` renderer sandboxing defaults to `true` since Electron 20. A sandboxed renderer has no Node.js environment and must delegate privileged work to the main process over IPC. [Electron `BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window), [Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox/) | Keep the sandbox on for normal windows. Any exception requires a documented, narrowly scoped reason and security review. |
| Coupling | Setting `nodeIntegration: true` disables the renderer sandbox. Electron's security guidance also notes that disabling context isolation disables sandboxing for that renderer. [Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox/), [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) | Do not use Node integration as an IPC shortcut. It would change two security boundaries at once. |
| Preload privilege | A sandboxed preload has more privilege than its renderer and can still leak privileged APIs unless context isolation is enabled. [Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox/) | Keep preload code small and deterministic. It is an adapter, not a general-purpose application service. |

Electron's security checklist also recommends secure content only, a
restrictive Content Security Policy, no `webSecurity` or insecure-content
exceptions, limited navigation and new-window creation, current Electron
versions, and avoiding `file://` in favor of a custom protocol. These are
Electron recommendations rather than optional UI preferences. [Electron
Security checklist](https://www.electronjs.org/docs/latest/tutorial/security)

### Preload exposure

`contextBridge.exposeInMainWorld` accepts a limited object shape. Non-function
values are copied and frozen; functions are proxied between contexts. The
bridge therefore supports narrow capability methods, not a mutable shared
object. [Electron `contextBridge`](https://www.electronjs.org/docs/latest/api/context-bridge)

Electron explicitly warns that passing the entire `ipcRenderer` over the bridge
is a security footgun because it lets renderer code send arbitrary IPC. The
documented pattern is a wrapper method for each operation, and as of Electron
29 the full `ipcRenderer` object cannot be sent over `contextBridge` at all.
[Electron `contextBridge`](https://www.electronjs.org/docs/latest/api/context-bridge),
[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)

**Derived implementation constraint:** expose operations such as
`inventory.list`, `mutation.plan`, and `mutation.confirm` as separate typed
capabilities with fixed channel names and argument schemas. Do not expose
`send`, `invoke`, `on`, `webContents`, filesystem handles, child-process
handles, or an arbitrary command runner. This is a design consequence of
Electron's bridge and sender-validation guidance, not a choice of application
API names.

### Sender and payload validation

Electron says all web frames can, in some scenarios, send IPC to the main
process, including iframes and child windows. Its security guidance requires
validating the IPC event sender and shows checking `event.senderFrame` with a
URL parser and allowlist before returning secrets or performing privileged
work. [Electron Security, validate IPC senders](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages),
[Electron `webContents`](https://www.electronjs.org/docs/latest/api/web-contents)

**Derived implementation constraint:** every main-process IPC handler should
check all of the following before doing work:

1. The sender frame is the expected main frame and has the expected origin or
   custom-protocol URL.
2. The channel is one of the registered capabilities.
3. The structured payload satisfies a schema, including bounds on paths,
   target identifiers, operation names, and collection data.
4. The operation is authorized by current application state, not merely by the
   fact that the message arrived over IPC.

The first item is an Electron requirement. The remaining items are the normal
main-process validation needed when renderer input controls process, SSH, file,
or mutation boundaries; they are intentionally recorded as design implications
rather than claims that Electron supplies an authorization system.

### IPC serialization

Electron IPC uses the HTML Structured Clone Algorithm. Prototype chains are not
included; sending functions, promises, symbols, weak maps, or weak sets throws;
DOM objects and Electron objects backed by C++ such as `BrowserWindow` and
`WebContents` are not serializable to the main process. [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc#object-serialization),
[`ipcRenderer.invoke`](https://www.electronjs.org/docs/latest/api/ipc-renderer/)

**Derived implementation constraint:** IPC contracts must use plain structured
data: strings, numbers, booleans, arrays, records, and explicitly documented
error/result envelopes. Pass paths and identifiers, not live Electron objects,
Node streams, class instances, callbacks, or secrets. Validate after
deserialization at the main-process boundary.

**Repository constraint:** [CONTEXT.md](../../CONTEXT.md) separately requires
command plans to remain review metadata and forbids executing renderer-generated
shell text. The process adapter must receive structured argument arrays and
build any local or remote invocation from those values.

## 2. Packaging and Signing Facts

Electron's packaging tutorial describes OS-specific distributables such as DMG,
deb, and MSI. It also states that macOS signing happens at the app packaging
level, while Windows distributable installers are signed. The format list is an
artifact inventory, not a V1 recommendation. [Electron Packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)

### macOS

#### Direct distribution and notarization

Apple's current direct-distribution rules impose these requirements for a
notarized macOS app:

- Sign all distributed executables with valid code signatures.
- Use the appropriate Developer ID certificate. Apple distinguishes Developer
  ID Application for app/code items and Developer ID Installer for installer
  packages; development, ad hoc, and Mac App Distribution certificates are not
  substitutes for a direct-distribution notarization submission.
- Enable the Hardened Runtime capability.
- Include a secure timestamp.
- Do not ship `com.apple.security.get-task-allow` enabled in the release.
- Link against the macOS 10.9 or later SDK and provide valid XML, ASCII
  entitlements.

Apple states that, beginning with macOS 10.15, software built after June 1,
2019 and distributed with Developer ID must be notarized to run, while Mac App
Store distribution uses the store's equivalent checks. [Apple Notarizing macOS
software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
[Apple Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime),
[Apple distribution-signed code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)

The Hardened Runtime blocks classes of code injection and memory-tampering
behavior. Runtime exceptions are entitlements and should be added only when a
capability needs them. Apple only notarizes apps with Hardened Runtime enabled.
[Apple Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)

Electron's distribution guidance requires an Apple Developer Program
membership, Xcode on a macOS machine, and installed signing certificates for
the standard signing/notarization workflow. [Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)

#### macOS updater artifact and transport

Electron's built-in updater uses Squirrel.Mac. The app must be signed for
automatic updates, and App Transport Security applies to update requests. The
Electron update guide's static layout uses a ZIP per `darwin` architecture and
release metadata alongside it. [Electron `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/),
[Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates)

For a Squirrel.Mac feed, the server returns JSON when an update is available;
the required `url` points to a ZIP update, and the no-update response is
`204 No Content`. Squirrel.Mac compares the advertised version and installs
only ZIP updates. [Squirrel.Mac Server Support](https://github.com/Squirrel/Squirrel.Mac#server-support)

ATS requires HTTPS and additional TLS checks for URL Loading System requests.
`NSAllowsArbitraryLoads` can disable those protections, but Apple describes
that global exception as a significant security reduction and recommends
fixing the server or using a narrower exception. [Apple App Transport Security](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSAppTransportSecurity),
[Apple `NSAllowsArbitraryLoads`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowsarbitraryloads)

#### macOS CI credentials and build environment

Apple's scripted notarization workflow supports either an app-specific password
or an App Store Connect API key. The API-key form uses an issuer ID, key ID, and
private `.p8` key; the password form uses an Apple ID, team ID, and app-specific
password. Apple documents storing credentials in a keychain profile instead of
putting a password in a script. [Apple Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow),
[Apple notarization tool credentials](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)

The build pipeline therefore needs protected access to the Developer ID
signing identity and notarization credential, must keep private keys out of the
repository and logs, and must be able to reach Apple's notarization service.
Apple also documents a Notary API for upload/status work without a macOS
dependency, but that does not remove the need to produce a correctly signed
macOS app. [Apple Notary API](https://developer.apple.com/documentation/notaryapi),
[Apple Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

### Windows

#### Signing and distribution paths

Microsoft's current guidance distinguishes these paths:

| Path | Certificate and trust fact |
| --- | --- |
| Microsoft Store, MSIX | Microsoft re-signs the MSIX after certification; the publisher does not need to buy or manage an end-user code-signing certificate. [Microsoft code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) |
| Microsoft Store, MSI/EXE | The publisher must Authenticode-sign the installer and its PE files with a certificate chaining to a CA in Microsoft's Trusted Root Program; self-signed certificates are not accepted. [Microsoft MSI/EXE package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements) |
| Direct public distribution | Microsoft documents trusted code signing as the practical path. Unsigned or self-signed files can receive strong SmartScreen warnings or be blocked by enterprise policy. Smart App Control can block unsigned executables. [Microsoft code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) |

Microsoft's current comparison lists Azure Artifact Signing as its recommended
non-Store service, traditional OV certificates as an alternative, and says EV
certificates no longer provide an instant SmartScreen bypass. This is a
current Microsoft distribution fact, not a request to choose a certificate
vendor or service in V1. [Microsoft code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)

#### Windows updater artifact and package identity

Electron chooses the updater from the package format:

- An MSIX app uses the MSIX updater and accepts a direct MSIX link or a JSON
  update feed.
- A traditional installer created for Squirrel.Windows uses Squirrel.Windows.
  Squirrel launch events must be handled, and the first-run file lock can make
  immediate update checks fail for a few seconds.

[Electron `autoUpdater` platform notices](https://www.electronjs.org/docs/latest/api/auto-updater/)

For Squirrel.Windows, Electron's documented static layout contains versioned
`.exe` and `.nupkg` artifacts plus a `RELEASES` file under a platform and
architecture directory. The `RELEASES` entry carries the package hash,
filename, and size; a custom server must serve the expected `RELEASES` response.
[Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates),
[Squirrel.Windows update process](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/update-process.md)

For MSIX, Windows updates stay within the same package family, which is based
on package name and publisher. The new package normally must have a higher
version. Electron's `allowAnyVersion` option defaults to `false`; Windows has
explicit override mechanisms for lower-version packages. [Microsoft MSIX app
updates](https://learn.microsoft.com/en-us/windows/msix/app-package-updates),
[Electron `autoUpdater.setFeedURL`](https://www.electronjs.org/docs/latest/api/auto-updater/#autoupdatersetfeedurloptions)

#### Windows CI credentials

Microsoft's CI guidance says never to store signing certificates or passwords
in source control. It recommends pipeline secret variables for passwords and
secure-file storage for certificate files, with the temporary certificate
removed after packaging. [Microsoft CI for Windows apps](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/ci-for-winui3)

The exact credential mechanism depends on the chosen distribution path:
Microsoft-re-signed Store MSIX, a CA-backed Authenticode certificate, and a
cloud signing service have different identities and custody requirements. The
release design must keep signing in a protected build boundary and must not
place PFX files, private keys, or signing passwords in the repository,
artifacts, crash reports, or update metadata.

### Linux

#### Built-in updater limitation

Electron explicitly supports `autoUpdater` only on macOS and Windows. There is
no built-in Linux auto-updater; Electron recommends the distribution package
manager instead. [Electron `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/)

Electron's packaging documentation and official Forge maker documentation show
that Linux can be shipped in several formats, including deb, RPM, Snap,
Flatpak, and ZIP bundles. AppImage has its own update and packaging contract.
These formats have different installation, confinement, repository, signing,
and update models; there is no Electron-wide Linux artifact contract. [Electron
Distribution Overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview),
[Electron Forge Makers](https://www.electronforge.io/config/makers),
[AppImage update documentation](https://docs.appimage.org/packaging-guide/optional/updates.html)

#### Distribution-specific update and signing facts

| Linux path | Official constraint |
| --- | --- |
| Debian/Ubuntu APT | APT authenticates repository `Release` metadata. Current APT refuses unsigned repositories by default; it does not perform per-package signature review, so trusting an archive means trusting its maintainer. [Ubuntu `apt-secure`](https://manpages.ubuntu.com/manpages/jammy/man8/apt-secure.8.html) |
| Third-party APT repository | Ubuntu recommends repository GPG signing, a securely distributed key, and `Signed-By` scoping. It warns that third-party repositories can conflict with OS upgrades and that the publisher has broad system access. [Ubuntu third-party repository guidance](https://ubuntu.com/server/docs/explanation/software/third-party-repository-usage/) |
| RPM/DNF | DNF exposes separate `gpgcheck` for package signatures and `repo_gpgcheck` for repository metadata, along with GPG key configuration. Generic defaults and distribution policy can differ, so an RPM repository must document and test its signing policy. [DNF configuration reference](https://dnf.readthedocs.io/en/stable/conf_ref.html) |
| AppImage | Update information is embedded in the AppImage. The standard AppImage update flow can use an external updater and a generated `.zsync` file; it is independent of Electron's built-in `autoUpdater`. [AppImage update documentation](https://docs.appimage.org/packaging-guide/optional/updates.html) |
| Snap | Electron's Snapcraft guide describes snaps as packages that include required dependencies and auto-update across major Linux distributions, subject to Snapcraft's packaging and store model. [Electron Snapcraft guide](https://www.electronjs.org/docs/latest/tutorial/snapcraft) |

**Derived implementation constraint:** Linux support must model a package family
and its update authority explicitly. A deb repository, an RPM repository, an
AppImage endpoint, and a Snap publication are not interchangeable feeds, and a
Linux client should not promise the same automatic update behavior as macOS or
Windows without selecting and documenting one of those ecosystems.

## 3. Updater Contracts, Providers, Channels, and Rollback

### Provider support matrix

| Provider or mechanism | Supported behavior and constraints |
| --- | --- |
| Electron built-in `autoUpdater` | Main-process API. Only macOS and Windows are supported; update availability causes an automatic download; a downloaded update is applied on next launch, with `quitAndInstall()` available after `update-downloaded`. Calling `checkForUpdates()` twice downloads twice. [Electron `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/) |
| Static object storage | Electron documents static storage with platform-specific metadata and artifacts partitioned by `process.platform` and `process.arch`. macOS uses ZIP plus JSON metadata; Windows uses Squirrel artifacts plus `RELEASES`. [Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates) |
| `update.electronjs.org` | The Electron-maintained service requires macOS or Windows, a public GitHub repository, releases published to GitHub Releases, and code-signed builds for macOS. It is not a Linux or private-repository solution under those documented criteria. [Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates#using-updateelectronjsorg) |
| Custom Squirrel-compatible server | Electron documents custom servers for private releases, authentication, percentage rollouts, and separate release channels. The server must emit the response shape expected by the platform's Squirrel client. [Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates#using-other-update-services) |
| Distribution package manager | Recommended direction for Linux's built-in support boundary. Repository trust, package metadata, signing, and update cadence are owned by the selected Linux ecosystem. [Electron `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/), [Ubuntu `apt-secure`](https://manpages.ubuntu.com/manpages/jammy/man8/apt-secure.8.html), [DNF configuration reference](https://dnf.readthedocs.io/en/stable/conf_ref.html) |

Electron's `setFeedURL` API has platform-specific options: `headers` and
`serverType` are documented for macOS, while `allowAnyVersion` is documented
for Windows MSIX. Do not assume that an authenticated feed, JSON shape, or
downgrade policy transfers between platforms. [Electron
`autoUpdater.setFeedURL`](https://www.electronjs.org/docs/latest/api/auto-updater/#autoupdatersetfeedurloptions)

### Channels and staged rollout

Electron does not define a single cross-platform channel protocol. Its update
guide describes channel and percentage rollout behavior as responsibilities of
a custom Squirrel-compatible update server. [Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates#using-other-update-services)

Squirrel.Mac says the server can decide which version to return based on the
request, including phased rollouts and server-driven rollback. This means the
channel or cohort policy lives on the server, not in the app binary alone.
[Squirrel.Mac](https://github.com/Squirrel/Squirrel.Mac#server-support)

Squirrel.Windows documents staged rollout percentages by editing `RELEASES`.
To withdraw a failed release, remove it from `RELEASES` and publish a new
higher version; republishing the same broken version would leave already
updated users on it. [Squirrel.Windows staged rollouts](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/staged-rollouts.md)

### Rollback limits

- Squirrel.Windows has no built-in rollback support. [Squirrel.Windows update
  process](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/update-process.md)
- MSIX normally rejects a lower-version update. Electron exposes
  `allowAnyVersion` for MSIX and defaults it to `false`; Windows also documents
  explicit force-update overrides. [Electron `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/),
  [Microsoft MSIX app updates](https://learn.microsoft.com/en-us/windows/msix/app-package-updates)
- The Microsoft Store can temporarily stop new acquisitions from receiving a
  problematic package by submitting an older package, but existing installs
  require a new package with a higher version. [Microsoft MSIX package
  requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- A successfully downloaded Electron update is applied on next start; the
  built-in API does not promise an application-level health check or automatic
  rollback after launch. This last sentence is a scope boundary inferred from
  the documented API, so V1 must define health-check and recovery behavior if
  it needs it. [Electron `autoUpdater`](https://www.electronjs.org/docs/latest/api/auto-updater/)

## 4. CI, Release, and Credential Boundaries

The following are operational constraints derived from the cited platform
requirements, not a selected CI vendor or release service:

| Secret or authority | Must be protected because | Boundary implication |
| --- | --- | --- |
| macOS Developer ID signing identity and private key | Apple requires valid Developer ID signatures and a secure timestamp for direct notarized distribution. [Apple Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) | Sign only in a protected release job; keep key material out of source, logs, and published artifacts. |
| Apple notarization credential | `notarytool` accepts an app-specific password or App Store Connect API key and private `.p8` key. [Apple Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) | Use a keychain profile or CI secret store. Never embed credentials in app code or update feeds. |
| Windows certificate/private key or cloud signing identity | Microsoft requires trusted signing for public distribution and explicitly says not to store certificates or passwords in source control. [Microsoft CI for Windows apps](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/ci-for-winui3) | Use secure files, secret variables, or the selected cloud-signing identity; remove temporary key files after signing. |
| Linux repository signing key | APT and DNF rely on repository/archive trust metadata and configured GPG keys. [Ubuntu `apt-secure`](https://manpages.ubuntu.com/manpages/jammy/man8/apt-secure.8.html), [DNF configuration reference](https://dnf.readthedocs.io/en/stable/conf_ref.html) | Keep private archive keys in the release system; publish only the intended public key/fingerprint and rotate deliberately. |
| Update publication authority | Static feeds, GitHub Releases, Squirrel metadata, and package repositories determine which artifact a client receives. [Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates) | Separate build, signing, metadata generation, and publication permissions; require review before changing a channel or withdrawing a release. |

Apple's custom notarization workflow also requires outbound access to Apple's
notary service and its transfer/ticket endpoints. A restricted CI network must
allow those endpoints or use the documented Notary API path. [Apple Customizing
the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow),
[Apple Notary API](https://developer.apple.com/documentation/notaryapi)

## 5. Facts Versus Future Decisions

The following are not decided by this research:

- Whether the renderer serves packaged local content through a custom protocol
  or another local origin, and the exact navigation/new-window allowlist.
- The typed preload capability surface, IPC channel names, payload schemas,
  sender-origin policy, error envelope, and mutation confirmation flow.
- Whether any renderer needs a sandbox exception, which Electron version is
  supported, and which Electron fuses are safe to change.
- macOS distribution path: Mac App Store, direct Developer ID distribution, or
  both; artifact architecture policy; notarization and entitlement policy.
- Windows distribution path: Store MSIX, direct MSIX, Squirrel.Windows, or
  another installer; package identity; certificate custody; and SmartScreen
  rollout expectations.
- Linux package family or families, repository ownership, signing-key rotation,
  architecture matrix, and whether a format-specific updater is in scope.
- Update hosting/provider, authentication, metadata signing, release channels,
  staged rollout policy, user consent, minimum-version policy, and rollback or
  recovery behavior.
- CI operating systems, build isolation, signing/notarization secret custody,
  release publication permissions, and artifact retention.

These decisions should be recorded in ADRs before production implementation
depends on them. The non-negotiable baseline from this note is the secure
renderer/IPC boundary, a signed macOS path with notarization for direct
distribution, a trusted Windows distribution path, and explicit Linux
package/update authority.
