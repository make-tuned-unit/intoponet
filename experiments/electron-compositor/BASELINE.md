# Electron compositor baseline

Recorded 2026-10-23 on an Apple M4 with 16 GB memory and a 30 Hz, 2× primary
display. Candidate: Electron 45.0.0 / Chromium 156.0.8078.48 using a native
`WebContentsView`.

Five corrected cold application runs used `compositor-v1` at 1280×800. Earlier
development runs were excluded after the harness was changed to record the
actual display refresh rate and generate a real pointer event.

## Median result

- Website renderer: 30.14 fps on a 30 Hz display
- p95 frame interval: 34.3 ms
- Frames over 120% of the display frame budget: 0
- Long tasks: 0 in every corrected run
- p95 pointer interaction: 0.6 ms
- Opening transition: 453.1 ms actual for 450 ms requested
- Opening bounds-update p95: 18.1 ms
- Closing transition: 453.9 ms actual for 450 ms requested
- Total post-workload working set across browser, GPU, utility and two renderer
  processes: 481,264 KB (about 470 MiB)
- Total point-in-time CPU across those processes: about 2.69%

## Interpretation

The live native Chromium surface maintained the available 30 Hz refresh rate
through WebGL animation, continuous shell animation, smooth scrolling, editing
and two panel-bound transitions. The transition timer generally updated near
60 Hz even though the attached display refreshed at 30 Hz.

This is encouraging but does **not** satisfy the PRD's 60 fps gate. The result
is display-limited and must be repeated on a verified 60 Hz or 120 Hz display.
The working-set figure is an observed development baseline, not a budget.

ADR-001 remains open. There is no equivalent CEF result, and this run does not
cover IME, VoiceOver, video decode, permission prompts, crash recovery, battery
impact or signed production packaging.
