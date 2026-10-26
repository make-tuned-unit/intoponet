# Execution runbook

The [machine-readable DAG](./EXECUTION_DAG.json) is the current queue. The
earlier [delivery DAG](./DELIVERY_DAG.md) explains the original phase breakdown;
this queue adds the missing release, provenance, Laya, and verification work.
The [field plan](./FIELD_PLAN.md) records the field semantics and required RSS/news/social ingestion path.
The [living topography specification](<INTOPONET_LIVING_FREQUENCY_TOPOGRAPHY_SPEC (1).md>)
v1.1 is mapped to nodes through `specRefs`; its visual and global coverage
requirements are required acceptance criteria, not implemented features.
Run `npm run dag -- status`, `npm run dag -- ready`, or
`npm run dag -- show NODE_ID`. `npm run dag -- check` rejects duplicate IDs,
missing dependencies, cycles, invalid states, and verified nodes without
evidence.

## How to run a wave

1. The planner selects ready nodes whose files and runtime do not conflict.
   A worker receives one node, the relevant PRD/spec sections, allowed files,
   acceptance check, and instruction to report exact evidence. Use low-cost
   workers for bounded code, test, docs, and benchmark-harness tasks. The
   planner handles ADRs, product policy, source licences, security judgments,
   and final gate reviews.
2. Mark assigned nodes `active`. Workers may implement and test, but do not
   mark their own node `verified`. The planner reviews the diff, runs the
   relevant tests, reproduces native/security claims when needed, and records
   the evidence path or command outcome before changing the status.
3. If acceptance is partial, keep the node active or split it into smaller
   dependencies. An external blocker stays `blocked` with the exact missing
   condition. A verified node may unlock successors only after the evidence is
   independently checked.
4. Re-run `npm run dag -- check` and the repository quality checks at each
   integration point. A passing unit suite does not close native browser,
   accessibility, performance, privacy, or public-release gates.

## Current wave and critical path

The crash recovery on 2026-10-24 found the uncommitted implementation intact.
The planner assigned three bounded tasks to cheaper workers: `FIELD_DYNAMICS`,
`FIELD_TILES`, and `PLACE_HIERARCHY`. Workers implement and test; the planner
reviews corrections and records evidence before changing gate status.

The indexed place runtime now has bounded lookup, paginated child traversal,
version reconciliation and safe pointer publication. Full-size runtime evidence
and desktop navigation remain outstanding. Texture work includes coherent LODs,
separate clocks and provenance-preserving transitions; visual acceptance remains
open. Publication dynamics now has reviewed deduplication, corroboration, caps and
coverage-aware comparison, with replay regressions. Live coverage-window
evidence and hierarchy rollup/count conservation remain outstanding. The JSON
contains the current verification details.

At this integration point the planner reran all 186 workspace tests, all
typechecks, the production build and diff checks successfully. Chrome lab
readback matched CPU texture samples at Earth and city scales, and a snapshot
transition advanced with the decorative phase frozen. This is not native-host
performance or visual acceptance. The three parent nodes remain active because
their complete acceptance criteria have not yet passed.

Latest workspace validation on 2026-10-25 passed all **194 tests across six
workspaces**, typecheck in all **seven workspaces**, and the production build.
The native synthetic topic-origin preview shows Bolivia at 50% (3 visits, 3×
baseline), Italy at 33% (2 visits, 2×), and unknown at 17% (1 visit); the real
personal field has no origin-country provider and reports no country breakdown.
Topic assignment remains manual. Visual/material acceptance and the 60 FPS target
remain open.

