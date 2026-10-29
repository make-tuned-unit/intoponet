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

- Historical enrichment now follows exact earlier-edition links on the root article, with a service-level regression test and cache invalidation. The 80-topic audit has not been rerun; the previous 47 limited histories remain unresolved evidence.
- Repeated renderer crashes pause automatic recovery until an explicit retry or navigation. Four policy tests pass; actual Electron renderer/GPU crash integration still needs verification.
- The macOS pipeline bundles workspace runtime dependencies, builds an unsigned arm64 preview DMG, checks archive integrity and packaged resources, and gates public release on credentials and signing/notarization verification. Signed release execution and installer launch testing remain outstanding.
- Repository-wide typechecking and 546 tests passed. Five registry tests were skipped. The production build passed during packaging.

No release readiness or public-download claim is made. Next priorities are packaged-browser smoke testing, rerunning historical-depth coverage, and the remaining privacy/accessibility and release gates above.
