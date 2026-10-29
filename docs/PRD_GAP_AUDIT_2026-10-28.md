# PRD implementation audit — 28 October 2026

The product is a working browser prototype, not a general-public release. The website is a direction preview; its first public installer is planned as a macOS DMG. No installer is currently published.

## Launch priorities

| Priority | PRD requirement | Evidence and remaining work |
| --- | --- | --- |
| P0 | Public distribution, WEB-009; §§6.3, 11, 14 | RELEASE remains planned in `docs/EXECUTION_DAG.json`. DMG signing/notarization and a disabled-until-configured manual macOS updater foundation now exist; public signing, a live update endpoint, end-to-end update verification, update/rollback policy, Chromium CVE ownership, emergency releases and independent security evidence remain open. See ADR-007 and `docs/automatic-updates.md`. |
| P0 | Licensing and governance, §14 | `LICENSE` is proprietary/confidential and packages are UNLICENSED. The open-source ambition needs an explicit owner decision and license/notice review. Do not market the current code as open source. |
| P0 before public Beacons | BCN-006 | ADR-006 permits private beta only. `services/beacon-registry/src/function.ts` has no trusted client IP, so network limits cannot operate there. Add trusted edge limits, decide anti-Sybil controls, and define moderation, appeals, audit and retention policies. Consent, signatures, withdrawal and reports already exist. |
| P1 | Shared public reality, FRQ-008 | Deterministic aggregation exists, but RSS and public-field caches are per device with local time and failure recovery. Define a shared snapshot identity/time/input contract and verify cross-device agreement. This is not evidence of personalization. |
| P1 | Browser compatibility, WEB-001/009 | ADR-001 engine choice remains provisional. Existing compositor comparisons ran at 30 Hz, not proof of the 60 fps goal. Complete IME, VoiceOver, battery, packaging and browser-behavior evidence; make explicit passkey, DRM, extension and password/autofill support decisions. |
| P1 | Privacy assurance, LAY-001/005; §11 | Local inference and outbound API stubs exist. Verify egress at the network level and evaluate stronger isolation; local processing is not an independent security certification. Private partitions, encrypted library and origin permissions are already implemented. |
| P1 | Accessibility, §12; MEM-010 | PRD targets WCAG 2.2 AA; current feature report describes 2.1 AA and marks coverage assumed. Complete VoiceOver, scaling, contrast, RTL/localization and native webview focus checks. |
| P1 | Historical context, OLD-001/003/005 | Latest audit covers 80 cached threads; 47 remain flagged as limited. Successful topic matching is distinct from sufficient historical breadth or independent corroboration. See `feature-verification/timeline-context-2026-10-28.json`. |
| Later | Federation, §14 / Phase 5 | Configurable registry hosting and aggregate export exist. Export is capped at 100 results without pagination or a synchronization protocol. Define node interoperability, history mirroring, withdrawal propagation and governance before claiming a federated network. |
| Separate future work | Community connectivity, §13 | Begin with permissioned, isolated local pilots and measured results. The browser does not yet provide a community-owned transport network. |

## Already implemented, with limits

- RSS feeds already contribute to Rising/Fading: 451 local feeds plus 31 international feeds, 20-minute refresh, rolling 24-hour comparisons. Describe coverage momentum, not instantaneous global opinion.
- The browser includes real Chromium pages, public geographic exploration, private bookmarks/collections, local Laya and sourced Olds timelines.
- Explicit public Beacons are implemented for private beta. Ordinary visits and private notes are not automatic public contributions.
- The last app verification passed 540 tests with five registry tests skipped. Skipped registry coverage does not establish production database or abuse-control safety.

## Documentation drift

README's Phase 0 inventory and blanket permission/popup denial are obsolete. The threat model still describes missing Beacon/Laya components that now exist. ADR-007's implementation inventory and NEWS_SOCIAL_FEEDS admission notes also require reconciliation. Preserve unresolved release gates while updating implementation descriptions.

## Website direction

`website/` is a static Vercel placeholder using a real prototype screenshot, clearly distinguished from live data. It separates current capabilities, public-release work and longer-term ambitions. Download stays unavailable until an approved signed/notarized DMG exists. No waitlist, analytics or invented download URL is included.

## Follow-up — 29 October

See [the execution plan](PRD_EXECUTION_PLAN.md) for current evidence. An unsigned macOS DMG pipeline and packaged renderer-crash verification now exist. The manual native updater has no configured feed or live signed-update evidence; automatic checks, rollback policy, independent review and licensing remain open. Snapshot IDs are now content-addressed with deterministic ordering, but globally shared ingestion/delivery is not implemented. The five registry database tests passed on isolated local PostgreSQL. Historical enrichment was audited again: 47 of 80 threads still have limited depth. Laya runtime canaries reveal that the current JavaScript guards can be bypassed by previously captured native function references; a proper OS boundary remains unresolved.

The next integration checkpoint passed 647 tests with no skips. Optional desktop shared-snapshot consumption, manual native update plumbing and persisted best-effort backup exclusion are implemented and locally verified; none closes the broader public delivery, signed-update or restore gates. See `PRD_EXECUTION_PLAN.md` and `feature-verification/integration-2026-10-29.json`.