On 2026-10-26 the membrane renderer was revised: the relief is spec-bounded,
contours are per pixel with LOD, the atmosphere was added, and data-tied
motion layers were added. The workspace now passes **222 tests**, typecheck
and the production build. Evidence is recorded in the
[design review](./FREQUENCY_DESIGN_REVIEW.md#living-contour-revision-checkpoint--2026-10-26).
Visual acceptance and the 60 FPS target remain open.

Also on 2026-10-26, the browser shell gained two features:

- **A search bar in the full-screen dock.** It stays open while you type and
  opens with ⌘L.
- **A right-side Bookmarks pane** with accordion groups backed by
  Collections (MEM-004). Groups can be created, renamed, deleted and
  reordered by drag. A current-page save card is included, and ⇧⌘B and ⌘D
  are forwarded even from a focused page.

The page view glides aside as the pane opens: its bounds are streamed from
a CSS transition. The dock's page edge uses a 240 ms ease-out tween that
the dock animation matches. Reduced motion and reduced transparency are
honoured. Real-window evidence is in `experiments/shell-ui-qa/evidence`.
Hands-on VoiceOver review and keyboard drag alternatives remain open.

Next: review field visibility and the ten synthetic scenes; verify the full-size
place index and connect bounded lookup to navigation; connect trusted window
coverage to dynamics and prove count-preserving geography rollups before tiles.

The previously verified public-ingestion pilot retrieved 50 Hinckley metadata
items. No new desktop startup feed is enabled. Remaining sources require their
own evidence-based use decisions. Use `npm run dag -- ready` for the current
dependency-derived queue.

The living-field path is:

```text
INTEREST_CONTRACT → FIELD_GEOMETRY_KERNEL → FIELD_TILES → FIELD_GEOMETRY
                                             └──────────────→ FIELD_SYNTHETIC_GATE
                                                   ├→ FIELD_VISUAL_QA
                                                   └→ FIELD_PIPELINE
SOURCE_CANDIDATE_RESEARCH + INTEREST_CONTRACT → FEED_ADAPTERS
FEED_REGISTRY + FEED_ADAPTERS → FEED_FETCH ──────────→ FEED_REPLAY_QA
                    └→ FEED_HISTORY → EVENT_GEOGRAPHY → FIELD_DYNAMICS
                                                        ├→ FEED_REPLAY_QA
                                                        └→ SIGNAL_PRESENTATION
FEED_REPLAY_QA + SOURCE_APPROVAL → FIELD_PIPELINE
FIELD_PIPELINE + FIELD_VISUAL_QA + SIGNAL_PRESENTATION → SOURCE_SHADER_PROOF
SOURCE_SHADER_PROOF + PLACE_HIERARCHY → GLOBAL_FEED_EXPANSION
GLOBAL_FEED_EXPANSION + EARTH → GLOBAL_COVERAGE_QA
SOURCE_SHADER_PROOF → PUBLIC_DISCUSSION
SOURCE_SHADER_PROOF + GLOBAL_COVERAGE_QA + PUBLIC_DISCUSSION → FIELD_HARDENING
G1 + SOURCE_SHADER_PROOF + SIGNAL_PRESENTATION → FIELD_EXPERIENCE
FIELD_EXPERIENCE + FIELD_HARDENING → G2
```

This diagram summarizes the field path; the JSON contains all dependencies.
Sections 15–20 refine the earlier A–G order: preserve the visual shell, prove
synthetic data-to-geometry and tiles, deliver a bounded RSS vertical slice,
then expand globally and add richer public discussion signals. Registry
research and fixture parsers can advance independently of engine selection;
a large ingestion backend must wait for the synthetic gate. The new written
spec supplies the visual target; access to the shared chat is not a blocker.

The planner reviews all ten synthetic scenes, then witnesses a controlled RSS
item becoming a tile and visible deformation. Measure receipt-to-index ≤60s
and qualified-change-to-tile 30–60s under stated normal workloads; 2–5-minute
RSS polling applies only where allowed. These are targets, not promises of
worldwide live coverage. Material phase never invents interest; meaningful
snapshot transitions take roughly 10–30 seconds.

Global addressability is distinct from observation coverage. A versioned place
hierarchy must expose its scope and gaps, and unsupported cities remain
addressable with insufficient coverage. Source-specific rights checks precede
connector implementation/activation; approving one source need not wait for
unrelated sources. GDELT is complementary, RSS/local reporting foundational,
and Beacons still require their separate consent and abuse gates.

The browser path remains measured compositor/security evidence → `G0` →
selected-host `SHELL`, `EARTH`, `PROTECTION_RULES` → `G1`. The private store and
public historical corpus can advance independently; Absorb needs the selected
host and local store. No previously verified node is promoted to compliance
with the new spec merely because earlier tests passed.

The blocker on `PROTECTION_RULES` is licence and attribution review for filter
lists and any new engine dependency. The blocker on `BEACON_ABUSE` is the
privacy and moderation decision in ADR-006. Community connectivity is a
separate research track and does not gate browser release.
`SOURCE_APPROVAL` remains blocked until a named maintainer resolves ADR-005's
rights, API terms, provenance and measurement decisions for each admitted
component.
`G0_BENCH` also remains blocked until the matched runs can be performed on a
verified 60/120 Hz display with hands-on IME, VoiceOver, media and packaging
coverage; workers can improve the harness in parallel.
`G0_SECURITY_TESTS` remains blocked until CEF has a comparable browser policy
host, packaged tests, and the decisions in ADR-007 have owners.

## Gate ownership and evidence

| Gate | Planner verification before promotion |
|---|---|
| `G0` | Same scenario matrix and stated hardware for both engines; 60/120 Hz, media, IME, VoiceOver, permissions, crashes, sandbox and update path; published ADR-001/002. |
| `G1` | Witnessed arbitrary HTTPS form, direct URL, exact field return, keyboard/reduced-motion alternative, origin display, safe website isolation and native protection. |
| `G2` | Verify controlled RSS-to-shader timing, admitted live RSS/public discussion, global addressability and small-city visibility, provenance/coverage, deduplication, stale behavior, performance/accessibility and zero private input. |
| `G3` | Absorb permitted source; retrieve with citations while Laya has no outbound network; verify sensitive exclusions, deletion/export and disabled-model behavior. |
| `G4` | Trace a multi-step event/edge path to original citations and confirm analogy/sequence are not rendered as causation. |
| `G5` | Inspect exact published payload, consent, withdrawal limits, anti-brigading and moderation evidence across independent operators. |
| `RELEASE` | Independent security/accessibility reviews, current Chromium patch process, signed update and dependency/licence artifacts. |

The code is a development spike until these gates pass. In particular, 30 Hz
compositor measurements do not prove the PRD's 60 fps target, and fixture ad
rules do not establish production protection.
