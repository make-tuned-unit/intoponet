# Laya OS-level isolation research

**Date:** 2026-10-29

**Status:** Design research plus disposable `sandbox-exec` and XPC probes. No production migration or release isolation claim.

## Finding

The current Laya path is not protected from egress by an operating-system boundary. `apps/desktop/src/main/laya/networkStubs.ts` blocks selected JavaScript networking calls in Node workers, and `experiments/laya-sandbox` exercises a Chromium sandbox boundary. The existing Electron renderer experiment reached a loopback TCP TURN canary through WebRTC, so Chromium request hooks and `disable_non_proxied_udp` are not a complete network deny. These are useful defense-in-depth controls, not network capabilities.

Apple documents App Sandbox as kernel-enforced and describes separate XPC services as a supported privilege-separation mechanism. Apple also says directly launched helpers inherit the launching app's sandbox capabilities; it recommends XPC services when components need different capabilities. Its network-client entitlement controls whether a sandboxed process can initiate outgoing connections. These mechanisms are materially different from JavaScript monkey-patching.

## Local probe

Run on macOS 26.2 / arm64 with the system Node and `/usr/bin/sandbox-exec`:

```sh
node experiments/laya-os-boundary/probe.mjs
```

The probe starts an in-process loopback HTTP canary that returns a fixed synthetic string. An ordinary `curl` reached it once. A second `curl`, run with the profile `(version 1) (allow default) (deny network*)`, failed immediately with exit 7, and the canary observed zero additional connections. The script writes no files and uses no model, app profile, or user data.

This establishes only that this host's deprecated `sandbox-exec` can block this local TCP connection for this one command/profile. The profile explicitly allows default filesystem access. It does not test Electron, WebRTC, DNS, UDP, XPC, external networking, or the packaged Laya process.

The local `sandbox-exec(1)` man page labels the command deprecated and directs developers to App Sandbox. It is unsuitable as a production boundary: the interface/profile language is not a supported app-distribution contract.

## Disposable XPC and App Sandbox probe

Run with the pinned model root explicitly selected:

```sh
node experiments/laya-os-boundary/xpc-probe.mjs --model-root="$HOME/Library/Application Support/@intoponet/desktop/laya"
```

The runner refuses to run without that explicit flag and verifies both files against the exact pinned size and SHA-256 from `apps/desktop/src/main/laya/model.ts` before compiling or launching anything. Its host process verifies the exact bytes again before handoff. The script creates two fresh temporary `Probe.app` bundles with per-run unique identifiers, compiles the same Swift host and embedded XPC service, ad-hoc signs and verifies both, then deletes the temporary app bundles. Both services have `com.apple.security.app-sandbox=true`. The positive-control service also has `com.apple.security.network.client`; the denial service does not. The runner checks the signed entitlements before launching each client. Each service exposes typed network and model-transfer calls only; host and service subprocesses have bounded timeouts.

On macOS 26.2 / arm64 with Xcode 26.6, both XPC services launched successfully. With the network-client entitlement, the service's TCP connect and UDP send succeeded; both canaries counted the host and service. Without it, the host's TCP connect and UDP send still succeeded, while service `connect(2)` and `sendto(2)` each failed with errno 1 (`EPERM`, “Operation not permitted”). The denied-mode canaries each counted only the host positive control. Both modes returned a fixed XPC control reply; the denied service separately completed MiniLM inference as described below. The probe exited successfully with `network-client-positive-control-passed` and `service-network-denial-observed`.

The same XPC interface also transfers fixed synthetic `NSData`: 1,024 bytes with a SHA-256 digest, an empty payload, and 4,097 bytes over the 4,096-byte service processing limit. The helper recomputes SHA-256, performs a bounded checksum on the nonempty valid bytes, rejects an empty payload, rejects a malformed digest length, rejects a same-length but tampered digest, and rejects the oversized buffer before hashing/processing it. Both network configurations returned matching digest/checksum for the valid buffer and the same rejection results for invalid buffers. The supplied digest is a caller-supplied byte-consistency check only; it does not authenticate the payload as a trusted or pinned model.

