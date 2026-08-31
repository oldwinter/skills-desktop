# Install an unsigned Skills Desktop developer preview

Unsigned Developer Previews are early-access builds for informed testers. They
are not signed or notarized, do not establish a trusted publisher, and may be
blocked by your operating system or organization policy. Do not continue unless
you trust this repository and have verified the exact downloaded bytes.

## Verify before installing

Download the artifact for your platform together with `SHA256SUMS`. Confirm the
artifact's SHA-256 value matches its line in that file.

With GitHub CLI installed, also verify the build provenance. Copy `--source-ref`
from the release notes **Source ref** field (not from the GitHub tag name).
Replace `<artifact>` with the downloaded filename and `<source-commit>` with
the notes' **Source commit** value:

```bash
gh attestation verify "<artifact>" \
  --repo oldwinter/skills-desktop \
  --signer-workflow oldwinter/skills-desktop/.github/workflows/release-candidates.yml \
  --source-digest "<source-commit>" \
  --source-ref "<source-ref>" \
  --deny-self-hosted-runners
```

Worked example for the current public preview
(`preview-v0.1.0-34ff7b72b63773bfde8b37e6eb01ec44bdb2583f`). That preview was
built by `workflow_dispatch` on `main`, so **Source ref** is `refs/heads/main`,
not `refs/tags/preview-v…`. Use the matching platform artifact (Windows shown):

```bash
gh attestation verify "skills-desktop-0.1.0-win32-x64-setup.exe" \
  --repo oldwinter/skills-desktop \
  --signer-workflow oldwinter/skills-desktop/.github/workflows/release-candidates.yml \
  --source-digest "34ff7b72b63773bfde8b37e6eb01ec44bdb2583f" \
  --source-ref "refs/heads/main" \
  --deny-self-hosted-runners
```

Stop if checksum or attestation verification fails. Local signing changes the
artifact or application digest, so complete this verification first and retain
the original download for comparison.

## macOS

Electron 44 requires macOS 13 Ventura or newer.

1. Download the DMG matching `arm64` for Apple silicon or `x64` for an Intel Mac.
2. Verify it as described above, open the DMG, and copy Skills Desktop into
   `/Applications`.
3. Apply an ad-hoc signature to that local application copy:

   ```bash
   codesign --force --deep --sign - "/Applications/Skills Desktop.app"
   codesign --verify --deep --strict --verbose=2 "/Applications/Skills Desktop.app"
   ```

4. Try to open Skills Desktop. If Gatekeeper blocks it, open **System Settings →
   Privacy & Security** and use Apple's per-application **Open Anyway** control.

An ad-hoc signature seals the local copy but carries no Developer ID identity
and is not Apple notarization. This process deliberately does not remove the
quarantine attribute or disable Gatekeeper globally.

## Windows

1. Download the `skills-desktop-0.1.0-win32-x64-setup.exe` artifact and verify it before execution.
2. Start the installer. Windows will show an unverified-publisher/SmartScreen
   warning. Continue only if Windows offers its own per-file override and you
   accept the risk.
3. If device policy blocks the file without an override, stop and ask the device
   administrator. Do not weaken organization policy or install an unverified
   self-signed certificate into Trusted Root.

Users who already operate their own trusted development or enterprise signing
identity may sign their local copy, but that is outside the Skills Desktop trust
contract. A public self-signed certificate is not trusted by Windows by default.

## Linux

The preview has checksum and GitHub provenance evidence but no project-operated
Linux package-signing key or repository. Verify SHA-256 from `SHA256SUMS` before
any install step.

### Debian / Ubuntu (DEB)

Do not install with bare `sudo dpkg -i` on a machine that has none of the trash
helpers listed below. Configuration fails and the package stays unconfigured.

1. Download the `.deb` together with `SHA256SUMS`. Confirm the artifact's
   SHA-256 matches its line in that file. Stop if they differ:

   ```bash
   sha256sum -c SHA256SUMS --ignore-missing
   ```

2. Install the local file with `apt` so Depends are resolved. The `./` prefix
   is required so apt treats it as a local package:

   ```bash
   sudo apt install ./skills-desktop-*.deb
   ```

   A versioned filename is equivalent, for example:

   ```bash
   sudo apt install ./skills-desktop-0.1.0-linux-x64.deb
   ```

3. The DEB `Depends` on **one** trash helper (any one is enough):

   - `kde-cli-tools`
   - `kde-runtime`
   - `trash-cli`
   - `libglib2.0-bin`
   - `gvfs-bin`

   `apt install` of the local DEB selects one automatically (often
   `libglib2.0-bin`).

If `dpkg -i` already failed, do **not** run bare `sudo apt-get install -f`
while apt's package lists are stale. That command can **remove** the
unconfigured `skills-desktop` package instead of installing a helper.

Safer recovery after a half-install:

```bash
sudo apt update
sudo apt install ./skills-desktop-*.deb
```

Or install any one helper from the list above, then finish configuration:

```bash
sudo apt update
sudo apt install libglib2.0-bin
sudo dpkg --configure -a
```

Only consider `apt-get install -f` after `apt update`, and only if you
understand it may still uninstall the preview when no helper can be
installed.

### RPM

After the same SHA-256 check against `SHA256SUMS`, install the RPM with the
normal package tool for your distribution.

## Updating

Unsigned Developer Previews are GitHub pre-releases and are not served through
the application's stable automatic-update channel. Download, verify, and
install each newer preview manually. Signed Stable Releases remain a separate
future distribution path.

`RELEASES` and `*.nupkg` may appear in Windows preview assets as Electron
Forge/Squirrel packaging artifacts; they are not the live stable auto-update
feed. Download the installer and `SHA256SUMS`.
