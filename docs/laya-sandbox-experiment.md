# Laya sandbox experiment

**Date:** 2026-10-29
**Status:** Prototype works for local inference and demonstrates a remaining network boundary failure. It is not a production migration or release approval.

## Purpose

LAY-001 and LAY-005 require local model inference and forbid uploading model inputs, outputs, embeddings, or personal graph data. The production Laya path currently uses a Node worker with JavaScript network stubs; that is useful defense in depth but does not remove the worker's process-level network capabilities. This experiment evaluates a stricter renderer boundary without changing production Laya.

The experiment reads each pinned model file once, hashes the exact byte buffers that it sends, then gives a one-time typed job to a sandboxed renderer. The renderer has the pure JavaScript tokenizer and BERT encoder, but no Node integration. Its preload exposes only `getJob`, `submitVectors`, `reportFailure`, plus immutable sandbox diagnostic flags. IPC validates the sender frame and vector shape. The experiment does not expose a general filesystem, shell, or arbitrary IPC API.

The app code is served from an allowlisted custom scheme in a fresh in-memory Electron session. The runner also creates a temporary user-data directory, passes it to Electron, and removes it on completion, failure, or timeout; it strips `ELECTRON_RUN_AS_NODE` from the child environment. The session blocks all requests except the fixed local app resources. The renderer uses a restrictive CSP, disallows navigation and new windows, disables `<webview>`, denies permission checks and device requests, and sets Electron's WebRTC IP handling policy to `disable_non_proxied_udp`.

## Run it

The pinned model must already be present locally. Supply its root explicitly; the runner refuses to search app data. The command below uses the same Laya model root as the desktop app:

```sh
npm run verify:laya-sandbox -- --model-root="$HOME/Library/Application Support/@intoponet/desktop/laya"
```

The experiment builds into `experiments/laya-sandbox/.build/` and writes the full run report to `.build/evidence.json`. Its exit status is intentionally nonzero while strict egress denial is not demonstrated. `npm run build:laya-sandbox` builds the experiment without launching Electron.

## Observed run

Run on Electron 45.0.0 / Chromium 156.0.8078.48 / Node 24.22.0, with both model files passing pinned size and SHA-256 checks. The main process made one deliberate HTTP request to a loopback canary as a positive control. The sandboxed renderer then:

- reported `process.sandboxed === true` and `process.contextIsolated === true` from preload; page code had no `require` or `process` global;
- ran the actual MiniLM tokenizer and BERT encoder on two fixed test strings and returned two finite, unit-normalized 384-dimensional vectors;
- received CSP denials for HTTP fetch, WebSocket, image, frame, worker, and `file:///etc/hosts` probes; one attempted top-level navigation was canceled by `will-navigate`;
- ran a second sandboxed renderer on the same in-memory session with CSP allowing only the local canary. Electron `webRequest` canceled both the HTTP and WebSocket requests; the canary saw no additional HTTP request or WebSocket upgrade;
- exposed `RTCPeerConnection` to the inference renderer. With `disable_non_proxied_udp`, the UDP STUN canary saw zero datagrams, but the local TCP TURN canary accepted one connection.

The final observation demonstrates a real limitation: Electron's WebRTC IP handling policy does not mean “no WebRTC network.” Electron documents `disable_non_proxied_udp` as allowing TCP to contact peers or servers. The local TCP canary is direct runtime evidence of that path. Since Electron's session request hook did not block this transport, this experiment **fails** strict egress isolation. The command exits with status 2 for this known failure even though inference and the HTTP/WebSocket broker probes completed.

The tracked, path-redacted report is [laya-sandbox-2026-10-29.json](feature-verification/laya-sandbox-2026-10-29.json). It contains no model path or user text. The canary was loopback-only; this is executable local transport evidence, not an external packet capture or an OS firewall test.

## Limits and next decision

This proves that BERT inference can run inside an Electron sandboxed renderer with a small explicit data bridge. It also verifies that CSP and Electron's session request handler stop the tested web request APIs under this harness. It does **not** prove a complete no-egress boundary: WebRTC TCP reached the canary, Electron's main process remains network-capable, and no OS-level network deny was applied. DNS, native code, compromised Chromium/Electron components, and untested transport paths are outside these probes.

Production's `EmbeddingPool.open()` and `EmbeddingPool.start()` now hash-check the exact vocabulary and model buffers they read before retaining or handing the weights to workers. The experiment uses the same exact-buffer check so the evidence describes the bytes consumed by the renderer. This closes the previously identified model-file time-of-check/time-of-use gap; it does not change the network finding above.

Do not replace the production worker or describe Laya as network-isolated on this evidence. A production design needs a reviewed mechanism that denies renderer egress across WebRTC and other Chromium transports, with a canary and OS-level evidence. Keep LAY-001's strict isolation gate open until that design is implemented and independently verified.

## Official Electron references

- [Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox): sandboxed renderers do not initialize Node.js; preload access is reduced and requires `contextIsolation` to keep it separate.
- [Security recommendations](https://www.electronjs.org/docs/latest/tutorial/security): recommends sandboxing, CSP, permission handlers, and navigation/window controls; these are layered application controls.
- [Session API](https://www.electronjs.org/docs/latest/api/session): partitions without `persist:` use in-memory sessions; session permission handlers can deny permission checks and requests.
- [WebContents API](https://www.electronjs.org/docs/latest/api/web-contents): `disable_non_proxied_udp` prevents public/local IP exposure and limits WebRTC to TCP unless a proxy supports UDP; it does not disable TCP transports.
- [Protocol API](https://www.electronjs.org/docs/latest/api/protocol): custom protocol handlers are session-specific when a BrowserWindow uses a custom session.