The no-network service then receives the real pinned model and vocabulary as bounded XPC `NSData` calls: vocabulary in one message and the model in 87 sequential chunks no larger than 1 MiB. The helper accepts only the exact pinned sizes, hard-coded SHA-256 fingerprints, ordered chunk indices, and per-chunk size. It verifies the complete model hash before parsing. The host independently reads the explicitly selected model-root files and verifies the same pins before sending. The service loads an esbuild IIFE resource containing the existing TypeScript `WordPieceTokenizer`, `parseSafetensors`, and `MiniLmEncoder` code into a JavaScriptCore `JSContext`. A small UTF-8 `TextDecoder` shim is included for runtimes without that API. The service exposes only a fixed synthetic sentence for inference; there is no generic JavaScript evaluation, module-loading, filesystem-path, or shell RPC. The output check requires token IDs, 384 finite vector values, and unit norm within 0.0001; the helper also reports a digest of the Float32 vector bytes. This demonstrates actual inference on this model inside the separately sandboxed service on this host. It does not authenticate arbitrary caller text or model bytes: the helper pins the known model and vocabulary hashes itself.

The runner now builds this same IIFE once for both engines and runs a V8 baseline on the same pin-verified model/vocabulary buffers and fixed sentence. It captures the full JavaScriptCore vector privately, then compares exact token IDs, maximum absolute component delta (≤ 1e-5), and cosine similarity (≥ 0.999999). Its report contains only pinned artifact IDs, stage results, token IDs, vector shape/norm/digests, and parity metrics; it does not print either full vector. The parent rerun passed: token IDs matched exactly, maximum absolute delta was 2.0816681711721685e-17, cosine similarity was 1, and the Float32 vector digests matched. See [the real-model inference evidence](feature-verification/laya-xpc-inference-2026-10-29.json), including this run’s sandbox-container cleanup results.

The XPC client sends chunks up to 1 MiB; the service rejects out-of-order or oversized chunks after the XPC framework delivers them. This is not a hard transport-allocation limit against a malicious XPC peer. A production client must enforce chunk bounds before sending and the service must validate each received chunk. The only file probe uses a fixture in a unique `~/Library/Caches` temporary directory, outside the service's container. Its absolute path is compiled into this temporary service; no XPC method accepts a path or exposes a general file operation. The host creates and verifies the fixture, while the sandboxed service's fixed `open(2)` attempt fails with errno 1 (`EPERM`) in both network configurations. The runner removes the synthetic fixture directory afterward. The service receives model bytes over IPC and never opens the model files itself.

The synthetic payload check is an application-level size check after the XPC framework has delivered the `NSData`; it does not establish a hard transport allocation cap for a maliciously large XPC message. The actual model path sends 1 MiB chunks, but those are also checked by the service after receipt. A production bridge must reject excessive data on the client before sending and validate again in the service before processing.

The runner checks `~/Library/Containers` for the exact per-run service bundle IDs. macOS created sandbox container directories there even though the probe writes no model or user files. The runner verifies that each exact ID was absent before this run and refuses to touch any pre-existing path. It attempted to remove only the new, verified directories, but macOS returned `EPERM` while unlinking `.com.apple.containermanagerd.metadata.plist`; it left those directories in place and reports that outcome. Earlier observed probe-owned leftovers include: `org.intoponet.LayaIsolationProbe`, `org.intoponet.LayaIsolationProbe.dda56ba2de00428d.allowed.service`, `org.intoponet.LayaIsolationProbe.dda56ba2de00428d.denied.service`, `org.intoponet.LayaIsolationProbe.3962c71fbdb941c0.allowed.service`, `org.intoponet.LayaIsolationProbe.3962c71fbdb941c0.denied.service`, `org.intoponet.LayaIsolationProbe.ef4b8b7339d6496e.allowed.service`, `org.intoponet.LayaIsolationProbe.ef4b8b7339d6496e.denied.service`, `org.intoponet.LayaIsolationProbe.529867f689a04320.allowed.service`, `org.intoponet.LayaIsolationProbe.529867f689a04320.denied.service`, `org.intoponet.LayaIsolationProbe.805a8474cf354635.allowed.service`, and `org.intoponet.LayaIsolationProbe.805a8474cf354635.denied.service`. They contain containermanager metadata and, for some runs, the default empty sandbox directory structure. They were not forcibly removed. The synthetic fixture directory in `~/Library/Caches` was removed successfully.

