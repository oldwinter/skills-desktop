# Install an unsigned Skills Desktop developer preview

Unsigned Developer Previews are early-access builds for informed testers. They
are not signed or notarized, do not establish a trusted publisher, and may be
blocked by your operating system or organization policy. Do not continue unless
you trust this repository and have verified the exact downloaded bytes.

## Verify before installing

Download the artifact for your platform together with `SHA256SUMS`. Confirm the
artifact's SHA-256 value matches its line in that file.

With GitHub CLI installed, also verify the build provenance. Replace
`<artifact>`, `<source-commit>`, and `<source-ref>` with the values from the
release notes:

```bash
gh attestation verify "<artifact>" \
  --repo oldwinter/skills-desktop \
  --signer-workflow oldwinter/skills-desktop/.github/workflows/release-candidates.yml \
  --source-digest "<source-commit>" \
  --source-ref "<source-ref>" \
  --deny-self-hosted-runners
```

Stop if checksum or attestation verification fails. Local signing changes the
artifact or application digest, so complete this verification first and retain
the original download for comparison.

## macOS

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

1. Download the `win32-x64-setup.exe` artifact and verify it before execution.
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

After verification, install the DEB or RPM with the normal package tool for your
distribution. The preview has checksum and GitHub provenance evidence but no
project-operated Linux package-signing key or repository.

## Updating

Unsigned Developer Previews are GitHub pre-releases and are not served through
the application's stable automatic-update channel. Download, verify, and
install each newer preview manually. Signed Stable Releases remain a separate
future distribution path.
