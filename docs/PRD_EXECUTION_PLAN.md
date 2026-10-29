# PRD completion plan — 29 October 2026

The owner requested cheaper implementation workers with central planning and verification. Work is staged; this plan does not mark unverified PRD requirements complete.

## Wave 1: bounded implementation

1. Historical depth: inspect the 47 limited histories, fix a systematic source-backed enrichment gap, and add regression evidence. No unrelated historical padding.
2. Browser hardening: reconcile policy documentation with actual permissions/popups, address a concrete crash/security gap, and test failure paths.
3. macOS distribution: implement a reproducible DMG path, distinguish unsigned internal preview from signed public distribution, and make public release fail closed when signing/notarization evidence is absent.

Each task is assigned to a GPT-6 Luna worker in separate file areas. The coordinating agent reviews diffs and evidence before committing. Workers must not publish installers or change licensing.

## Verification gates

- Review each patch against its stated requirement and existing privacy boundaries.
- Run focused regression checks followed by integrated typechecking, tests and build after edits settle.
- Inspect the packaged application and installer where tooling permits; record signing/notarization status explicitly.
- Preserve the distinction between passing headline matches and sufficient historical context.
- Keep website downloads unavailable until the public distribution gate passes.

## Subsequent waves

- Packet-level Laya privacy/offline verification; shared snapshot consistency across devices.
- Accessibility, browser compatibility, performance and engine decision evidence.
- Public Beacon abuse/moderation and governance gates, then federation.
- Owner decisions: licensing and release credentials; independent audits where required.
- Windows/mobile and community connectivity remain later workstreams.

## Status

Wave 1 implemented and centrally reviewed:

- Historical enrichment now follows exact earlier-edition links on the root article, with a service-level regression test and cache invalidation. The 80-topic audit was rerun in Wave 2: 13 threads gained older sourced passages, but the same 47 remain flagged as limited.
- Repeated renderer crashes pause automatic recovery until an explicit retry or navigation. Four policy tests pass. Wave 2 verified actual packaged renderer crashes; GPU crash behavior remains unverified.
- The macOS pipeline bundles workspace runtime dependencies, builds an unsigned arm64 preview DMG, checks archive integrity and packaged resources, and gates public release on credentials and signing/notarization verification. Wave 2 verified packaged app startup and renderer recovery. Signed release execution remains outstanding. The final Wave 4 check mounted the DMG read-only, copied its app to a temporary directory, and passed startup/crash recovery there.
- Repository-wide typechecking and 546 tests passed. Five registry tests were skipped. The production build passed during packaging.

No release readiness or public-download claim is made. Next priorities are packaged-browser smoke testing, rerunning historical-depth coverage, and the remaining privacy/accessibility and release gates above.

## Wave 2: verification and reproducibility

- History worker: rerun all 80 saved topics with current source retrieval; address systematic remaining depth gaps with service regressions and attribution.
- Browser worker: isolated-profile packaged UI startup and real renderer crash/retry journeys.
- Privacy worker: executable Laya egress canaries, offline behavior, and accurate isolation boundaries.
- Planner: review these results, run the registry integration suite against an isolated temporary PostgreSQL instance, and reconcile the release queue.
- Next available workers: content-addressed public snapshot identity and deterministic replay, then WCAG 2.2 automated checks and remaining browser/security evidence.

The five previously skipped registry tests passed against a temporary local PostgreSQL instance on 29 October; see `feature-verification/beacon-postgres-2026-10-29.json`. This verifies the database-backed scenarios in that suite, not production edge limits or moderation readiness.

Owner input requested for release licensing and availability of Apple signing credentials. Public release, independent audits, and hardware-dependent acceptance stay open until their actual evidence exists.

### Wave 2 reviewed evidence

- Parent independently reproduced packaged shell startup, first-crash recovery, second-crash pause and explicit retry (`feature-verification/browser-crash-2026-10-29.json`).
- Public snapshot identity now hashes normalized content and evaluation time, with stable duplicate/scoring order and aggregation version v3. Parent reran all 90 field-snapshot tests successfully. This does not yet distribute a single shared artifact to all clients.
- History v18 audited all 80 saved threads with no fetch failures. Thirteen gained older sourced passages; 47 still fail the depth-screening heuristic. Broad topic selection and lack of editorial source coverage remain limitations.
- Laya runtime canaries demonstrate blocked JavaScript API calls and real local inference, but also reproduce a captured-function-reference bypass. JS guards are not an OS network capability boundary; strict isolation remains a public-release gate.
- Production and full dependency `npm audit` returned zero known npm advisories on 29 October. This is not an independent security assessment or comprehensive Chromium CVE review.

