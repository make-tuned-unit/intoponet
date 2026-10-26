# CEF compositor comparator

Status: workload contract defined, distribution pinned, and native toolchain
validated on the external build volume.

`cef.lock.json` pins the official stable macOS arm64 standard distribution:
CEF 156.0.8 / Chromium 156.0.8078.48. This exactly matches the Chromium version
in the Electron 45 baseline. The archive name, size, SHA-1, sandbox
compatibility value and official `cef-project` template commit are recorded.

The internal workspace volume is too full for CEF. The build script therefore
places the cloned template, 312 MB archive, extracted distribution, generated
Xcode project and compiled products under
`/Volumes/PermagentBuilds/IntoponetCEF`, which currently has sufficient space.
Repository source and lock data remain here.

```sh
python3 experiments/cef-compositor/build.py
```

Set `INTOPONET_CEF_BUILD_ROOT` or pass `--external-root` to use another mounted
build volume. The script refuses an absent mount, checks out the pinned official
template commit, patches only the pinned version and local workload URL, then
verifies archive size and SHA-1 before compilation.

The resulting sandboxed app is:

`/Volumes/PermagentBuilds/IntoponetCEF/build/Release/minimal.app`

The build reads `experiments/compositor-benchmark/contract.json`, generates a
header for the native comparator, and embeds the same scenario contract and
SHA-256 hashes of the workload page and declared media assets in each result.
The native window bounds and waits use those generated values. Rebuild after
changing the contract, workload, or assets.

The sandboxed native-child compositor now builds and emits
`engine-compositor-result-v1`. Five cold runs are summarized in `BASELINE.md`.
This is compositor evidence, not an engine decision. Higher-refresh, IME,
VoiceOver, video and crash-recovery measurements remain outstanding.

The CEF comparator must load
`../compositor-benchmark/scenario.html` unchanged and emit
`engine-compositor-result-v1`, matching the Electron runner's field names and
units. It may add candidate-specific fields but may not omit a metric because it
performs poorly.

## Required implementation

1. Download and verify the distribution pinned in `cef.lock.json`. Do not fetch
   an unversioned "latest" archive.
2. Implement a native child-window browser surface first.
3. Animate the live browser bounds through the same `480×320` to `1140×650`
   transition over 450 ms in a `1280×800` host.
4. Run the same edit and smooth-scroll sequence over the same duration.
5. Read `window.__INTOPONET_BENCHMARK__.snapshot()` only from the local,
   repository-owned workload.
6. Record browser/renderer process memory and CPU, transition update intervals,
   CEF/Chromium versions and hardware metadata.
7. Repeat with off-screen rendering only if the native-child result reveals a
   documented layering blocker.

## Parity requirements

- Chromium sandbox enabled and no privileged JavaScript bindings in the page.
- No network access is required by the workload.
- Same viewport, timing, release-build optimization and display scaling.
- At least five cold application runs per candidate; publish every run plus
  median and worst-case summaries.
- Record display refresh rate and whether the run was on battery or mains.

The comparator is not considered implemented until it builds and runs locally.
This file prevents an unverified scaffold from being counted as CEF evidence.

Compare fresh captures with the shared checker:

```sh
python3 experiments/compositor-benchmark/compare.py \
  experiments/electron-compositor/results/latest.json \
  experiments/cef-compositor/results/latest.json
```

The checker rejects differing scenario contracts, workload or asset hashes,
Chromium versions, platforms, or captured display/hardware metadata. It reports
video success or failure without treating either outcome as an engine decision.
