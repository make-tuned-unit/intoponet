# Electron compositor experiment

This runner measures Electron `WebContentsView` against the shared
`compositor-v1` workload. It animates a live sandboxed Chromium view over an
independently animated shell, scrolls and edits the page, then records a
machine-readable result.

```sh
npm run benchmark:electron
```

In environments that set `ELECTRON_RUN_AS_NODE`, unset it for the command:

```sh
env -u ELECTRON_RUN_AS_NODE npm run benchmark:electron
```

Results are written to `results/latest.json` and a timestamped file. Generated
results are intentionally ignored by Git until the run hardware and conditions
have been reviewed and the evidence is ready to publish.

The runner reads `../compositor-benchmark/contract.json` for the shared window
geometry and timing. Each capture records that contract plus SHA-256 hashes of
the workload page and media asset. The CEF build embeds the same contract and
hashes when it is built.

After one fresh run from each candidate, check that the captures are truly
matched and print a neutral comparison:

```sh
python3 experiments/compositor-benchmark/compare.py \
  experiments/electron-compositor/results/latest.json \
  experiments/cef-compositor/results/latest.json
```

The check fails if either result came from a different contract, workload or
asset, or if Chromium/runtime platform/display metadata does not match. It
reports video readiness and errors as observations; a failure is still valid
evidence and does not make a result incomparable by itself.

## What the first runner measures

- requestAnimationFrame average, p95 and p99 timing in the website renderer
- frames over 20 ms and 50 ms
- long-task count and duration
- native-view opening and closing update cadence
- Electron process CPU and working-set snapshots
- exact Electron, Chromium, Node, platform and hardware metadata

It does not yet prove accessibility, IME, video decode, permissions, crash
recovery, energy impact or production packaging behavior. Those remain explicit
ADR-001 evidence gaps.
