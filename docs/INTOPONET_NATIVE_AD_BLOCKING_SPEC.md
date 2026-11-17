# Intoponet — Native Ad & Tracker Blocking

**Cursor implementation specification**  
Version 0.1 · 2026-10-23  
Companion to `INTOPONET_PRD.md` and `INTOPONET_EARTH_FREQUENCY_SPEC.md`.

## Objective

Build default-on, native browser-level ad and tracking protection. No extension requirement, paid allowlisting, advertising replacement, remote analysis of browsing activity, or telemetry. Blocking must work for real webpages opened in Intoponet's Chromium-backed floating/side/bottom-sheet windows. Preserve the immersive frequency field and liquid-glass interface.

### Non-goals

Do not promise 100% ad removal, circumvent paywalls, automatically consent to cookies, bypass website access controls, or build a new filter language. Anti-fingerprinting is a separate privacy workstream.

## Requirements

| ID | Priority | Requirement |
|---|---|---|
| AB-01 | P0 | Block known advertising and tracking requests before downloading resources when interception supports it. |
| AB-02 | P0 | Apply domain-scoped cosmetic rules to hide ad containers without removing legitimate content. |
| AB-03 | P0 | Enable protection by default in regular and private profiles. |
| AB-04 | P0 | Provide a per-site on/off switch and reload to apply changes. |
| AB-05 | P0 | Show a restrained shield control with aggregate blocked ads/trackers for the current page. |
| AB-06 | P0 | Maintain locally cached, verified filter lists with atomic update and rollback. |
| AB-07 | P0 | Ensure websites cannot access or change browser protection settings. |
| AB-08 | P0 | No URL-level browsing logs or filter telemetry leave the device. |
| AB-09 | P1 | Global category toggles, optional consent-banner cosmetics, and site-breakage reporting. |
| AB-10 | P2 | Audited advanced custom filtering rules and diagnostic export. |

## Recommended foundations

