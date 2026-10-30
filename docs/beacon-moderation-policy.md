# Beacon moderation policy

Beacons are public recommendations that people choose to publish from Intoponet. This
policy says what is removed, how decisions are made, how to appeal, and what is kept.
The technical controls are described in
[ADR-006](architecture/ADR-006-beacon-anti-sybil.md).

## What a Beacon contains

A web address (with tracking parameters removed), its title, a topic, an optional short
public note and an optional place rounded to about 10 km. Beacons are never tied to an
account. Each device signs its Beacons with an anonymous key that is never published.

## What is removed

- Content that is illegal where the registry operates, including child sexual abuse
  material, which is also reported to the relevant authority.
- Personal information about private individuals (doxxing), harassment or threats.
- Malware, phishing, or pages that collect sign-in or payment details deceptively.
- Spam: bulk, automated or commercial promotion, or coordinated attempts to inflate a
  page's prominence.

Disagreement is not grounds for removal. People can **contest** a Beacon with a short
reason, which is shown publicly next to it.

## How decisions are made

1. Anyone can report a Beacon as spam, harmful, misleading or broken.
2. Three independent reports hide the page from the public field until a moderator
   reviews it. This automatic step is logged.
3. A moderator restores or removes it and must record a reason. Every decision is
   logged.
4. Restored pages are not hidden again by further automatic reports; a moderator can
   still remove them.

Publishing limits slow abuse: 3 Beacons a day for a new device's first 3 days, then 10;
30 a day from one network; and a ceiling across the whole registry. Operators can pause
new publishing in an emergency without affecting withdrawals, reports or reading.

## Appeals

If your Beacon was removed and you think that was wrong, email
**support@atlasatlantic.co** with the page address and why it should be restored. A different
moderator from the original decision reviews it where possible. The outcome is logged
like any other decision.

## Withdrawal

You can withdraw your own Beacon at any time from the app. Mirrors that copied public
aggregates before you withdrew may keep their copies.

## Transparency

`/registry/v1/transparency` publishes monthly counts of reports by kind and moderation
actions by type, with the current limits and retention periods. It never includes
addresses, keys or report text.

## Retention

| Record | Kept for |
| --- | --- |
| Daily rate-limit counters (network addresses only as a daily-salted hash) | 30 days |
| Withdrawn Beacons | 30 days after withdrawal |
| Reports on resolved pages (contests stay with their Beacon) | 180 days |
| Device keys with no Beacons | 180 days after last use |
| Moderation log | 2 years |

These periods are an operator decision and have not had legal review.
