# ADR-006: Beacon abuse controls and anti-Sybil approach

Status: Accepted for a private beta; open for public launch (PRD BCN-006).
Date: 2026-10-27

## Context

Beacons are public recommendations (PRD §4.6). Their prominence must resist brigading
(BCN-003, §11) without identifying people, and the registry must not become a record of
anyone's browsing. Anonymous uniqueness — proving that two keys aren't the same person —
is an open research problem. The PRD requires privacy-preserving abuse controls before
public launch.

## Decision (interim)

- **Storage:** Neon Postgres behind a small registry service (`services/beacon-registry`).
  The desktop app never holds database credentials. It talks only to the registry's HTTP
  API, and only through the main-process beacon publisher after a consent screen.
- **Identity:** each device makes an Ed25519 key, sealed by the OS keychain. Requests are
  signed, time-boxed (±5 minutes) and nonce-checked. The key is never published or tied to
  an account. It exists so the same device can withdraw its beacons and be rate-limited.
- **Minimal payload:** URL (canonical, tracking parameters removed), title, topic, an
  optional public note, and an optional place rounded to 0.1°. Unknown fields are rejected.
  Sign-in, account, payment and local-network addresses are refused.
- **Prominence:** the sum over 2° regions of min(4, log2(1 + independent keys)). Volume
  from one region saturates quickly, and breadth counts more than repetition. Public
  counts are bucketed ("a few", "several", "dozens", "many").
- **Limits:**
  - 10 publishes per key per day, and 30 per network per day.
  - The network is stored only as a SHA-256 of the address with a salt that changes daily
    (HMAC of a server secret and the date).
  - 20 reports per key per day.
  - One live beacon per key per page.
- **Reports and contests (BCN-004):** spam, harmful, misleading, broken and contest.
  Contests need a reason and are shown publicly next to the beacon. Three independent
  non-contest reports hide a resource until a moderator restores or removes it
  (`/v1/admin`, bearer token).
- **Withdrawal (BCN-005):** signed by the same key. The consent screen warns that copies
  made by mirrors may persist.
- **Federation (§14):** `/v1/export` serves the public aggregates, so independent nodes can
  mirror without a gatekeeper.

## Known gaps (must close before public launch)

- **Hosting:** the registry runs as a Neon Function (project `intoponet-beacons`,
  Atlas Atlantic org, aws-us-east-1). On Functions, `X-Forwarded-For` is not a
  trustworthy client address, so the Function enforces no per-network limit. Only the
  per-key, per-page and report limits apply. Put an edge proxy (for example a
  Cloudflare Worker with a rate limiter) in front, and add the network limit there,
  before public launch.

- **Sybil resistance:** one person can make many keys. Network limits slow this but do not
  stop it, especially across VPNs. Candidates:
  - Privacy Pass or RFC 9578-style blind tokens issued after a cheap human check;
  - device attestation (App Attest), which costs some privacy;
  - stake-free reputation, where a key's weight rises only after its beacons survive
    review.
- **Moderation:** policy, appeal flow, moderator audit log and transparency reporting.
- **Legal review:** retention of reports and moderation records.

## Consequences

Beacons can be tested with real users while the public field treats them as a separate,
capped input (§10). The anti-Sybil choice must be revisited before public launch.
