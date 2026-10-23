# CEF compositor baseline

Recorded 2026-10-23 on an Apple M4 with 16 GB memory and a 30 Hz, 2x primary
display. Candidate: CEF 156.0.8 / Chromium 156.0.8078.48 using a native child
NSView over an independently animated Cocoa field.

Five cold application runs used `compositor-v1` at 1280x800. The first two
required a later shutdown fix after they wrote valid results but did not exit.

## Median result

- Website renderer: 30.05 fps on a 30 Hz display
- p95 frame interval: 34.1 ms
- Frames over 120% of the display frame budget: 0 median, 1 in two runs
- Long tasks: 0 in every run
- p95 pointer interaction: 0.4 ms
- Opening transition: 451.0 ms actual for 450 ms requested
- Opening bounds-update p95: 18.1 ms
- Closing transition: 450.4 ms actual for 450 ms requested
- Total post-workload working set of sampled CEF processes: 310,688 KB (about 303 MiB)
- Total process-derived CPU during the run: about 0.20%

## Comparison with Electron

On the same display, both candidates held the available 30 Hz refresh rate
through WebGL, scrolling, editing and two panel-bound transitions. Neither
result validates the PRD 60 fps target.

CEF used less measured memory (about 303 MiB versus Electron's 470 MiB) and
sampled fewer processes. Electron's native-view transition cadence was more
consistent: its five-run opening/closing p95 update intervals stayed near
18 ms, while two CEF openings and three CEF closings recorded 6-12 updates
over 20 ms.

## Video decode

The shared workload now includes a local clip. Official CEF rejected H.264
(`video.mp4`) with "no supported source was found." Electron decoded both that
H.264 clip and a later VP8 WebM clip (`video.webm`, 317 decoded frames, 30.13
fps, no long tasks). A CEF run against the same WebM file hung before writing a
result and had to be stopped. Video decode is therefore a measured CEF gap, not
an untested item.

These numbers are encouraging but do **not** close ADR-001. Remaining
blockers are a 60 Hz or 120 Hz rerun, IME, VoiceOver, a completed CEF video
result, permission prompts, crash recovery, battery impact and production
packaging.