### Wave 3 in progress

- WCAG 2.2 automated shell checks with explicit screen-state assertions, followed by fixes for observed violations.
- Native protection edge cases: redirects, failed navigation, service workers and requests without tab identifiers.
- Registry HTTP boundary hardening: reject untrusted forwarded client addresses and limit request bodies in bytes while streaming.

### Wave 3 reviewed evidence

- Parent reran the eight-screen WCAG 2.2-tagged axe and keyboard scenario: zero reported violations, required screen states and focus-return checks passed. Full conformance, VoiceOver and localization are not established.
- Parent reran the native protection probe: redirects, failed-navigation context rollback, service-worker initiators and unattributed requests passed. The failed-navigation rollback defect is fixed; rule coverage remains a small fixture set.
- Registry HTTP tests passed 9/9, covering direct-peer addressing and byte-limited JSON boundaries. The production Neon deployment still has no trusted edge network identity and was not changed.
- Release packaging now generates a CycloneDX inventory including Electron/Chromium metadata and final-artifact SHA-256 sums. A disabled-until-configured manual native macOS update path, signed app ZIP, and optional Squirrel.Mac feed manifest are implemented with focused tests. No endpoint is configured and no live signed update has been verified; background checks, rollback policy, and release ownership remain open.

### Wave 4 in progress

- A read-only immutable public snapshot artifact service and local publishing tool, with atomic manifests and cross-client agreement tests. No public endpoint is being configured yet.
- A sandboxed-renderer Laya experiment to test a stronger boundary than Node worker monkey-patching; no production migration or isolation approval without verified evidence.
- Targeted review of broad-place historical matches that cannot establish the subject-specific background of a headline.

### Integration checkpoint — 29 October

All workspace typechecks passed. The integrated suite passed **592 tests with zero skips**, including all 14 Beacon registry tests against an isolated temporary PostgreSQL instance and all eight shared-snapshot service tests. The four release-inventory tests also passed (**596 total**); detailed output is in `feature-verification/integration-2026-10-29.json`. The production desktop build and unsigned DMG packaging passed.

The model handoff now verifies SHA-256 and length on the exact vocabulary/model buffers before use, closing the verification/read gap. The real pinned model passed a direct pool/worker run without writing model files.

The sandbox experiment established a concrete remaining failure: a sandboxed renderer blocked ordinary HTTP/WebSocket probes but WebRTC still connected to a local TURN TCP canary. Its verification command intentionally returns exit status 2. It is not wired into production; strict no-egress isolation remains open.

The shared snapshot service passed real CLI and concurrent-process publication checks. It remains local/self-hostable infrastructure: scheduled shared ingestion, desktop adoption, reviewed public hosting, signed provenance and federation synchronization are not complete.

The 80-topic depth audit remains a stage-only v18 measurement (47 limited); v19 adds honest geographic-fallback labels and a regression preventing event descriptions mentioning cities/islands from being mistaken for places. No new coverage improvement is claimed.

### Private-store recovery follow-through

The remaining ready private-store audit found and fixed key/index recovery hazards. Missing encryption keys with retained records, missing indexes with retained documents, and malformed authenticated indexes now fail closed without overwriting retained data. SafeStorage key rotation is atomic, and eager key failures remain visible to Knowledge without becoming unhandled startup rejections. Explicit saves from private tabs remain available; automatic footprints remain separate. Deletion feedback now acknowledges possible partial completion. ADR-004 records the remaining signed-app Keychain/restore and backup-policy gates; PRIVATE_STORE remains active, not verified.

Laya pool shutdown also invalidates asynchronous startup, preventing workers from starting after an intervening close; explicit later use and idle reopen remain supported.

### Final integrated validation

After the private-store and pool lifecycle fixes, all workspace typechecks passed and the suite passed **602 tests with zero skips**. The four release-inventory tests also passed, for **606 total**. This supersedes the earlier 596-test checkpoint. The final production build and branded unsigned arm64 DMG passed archive/content checks and generated a CycloneDX SBOM, artifact inventory and SHA-256 sums. Public release remains gated; no installer or shared snapshot endpoint has been published.

