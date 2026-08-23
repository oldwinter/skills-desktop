# Security Policy

## Supported scope

Skills Desktop **V1 is Local-only**. Inventory, Snapshot restore, and mutation flows against a local skills CLI are in scope. SSH Target, remote-bootstrap, and cross-machine reconciliation are **out of V1** and should not be treated as a supported security surface for this release line.

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories:

https://github.com/oldwinter/skills-desktop/security/advisories/new

Do **not** open a public issue for undisclosed vulnerabilities.

## Response aim

We aim to **acknowledge** reports within **7 days**. Fix timelines depend on severity and whether the issue affects the Local-only V1 surface.

## Out of scope for V1 reports (for now)

- Signing / code-signing key material and release attestation (not a V1 public commitment)
- Experimental SSH / remote transport paths that are explicitly out of V1 product scope
