# Native request-protection edge verification

Run from the repository root:

```sh
node experiments/protection-native/run-probe.mjs
```

The runner bundles the native Electron probe, launches Electron with a new
temporary user-data directory, and removes that directory on exit. The probe
binds a local HTTP server to loopback on a dynamic port and maps only fixture
`.test` hostnames to loopback. The unresolved redirect target is deliberately
not mapped. No public website or user profile is used.

## Verified behavior

On 2026-10-29, Electron 45.0.0 / Chromium 156.0.8078.48 passed the following
probe:

- Two `WebContentsView`s kept separate contexts: a paused origin loaded both
  fixture scripts, while the protected origin canceled both before the server
  received them.
- A top-level redirect from `redirect.intoponet.test` to the protected
  `site-b.intoponet.test` committed the final origin as the page context and
  blocked its ad/tracker scripts.
- A subsequent redirect to an unmapped local fixture hostname failed with
  `ERR_NAME_NOT_RESOLVED`. The failed pending context was discarded and the
  prior committed site-B context and counters were restored.
- A service-worker fetch arrived at Electron's request hook without a
  `webContentsId`, with `initiatorOrigin` set to the local page origin. The
  helper used that origin for site-pause/first-party scope and blocked the
  tracker fixture before delivery. No per-tab counter was assigned.
- A main-process `session.fetch` also arrived without a `webContentsId` or
  initiator. The helper applied the destination host rule and blocked the ad
  fixture before delivery; no page counter was assigned.

The native runner output is summarized in
[`experiments/protection-native/evidence.json`](../experiments/protection-native/evidence.json).

## Bounded claims

For requests with a matching tab ID, the helper applies the current page's
pending-or-committed URL, per-site pause, and per-tab category counters. When
Electron omits the ID but provides an HTTP(S) initiator, the helper uses the
issuing origin for first-party and site-pause checks. If both tab ID and
initiator are unavailable, only the known destination-host rules can be
applied. Unattributed blocks do not increment any page's counter.

This evidence covers the probed redirect, DNS failure, service-worker fetch,
and main-process session request in Electron 45. It does not establish that all
service-worker, redirect, subframe, WebSocket, DNS, TLS, or Chromium-internal
requests are intercepted. At the time of this probe the packaged rule set was a
small fixture set; since 2026-11-17 the app ships EasyList and EasyPrivacy (see
`THIRD_PARTY_NOTICES.md` §4 and `packages/protection-engine/src/lists.ts`), applied
to other sites' requests only. This work makes no malware or phishing-protection
claim.
The probe uses a hidden window, so it is not UI or accessibility evidence.