This is stronger than the `sandbox-exec` experiment: it demonstrates a separately signed XPC service with its own App Sandbox entitlement, a same-implementation network-enabled positive control, observed loopback TCP/UDP denial without the network-client entitlement, pinned model/vocabulary delivery and verification, real MiniLM inference in JavaScriptCore, and denial of one fixed path outside the service container. It proves only these local paths and this exact model/text on this machine. It does not test the production Electron bridge, full Laya retrieval path, arbitrary real user text, comprehensive filesystem scoping, DNS, WebRTC, external network paths, hardened-runtime signing, notarization, or support across macOS versions. Ad-hoc signing is not a substitute for validating the release signing/notarization path.

## Viable production direction: a separately sandboxed XPC service

The supported direction to prototype is a bundled macOS XPC service dedicated to inference:

1. Build a small signed XPC service target and place its service bundle in the app's `Contents/XPCServices` directory. Give the service its own App Sandbox entitlement and omit `com.apple.security.network.client` and `.server`. Keep the app's existing network capabilities separate, since browsing and public-source features need network access.
2. The prototype shows a main-process client can verify the existing pinned app-support model and transfer it to the service in bounded XPC chunks; the service itself cannot read that path. Production can adopt a similarly narrow byte-transfer API or a reviewed shared model location. Preserve helper-side exact hash verification and separately review model installation/update behavior.
3. Replace the worker boundary with a small native XPC client bridge. Expose only bounded inference operations and typed results. Do not add general URL, file, shell, or arbitrary IPC methods. Validate request sizes, cancellation, reply sizes, and peer identity; avoid logging prompts or embeddings.
4. Verify the signed release artifact's XPC bundle, service entitlements, and App Sandbox status. Run canaries for TCP, UDP, DNS, WebSocket, and WebRTC from inside the service, plus positive controls for reading the pinned model and returning inference results. Inspect sandbox denial logs and capture local/remote canaries; test that ordinary app browsing still works independently.

The principal integration cost is the bridge: the current Electron Laya code is TypeScript and uses Node workers, while XPC has native macOS client/server APIs. A narrowly scoped Objective-C/Swift Node native module can connect the main process to the bundled service, but this introduces native build, architecture, code-signing, and notarization work. This repository's packaged preview is ad-hoc signed and has no App Sandbox entitlement; it cannot prove the release signing and helper packaging path. The release builder is configured for hardened runtime and signing when release credentials are supplied, but no signed production artifact or embedded XPC service was examined here.

An inherited App Sandbox child helper is not the right split for the current app: the Electron app needs outbound connections for unrelated features, while Laya must not have them. Apple documents that a directly spawned helper inherits the launching app's sandbox; independently configuring capabilities calls for an XPC service (or another supported separately launched component), not merely `child_process.spawn`.

## Decision and next step

Keep Laya's strict no-egress requirement open. Do not promote this prototype or a `sandbox-exec` wrapper to a product boundary. The XPC probe now runs pinned MiniLM inference on fixed synthetic text while testing TCP/UDP denial and a fixed filesystem denial. Next, extend transport coverage to DNS and WebRTC and evaluate the native Electron client bridge and exact helper bundle layout in a disposable release-signed build. Only after the same tests pass inside the final notarized app should production Laya be migrated or described as OS-network-isolated.

## Apple references

- [App Sandbox](https://developer.apple.com/documentation/security/app-sandbox) describes OS-enforced capability restrictions and links to the network client/server entitlements.
- [Discovering and diagnosing App Sandbox violations](https://developer.apple.com/documentation/security/discovering-and-diagnosing-app-sandbox-violations) recommends a separate helper when a component needs a different capability set and distinguishes direct helpers from XPC services.
- [Creating XPC services](https://developer.apple.com/documentation/xpc/creating-xpc-services) documents bundled XPC services and client/server messaging.
- [The network client entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.client) defines outgoing connection capability.
- [Embedding a helper tool in a sandboxed app](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app) documents helper signing and inherited sandbox considerations.
- [JavaScriptCore](https://developer.apple.com/documentation/javascriptcore) documents in-process JavaScript execution from Swift and Objective-C.
- [Creating a typed array from an existing buffer](https://developer.apple.com/documentation/javascriptcore/jsobjectmaketypedarraywithbytesnocopy%28_%3A_%3A_%3A_%3A_%3A_%3A_%3A%29/) documents the backing-buffer API used to pass verified bytes into JavaScriptCore.

Parent verification reran the paired TCP/UDP probe successfully; see [the recorded evidence](feature-verification/laya-xpc-2026-10-29.json), including exact per-run container IDs that macOS would not allow cleanup to remove. The remaining directories contain OS-managed test-container metadata, not user inputs or model data.
