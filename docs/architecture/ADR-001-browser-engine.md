# ADR-001: Embedded browser engine

- Status: Proposed; benchmark evidence incomplete
- Decision owners: project maintainers
- Scope: desktop website surface and compositor

## Context

Intoponet needs modern Chromium compatibility while preserving a GPU-rendered
exploration context around independently navigable websites. The PRD requires a
measured comparison between Electron `WebContentsView` and CEF before selection.

## Candidates

1. Electron with `WebContentsView`
2. CEF with native child surfaces
3. CEF off-screen rendering or a snapshot-to-live hybrid where necessary

A direct Chromium fork is excluded unless both embedding candidates have a
documented blocking requirement.

## Benchmark matrix

Both prototypes must run identical scenarios and record:

- long-scroll article, forms, text selection and IME
- video, WebGL and concurrent GPU load
- popup, permission, certificate and external-protocol behavior
- VoiceOver and keyboard navigation
- panel open/close, continuous resize and crash recovery
- frame time, p95 input latency, memory, idle CPU/GPU and battery impact
- sandbox/site isolation, update cadence and maintenance effort

Raw observations and test hardware belong in `experiments/<engine>/results/`.

## Current evidence

The Electron implementation establishes the host API and first repeatable
compositor baseline. Five corrected Apple M4 runs maintained the attached
display's 30 Hz refresh rate with no frames over 120% of that frame budget and a
median 470 MiB total working set across the measured Electron processes.
Detailed conditions and limitations are in
`experiments/electron-compositor/BASELINE.md`.

This does not satisfy the 60 fps target because the measured display was 30 Hz.
The official stable macOS arm64 CEF 156.0.8 distribution is now pinned with the
same Chromium 156.0.8078.48 version used by Electron. A sandboxed native child
`NSView` compositor now builds on `/Volumes/PermagentBuilds` and has a
five-run `compositor-v1` baseline. On this 30 Hz display both candidates held
the available refresh rate with no long tasks. CEF used less measured memory
(about 303 MiB versus Electron's 470 MiB); Electron's panel-bound updates were
steadier. Detailed numbers are in
`experiments/cef-compositor/BASELINE.md` and
`experiments/electron-compositor/BASELINE.md`.

This still does not satisfy the 60 fps target. Electron decoded local H.264 and
VP8 clips without dropping below the 30 Hz budget. Official CEF rejected H.264
as an unsupported source and hung on the same VP8 WebM file. IME, VoiceOver,
permissions, crash recovery, battery and packaging remain unmeasured. Therefore
no engine decision has been made, and Phase 1 work remains provisional.

## Decision rule

Pass the gate only when both candidates satisfy the security release blockers.
Among passing candidates, prefer the one with the strongest live-view
compositing and accessibility behavior; use developer velocity and memory as
secondary tie-breakers. Publish rejected options and measured limitations.