The final installer smoke mounted the DMG read-only, copied its app to a temporary directory, verified its bundled icon, and passed real startup/renderer crash/retry checks. DMG/SBOM/inventory checksums all matched. The volume was detached and temporary data removed; see `feature-verification/macos-installer-2026-10-29.json`.

### Shared delivery, updates and backup follow-through — 29 October

The desktop can now use an explicitly configured shared HTTPS snapshot origin. It verifies exact bytes, canonical identity, public-only content and published evaluation time, uses a separate origin-bound atomic cache, and never silently recomputes local data on shared-source failure. Stale data, cache failures and clock discrepancies remain visible. Publisher/client future-time bounds agree. RSS/news remains a separate per-device service; this is not global shared news ingestion or endpoint approval.

Manual native macOS updates are implemented behind a release-build feed setting. Preview packaging clears that setting before compilation. A check downloads an available update; the UI explains that it applies on restart or the next launch. Final app ZIPs, optional Squirrel.Mac manifests and SHA-256 inventory are generated locally. Signed live updates, automatic scheduling, recovery and production hosting are not verified.

Time Machine exclusions now persist the user’s intent and reapply to named private stores at startup or creation. Operations serialize against user changes, watcher errors do not crash the host, and cleanup cancels queued work. Effective exclusion stays separate from requested intent; missing paths or failed verification remain unknown. No administrator privileges or real Time Machine settings were used in verification; restore and signed-app Keychain drills remain open.

All workspace typechecks and **647 tests** passed with zero skips: 641 workspace/gold tests, including registry tests on isolated PostgreSQL, plus six release-inventory tests. Eight-screen axe/keyboard checks again reported zero violations. This supersedes the earlier 606-test checkpoint. See the integration and installer evidence records for exact commands and artifact hashes. The threat model now reflects current public sources, shared cache, RSS, Beacon and Laya boundaries without treating JavaScript guards as OS isolation.

### Cache, permission and OS-boundary follow-through — 29 October

Local public snapshots now use bounded UTF-8 reads and atomic mode-0600 replacement. Failed writes preserve the previous cache and disclose the error; cached data older than two hours is marked stale and reads retain previous source-failure disclosures.

Permission decisions awaiting macOS no longer survive reset, a newer overlapping Block, navigation, renderer failure, tab/popup closure or private-session exit. Exit invalidates requests before asynchronous cleanup. Any frame changing documents conservatively cancels the owner's pending requests; frame-specific tracking remains a compatibility improvement. The parent reviewed the race tests and reran the native Electron fixture for fake-camera Allow/reset/Block, pending navigation/destruction and self-signed TLS denial. Real OS media grants and the complete certificate matrix remain unverified.

An isolated, ad-hoc signed XPC prototype now demonstrates the supported App Sandbox direction: the same service reaches loopback TCP/UDP with the network-client entitlement and receives EPERM without it, while the host controls and typed reply still succeed. Parent evidence is in `feature-verification/laya-xpc-2026-10-29.json`. This is not production Laya, real model inference, a native Electron bridge, or release signing. macOS refused removal of generated test-container metadata; the exact IDs are recorded. Production strict no-egress remains open.

All workspace typechecks and **665 tests** passed with zero skips (659 workspace/gold and six release-inventory tests), including an isolated PostgreSQL run. The rebuilt preview DMG/ZIP passed package checks. This supersedes the 647-test checkpoint. No installer, public endpoint or production inference helper was published.

## Requirements still open

- Strict Laya no-egress capability boundary (the sandbox prototype has a demonstrated WebRTC TCP escape path and is not production-integrated).
- Public shared ingestion, app adoption of a reviewed snapshot endpoint, source-rights approval and freshness/coverage operations; the new artifact service alone does not close this gate.
- Historical breadth/editorial interpretation: the last stage audit still flags 47/80 threads; geographic fallback is now explicit.
- Signed/notarized release, live update verification, automatic check policy, rollback validation, CVE ownership, license choice, and independent security review. Owner input on licensing, Apple signing setup, and a trusted update endpoint remains requested.
- Full native accessibility/VoiceOver, localization/RTL, 60/120 Hz hardware evidence and final engine decision. Automated axe/keyboard results do not substitute for these.
- Signed-app Keychain continuity, restore drill and remaining backup/retention policy in ADR-004.
- Trusted edge Beacon abuse controls, moderation/appeals/retention, federation synchronization and withdrawal propagation.
- Later PRD platform and community-connectivity phases remain separate research/deployment workstreams.
