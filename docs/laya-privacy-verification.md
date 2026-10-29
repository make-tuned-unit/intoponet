# Laya privacy and egress verification

The PRD requires on-device inference and retrieval (LAY-001/005), offline use
of a verified local model (LAY-002), and a Laya worker with no network
permission (§6.4, §10). The current worker implementation uses
`worker_threads` in the Electron main process. It does not have a distinct OS
security identity, an OS sandbox profile, or a network-deny capability. The
JavaScript guards described below are defense in depth; they are **not** the
PRD's OS-level “no network permission” boundary.

## Executable verification

From macOS with Node 22.6+ and the repository dependencies installed:

```sh
npm run verify:laya-privacy
```

This starts a local HTTP canary on loopback, then uses real `worker_threads`.
The positive control makes a request to the canary and must be observed both
by the server and by `lsof` in the OS socket table. A second worker serializes
the production `installNetworkStubs` function and attempts `fetch`, HTTP(S),
HTTP/2, TCP/TLS, callback and promise DNS, DNS Resolver methods, UDP, process
creation, nested workers, and WebSocket. All guarded attempts must throw before
reaching the canary; `lsof` must show no established worker socket to that
canary. A saved `Socket.prototype.connect` reference is deliberately captured
before installing the guards. The test reports whether it can bypass the
patches, since monkey-patching cannot revoke a reference already held by code.

To run a real inference in the compiled Laya worker using the installed,
fingerprint-verified MiniLM files:

```sh
npm run build
npm run verify:laya-privacy -- --model-root "$HOME/Library/Application Support/@intoponet/desktop/laya"
```

Pass the directory containing `models/` explicitly; the verifier does not
search or modify app data automatically. It checks the pinned model SHA-256,
embeds a fixed synthetic phrase through the compiled worker, confirms a
384-dimensional unit vector, statically checks that the worker bundle calls
the network guards before loading BERT/tokenizer chunks, and polls the
verifier process's socket table during inference. A JSON report is written to
`experiments/laya-privacy-verification/results/latest.json` (ignored by Git).

On 2026-10-29, the live report using Node v24.19.0 and the pinned MiniLM model
showed:

- Positive-control loopback HTTP request and established socket observed.
- All 14 guarded API probes refused; no additional canary request or socket
  was observed from the guarded worker.
- A previously captured `Socket.prototype.connect` reference bypassed the
  JavaScript patch and reached the loopback canary. This is an explicit
  limitation of monkey-patching, not a test failure.
- The compiled Laya worker embedded the fixed phrase, returned a normalized
  384-element vector, and produced no `lsof` network socket rows in three
  samples taken 50 ms apart during its 136 ms run.

The positive control demonstrates that the loopback canary and socket-table
observer can see ordinary Node socket traffic. The negative result is scoped
to the listed runtime calls and observed interval; this is not a packet
capture, a kernel-level deny rule, or proof that native bindings, transient
sockets between polls, or a future unreviewed code path cannot egress. The
captured-reference bypass is why the PRD's OS isolation gate remains open.

## What runs locally

`LayaService.enable()` is the only Laya path that invokes the injected `fetch`
implementation, for the user-requested pinned model download. `search()`,
`ask()`, `related()`, themes and embedding backfill read the local knowledge
store, local vector store, and worker embedder; there is no separate retrieval
worker and those paths do not call fetch. Existing unit tests exercise those
service paths with a fake embedder/knowledge store and assert zero fetches;
they are mock evidence, not network-boundary proof. The verifier's canary and
compiled-worker run provide runtime evidence, with the OS-level limitation
above.

## Changes made for fail-closed behavior

- The inference worker now installs guards before dynamically importing the
  BERT encoder and tokenizer, avoiding references captured by those imports
  before the guard is active.
- The guards refuse fetch, WebSocket/EventSource/XHR, common Node network and
  DNS APIs, DNS Resolver methods, child-process creation, and nested workers.
  If the runtime cannot expose the Node built-ins needed for those guards, the
  worker now fails to start instead of silently running with a partial patch.
- The static and build checks ensure the current inference modules do not
  import network transports and the generated worker preserves guard-before-
  inference load order.

These changes reduce accidental egress risk. They do not add OS network
permissions or make `worker_threads` a security boundary. A separate sandboxed
process/OS policy and packet-level validation remain needed to satisfy the
strict LAY-001/§6.4 worker boundary for public release.
