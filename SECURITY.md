# Security

## Reporting a vulnerability

Email **support@atlasatlantic.co** with "Intoponet security" in the subject.
Please do not open a public issue for a vulnerability.

Say what you found, which version of Intoponet (Settings shows it), and how to
reproduce it. If the problem is in Chromium or Electron and not in Intoponet's
own code, say so if you know; it is still worth telling us, because Intoponet
ships them.

What to expect:

- an acknowledgement within 3 working days;
- an assessment, and a plan if it is confirmed, within 10 working days;
- a fix in a release, with credit to you in the release notes unless you would
  rather not be named.

Intoponet is maintained by one person, so these are honest targets, not a
contract. Please give us a reasonable time to ship a fix before publishing
details.

What the maintainer does when a flaw is being exploited is written down in
`docs/security/reporting-runbook.md`.

## Supported versions

Only the latest release is supported. Intoponet checks for updates once a day
and installs them when you are ready; security fixes are released as ordinary
updates.

## What ships

Every release has a software bill of materials (CycloneDX), a file inventory
and SHA-256 checksums at `https://intoponet.com/releases/<version>/`. Releases
are signed with a Developer ID and notarized by Apple.
