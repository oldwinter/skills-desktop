# Handoff to skills.sh through the system browser

Status: Accepted

## Context

skills.sh can receive publication data, but embedded browsing, automated login,
submission, callback capture, or a generic URL opener would give the renderer
new network and account authority. Opening a page also does not prove that a
Pack was created or updated.

## Decision

The skills.sh integration ends at a bounded, reviewed publication-data
projection and one main-generated allowlisted HTTPS URL. The user must
explicitly request the handoff. Main validates the exact host, path, query
shape, scheme, length, and session authority, then invokes the system browser.
The renderer supplies neither a URL nor browser state.

There is no embedded browser, webview, page automation, login, API submission,
scrape, callback, cookie access, or direct write. Skills Desktop receives and
stores no returned Pack URL and displays only that the page was opened in the
browser. It never says that publication, creation, or update succeeded.

A skills.sh Pack URL later supplied as a source is independent input. It must
pass `SourceDescriptorV1` validation and pinned CLI Source Inspection like any
other source; it is not evidence about the earlier browser handoff.

## Alternatives considered

- Embed the skills.sh website. Rejected because it would bring remote content
  and account state into the application trust boundary.
- Submit through a private API. Rejected because it adds external write,
  credential, and protocol authority.
- Accept a renderer-provided URL. Rejected because that becomes a generic
  browser-opening capability.

## Consequences

The only automated outcome is an allowlisted operating-system browser launch.
Acceptance uses a recorder adapter and performs no external write. Public text
must distinguish "opened" from "published."

## Relationship to earlier decisions

This record extends ADRs 0009 and 0010. Browser handoff remains a narrow
main-owned capability and does not weaken renderer isolation or introduce a
network interface.
