# What to do when a vulnerability is being exploited, or a serious incident happens

This is a working note for whoever maintains Intoponet. It is not legal advice. It was written
on 18 November 2026 from the text of the EU Cyber Resilience Act (Regulation (EU) 2024/2847) and
the Commission's guidance as read that month; check the dates and the platform address before
relying on them.

## Does the Act apply to Intoponet?

Not settled. Intoponet is free, takes no payment or advertising, and since 18 November 2026 its
source is open under the Mozilla Public License 2.0. The Act covers products "made available on
the market in the course of a commercial activity", and treats free and open-source software that
is not monetised differently. Whether Intoponet is outside it has not been confirmed by a lawyer.
Until it is, this note treats the reporting duty as if it applied, because doing so costs little.

A browser is an "important product" (Class I) under the Act. Two dates matter: reporting duties
have applied since 11 September 2026, and the rest of the Act applies from 11 December 2027.

## What has to be reported

1. **A vulnerability in Intoponet that is being actively exploited.** That means evidence that
   someone has used it against people running Intoponet, not merely that a flaw exists.
2. **A severe incident** affecting the security of Intoponet: for example the update feed, the
   signing key or the release storage being compromised.

A vulnerability in Chromium or Electron that is being exploited elsewhere is not, on the
Commission's guidance, something Intoponet must report unless it has been exploited in Intoponet.
It still has to be fixed quickly: ship the Electron update, and write the date down.

## The clock

| When | What |
|---|---|
| Within 24 hours of becoming aware | An early warning |
| Within 72 hours | A fuller notification: what is affected, how serious, what is being done |
| Within 14 days of a fix being available (vulnerability), or one month after the 72-hour notice (incident) | A final report |

Reports go through ENISA's single reporting platform. A maker with no establishment in the EU
reports to the national team (CSIRT) of the member state where most of its users are; decide
which that is from the website's country counts and write the decision and the date here:

- Member state chosen: _not yet decided_
- Evidence and date: _not yet recorded_
- Platform account created (needs an EU Login with two-step sign-in): _not yet_

## The steps, in order

1. Write down the time you became aware and what you know. Keep every message.
2. Decide whether it is one of the two reportable things above. If unsure, treat it as one.
3. Send the early warning within 24 hours. It can be short.
4. Fix it. Ship the release. Updates install themselves; say so in the release note.
5. Tell users: a short advisory in the repository's security advisories and in What's new.
6. Send the 72-hour notification, then the final report.
7. If the flaw is in a component (Chromium, Electron, a library), tell its maintainers unless
   they already know, and share the fix.

## Records to keep

- A log of each Chromium and Electron security release and the date Intoponet shipped it.
- Each release's SBOM, inventory and checksums (already published per release).
- Every report received at the security contact, and what was done about it.

## Who to ask

The security contact is in `SECURITY.md`. For the legal questions (is Intoponet in scope, and
which member state), a technology law clinic or a lawyer who knows product regulation.
