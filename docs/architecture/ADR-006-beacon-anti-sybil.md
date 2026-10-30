# ADR-006: Beacon abuse controls and anti-Sybil approach

Status: Accepted for public launch with the controls below (PRD BCN-006). Sybil resistance remains a known limit.
Date: 2026-10-27; updated 2026-10-30

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

## Public-launch controls (added 2026-10-30)

- **Edge proxy and per-network limits:** the app talks to
  `https://intoponet.com/registry`, a Vercel Function (`website/api/registry.js`). Vercel sets
  `x-real-ip` from the connection and overwrites client-supplied values. The proxy forwards
  only public routes (never `/v1/admin`), caps bodies at 16 KiB and adds a shared edge
  secret plus the client address. When `BEACON_EDGE_SECRET` is configured, the Neon
  Function refuses publishes and reports without a valid edge secret (403). The native
  Neon URL therefore serves reads only, and per-network limits always apply to writes.
- **New-key probation:** device keys are recorded with their first-seen time
  (`beacon_keys`). For their first 3 days they may publish 3 beacons a day instead of 10.
- **Network limits:** 30 publishes and 60 reports per network per day (daily-salted hash).
- **Global ceiling:** at most 1,000 publishes a day across all publishers
  (`BEACON_GLOBAL_PUBLISH_PER_DAY` overrides). Beyond it the registry answers 503.
- **Pause switch:** `BEACON_PUBLISH_PAUSED=1` stops new publishes while withdrawals,
  reports and reads continue.
- **Moderation audit:** every automatic hide and moderator restore/remove is written to
  `beacon_moderation_log` with a reason (moderator decisions require one).
  `GET /v1/admin/log` shows it to moderators.
- **Transparency:** `GET /v1/transparency` publishes monthly counts of reports by kind and
  moderation actions by type, plus the current limits and retention periods. It
  publishes no URLs, keys or report text.
- **Retention:** a daily Neon Function Trigger calls `purge()` (see `RETENTION_DAYS`):
  usage counters 30 days, withdrawn beacons 30 days, reports on resolved items 180 days,
  idle keys 180 days, moderation log 2 years.
- **Policy and appeals:** see [Beacon moderation policy](../beacon-moderation-policy.md).

## Remaining limits

- **Sybil resistance:** one person can still make many keys across many networks.
  Probation, network limits and the global ceiling bound the damage and its speed, and
  prominence still saturates per region; they do not prove uniqueness. Candidates remain:
  - Privacy Pass or RFC 9578-style blind tokens issued after a cheap human check;
  - device attestation (App Attest), which costs some privacy;
  - stake-free reputation, where a key's weight rises only after its beacons survive
    review.
- **Single moderator token:** the audit log records actor type, not which moderator.
- **Legal review:** retention periods are an operator choice and have not had legal review.

## Consequences

Beacons can ship publicly while the public field treats them as a separate, capped input
(§10). Volume abuse is bounded and auditable; uniqueness is not proven, so the anti-Sybil
choice must be revisited as usage grows.