- **Primary evaluation:** [Brave adblock-rust](https://github.com/brave/adblock-rust), for Adblock-compatible network and cosmetic rules. Verify exact release APIs, licence, and distribution obligations before integration.
- **Reference:** [uBlock Origin](https://github.com/gorhill/uBlock), for semantics and test cases; do not copy implementation without licence review.
- **Filter lists:** [EasyList and EasyPrivacy](https://easylist.to/). Review current licences and attribution requirements before bundling. Maintain a pinned last-known-good version.
- **Chosen (2026-11-17):** the matcher is [Ghostery's adblocker library](https://github.com/ghostery/adblocker) (`@ghostery/adblocker`, MPL-2.0), behind `LocalProtectionEngine`: it is plain JavaScript, runs in Electron's main process without a native module to build, sign and unpack per architecture (which adblock-rust's Node binding needs), and loads a list compiled at build time in about 10 ms. The lists are EasyList and EasyPrivacy, shipped unmodified as data files under CC BY-SA 3.0 with a recorded source, date and checksum (`packages/protection-engine/lists/manifest.json`, `scripts/update-protection-lists.mjs`). The licence review is in `THIRD_PARTY_NOTICES.md` §4. Rules apply to other sites' requests only; a site's own requests are never blocked.
- **Browser shell:** CEF or Electron with Chromium. Keep engine-specific request interception behind a common interface. Do not fork Chromium for this feature alone.

## Architecture

```text
Trusted Intoponet UI: shield, site settings, privacy controls
             │ validated IPC
             ▼
Local protection service
  ├─ filter-rule engine (compiled local rules)
  ├─ site exception resolver
  ├─ update manager + integrity checks
  └─ in-memory per-tab aggregate counters
             │
     ┌───────┴─────────┐
     ▼                 ▼
Network request hook  Frame-scoped cosmetic CSS
     │                 │
     └────────┬────────┘
              ▼
Sandboxed Chromium website contents
```

Never expose privileged IPC or Node APIs to websites. Laya, local knowledge graphs, personal history, and public Beacons are separate trust boundaries; blocked-request logs must not feed them.

### Engine-neutral contract

```ts
type ResourceType =
  | 'document' | 'sub_frame' | 'script' | 'stylesheet' | 'image'
  | 'font' | 'media' | 'xhr' | 'fetch' | 'websocket' | 'other';

interface RequestContext {
  requestUrl: string;
  topLevelUrl: string | null;
  initiatorOrigin: string | null;
  resourceType: ResourceType;
  profileId: string;
  isPrivate: boolean;
}

interface BlockingDecision {
  action: 'allow' | 'block';
  category?: 'ad' | 'tracker' | 'other';
  ruleId?: string;
}

interface ProtectionAdapter {
  evaluate(ctx: RequestContext): BlockingDecision;
  cosmeticRules(documentUrl: string, topLevelUrl: string): {
    hideSelectors: string[];
    cssRules: string[];
  };
  setSiteEnabled(origin: string, profileId: string, enabled: boolean): void;
}
```

The hot path should be synchronous or otherwise compatible with the chosen engine's interception contract. Avoid expensive parsing and network access during request evaluation. Cache decisions with correct first-party context and ruleset version.

## Chromium integration

**CEF:** Evaluate `CefRequestHandler` and `CefResourceRequestHandler` callbacks for resource interception. Verify thread ownership and cancellation semantics against the pinned CEF version. Use safe frame-scoped CSS injection for cosmetics; keep untrusted renderer code isolated from native application services.

**Electron:** Evaluate session `webRequest.onBeforeRequest` for network filtering and secure, isolated frame-level CSS injection. Ensure only one owner composes `webRequest` handlers for each session; avoid accidentally replacing another listener. Preserve `contextIsolation`, sandboxing, and disabled Node integration for arbitrary websites.

Test service workers, iframes, redirects, WebSockets, prefetch, and navigation separately: interception coverage varies. Document unsupported cases rather than claiming blanket protection.

## Filtering lifecycle

1. Identify the website's top-level origin and resource request context.
2. Apply site exceptions; security safeguards unrelated to ads remain enforced.
3. Evaluate compiled local rules, including first-party/third-party and exception precedence.
4. Block or allow the resource before download where supported.
5. Increment only ephemeral, per-page aggregate category counters.
6. Inject narrowly scoped cosmetic selectors into eligible frames.
7. On navigation or SPA updates, refresh cosmetic rules safely without repeated heavy DOM scanning.

Avoid hiding text or functional controls. Never execute remotely supplied filter scriptlets in the MVP. Cosmetic rules must not affect trusted Intoponet controls or the frequency-field renderer.

## Filter-list updates

- Ship a tested baseline ruleset with the application.
- Fetch updates from documented sources with no personal URLs, account identifiers, or browsing-derived query parameters.
- Validate source, size, syntax, integrity/authenticated manifest, and licence provenance.
- Compile in a restricted worker/process, swap atomically, and retain the last working ruleset.
- Apply strict limits to regex complexity and memory consumption; treat lists as untrusted data.
- Remain fully functional offline with the cached ruleset.
- Keep update failures silent unless user action is required; never disable protection just because an update fails.

## UX: premium, unobtrusive protection

Place a subtle shield icon in the glass chrome of each website window. Clicking it opens a compact liquid-glass panel containing:

- **Protection on this site:** On/Off; toggling reloads the page.
- **Blocked on this page:** approximate counts by advertising and tracking category.
- **Site not working?** Pause protection for this site, then retry.
- **Protection settings:** global ads, trackers, and cosmetic-filter controls.

No celebration animations, invasive popups, gamification, or attention metrics. Use restrained 180–300 ms transitions; support reduced motion, keyboard navigation, and screen readers. The planetary visualization remains unaffected by shield UI.

## Privacy and storage

- Keep rules, exceptions, and settings in the local browser profile; encrypt sensitive local profile data where supported.
- Private mode uses isolated, ephemeral state. No private-site history or counts persist after the session.
- Never send raw URLs, page contents, per-site exceptions, or blocked-request logs to Intoponet servers.
- Website scripts cannot enumerate settings or toggle filtering.
- Filter updates may contact public update servers, but transmit no user-specific browsing data.
- Do not confuse cosmetic removal of cookie banners with rejection of consent; do not auto-accept tracking.

## Security review

Threats: malicious filter updates, pathological regex, renderer-to-browser privilege escalation, cross-profile leakage, bypasses through redirects/service workers, cosmetic selector breakage, and compromised update infrastructure. Require parser fuzzing, strict IPC validation, authenticated update provenance, sandboxed execution, and rollback. Do not introduce arbitrary remote JavaScript injection.

## Performance targets (provisional)

| Metric | Target |
|---|---|
| Warm request decision | p95 under 2 ms excluding Chromium scheduling |
| Filtering memory overhead | Under 100 MB for baseline lists on a reference desktop |
| Site toggle feedback | Under 100 ms before reload |
| Rule update | Background, atomic, no visible UI freeze |
| Frequency-field FPS | No sustained measurable degradation due to filtering |

Profile on actual midrange hardware; revise thresholds from benchmarks, never by weakening security.

## Test matrix

**Unit:** rule precedence, domain matching, request types, exceptions, cache invalidation, malformed rules, and update rollback.

**Integration:** first/third-party requests, scripts/images/media, nested frames, SPA navigation, redirects, service workers, WebSockets, multiple website panels, separate profiles, and private sessions.

**Compatibility:** login, checkout, banking, streaming, documentation, news, consent dialogs, accessibility, and embedded media. Maintain a known-breakage registry.

**Security/privacy:** attempt to toggle blocking from hostile page JS; verify no cross-profile leakage; simulate compromised list updates; inspect outbound traffic for URL/history leakage.

**Visual:** ad slots collapse where safe, original content remains usable, and glass windows animate smoothly over the frequency field.

## Definition of done

- [ ] A representative ad and tracker request is blocked before download in the chosen Chromium shell.
- [ ] Cosmetic filtering hides known ad containers without damaging main content.
- [ ] Protection is on by default, including in private sessions.
- [ ] Shield counts and per-site pause/reload work in multiple independent website windows.
- [ ] Verified ruleset updates, offline fallback, and rollback pass automated tests.
- [ ] Untrusted pages cannot access privileged settings or other profiles.
- [ ] No personal browsing data is transmitted by the blocking subsystem.
- [ ] Performance and compatibility results are documented.
- [x] Dependencies and filter-list licences/attribution are reviewed (`THIRD_PARTY_NOTICES.md` §1 and §4, 2026-11-17; not yet seen by a lawyer).

## Implementation sequence for Cursor

**Phase 0 — Inspect and decide:** Read the main PRD and Earth spec, inspect existing code, identify the current shell, evaluate CEF/Electron interception APIs, and record any architectural gaps.

**Phase 1 — Vertical slice:** Integrate a local filter engine, block one fixture request, and expose a counter through validated browser IPC.

**Phase 2 — Native protection:** Add baseline lists, site exceptions, profile isolation, and per-tab counters.

**Phase 3 — Cosmetics and glass UI:** Add frame-scoped selectors and the premium shield panel with site toggle/reload.

**Phase 4 — Hardening:** Verified list updates, rollback, private-mode tests, security probes, performance benchmarks, and compatibility fixes.

**Phase 5 — Optional:** Consent-banner cosmetics, advanced rules, and local diagnostic exports after review.

### Cursor execution directive

Implement the smallest tested vertical slice first. Do not install a third-party extension as a substitute for native blocking. Do not fork Chromium, introduce cloud AI/analytics, or add commercial allowlisting. Preserve the existing browser's process isolation, visual quality, and local-only privacy guarantees. At completion report files changed, tests, benchmarks, licensing, known limitations, and next actions.

## Primary references

- https://github.com/brave/adblock-rust
- https://github.com/gorhill/uBlock
- https://easylist.to/
- https://www.electronjs.org/docs/latest/api/web-request
- https://www.electronjs.org/docs/latest/tutorial/security
- https://github.com/chromiumembedded/cef
