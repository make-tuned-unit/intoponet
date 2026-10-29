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

Run:

```sh
node experiments/laya-os-boundary/xpc-probe.mjs
```

The script creates two fresh temporary `Probe.app` bundles with per-run unique identifiers, compiles the same tiny Swift host and embedded XPC service, ad-hoc signs and verifies both, then deletes the temporary app bundles. Both services have `com.apple.security.app-sandbox=true`. The positive-control service also has `com.apple.security.network.client`; the denial service does not. The runner checks the signed entitlements before launching each client. Each service exposes one typed method taking loopback ports and returning a fixed synthetic text string plus TCP/UDP attempt results. Host and service subprocesses have bounded timeouts.

On macOS 26.2 / arm64 with Xcode 26.6, both XPC services launched successfully. With the network-client entitlement, the service's TCP connect and UDP send succeeded; both canaries counted the host and service. Without it, the host's TCP connect and UDP send still succeeded, while service `connect(2)` and `sendto(2)` each failed with errno 1 (`EPERM`, “Operation not permitted”). The denied-mode canaries each counted only the host positive control. Both modes returned `synthetic inference service reply` over XPC. The probe exited successfully with `network-client-positive-control-passed` and `service-network-denial-observed`. It uses no user data, model files, credentials, permission changes, or persistent signing identity.

The runner checks `~/Library/Containers` for the exact per-run service bundle IDs. macOS created sandbox container directories there even though the probe writes no model or user files. The runner verifies that each exact ID was absent before this run and refuses to touch any pre-existing path. It attempted to remove only the new, verified directories, but macOS returned `EPERM` while unlinking `.com.apple.containermanagerd.metadata.plist`; it left those directories in place and reports that outcome. This host currently has these probe-owned leftovers: `org.intoponet.LayaIsolationProbe`, `org.intoponet.LayaIsolationProbe.dda56ba2de00428d.allowed.service`, `org.intoponet.LayaIsolationProbe.dda56ba2de00428d.denied.service`, `org.intoponet.LayaIsolationProbe.3962c71fbdb941c0.allowed.service`, and `org.intoponet.LayaIsolationProbe.3962c71fbdb941c0.denied.service`. They contain containermanager metadata and, for some runs, the default empty sandbox directory structure. They were not forcibly removed.

This is stronger than the `sandbox-exec` experiment: it demonstrates a separately signed XPC service with its own App Sandbox entitlement, a same-implementation network-enabled positive control, and observed loopback TCP/UDP denial without the network-client entitlement. It proves only these local datagram/stream paths on this machine. It does not test real Laya inference, model access, narrow filesystem scoping, DNS, WebRTC, external network paths, production Electron integration, hardened-runtime signing, notarization, or support across macOS versions. Ad-hoc signing is not a substitute for validating the release signing/notarization path.

## Viable production direction: a separately sandboxed XPC service

The supported direction to prototype is a bundled macOS XPC service dedicated to inference:

1. Build a small signed XPC service target and place its service bundle in the app's `Contents/XPCServices` directory. Give the service its own App Sandbox entitlement and omit `com.apple.security.network.client` and `.server`. Keep the app's existing network capabilities separate, since browsing and public-source features need network access.
2. Put the pinned model in a narrowly shared, app-owned location the helper can read, such as an App Group container, or include it as read-only service data. Keep the helper's filesystem rights limited to that model and its minimal runtime needs. The existing app support model path is not automatically accessible to a separately sandboxed service; a supported handoff/migration must be designed and tested.
3. Replace the worker boundary with a small native XPC client bridge. Expose only bounded inference operations and typed results. Do not add general URL, file, shell, or arbitrary IPC methods. Validate request sizes, cancellation, reply sizes, and peer identity; avoid logging prompts or embeddings.
4. Verify the signed release artifact's XPC bundle, service entitlements, and App Sandbox status. Run canaries for TCP, UDP, DNS, WebSocket, and WebRTC from inside the service, plus positive controls for reading the pinned model and returning inference results. Inspect sandbox denial logs and capture local/remote canaries; test that ordinary app browsing still works independently.

The principal integration cost is the bridge: the current Electron Laya code is TypeScript and uses Node workers, while XPC has native macOS client/server APIs. A narrowly scoped Objective-C/Swift Node native module can connect the main process to the bundled service, but this introduces native build, architecture, code-signing, and notarization work. This repository's packaged preview is ad-hoc signed and has no App Sandbox entitlement; it cannot prove the release signing and helper packaging path. The release builder is configured for hardened runtime and signing when release credentials are supplied, but no signed production artifact or embedded XPC service was examined here.

An inherited App Sandbox child helper is not the right split for the current app: the Electron app needs outbound connections for unrelated features, while Laya must not have them. Apple documents that a directly spawned helper inherits the launching app's sandbox; independently configuring capabilities calls for an XPC service (or another supported separately launched component), not merely `child_process.spawn`.

## Decision and next step

Keep Laya's strict no-egress requirement open. Do not promote the experiment renderer or a `sandbox-exec` wrapper to a product boundary. The initial XPC feasibility gate passed for a small embedded service and local TCP deny. Next, test a narrowly shared synthetic model file, filesystem restrictions, and DNS/WebRTC canaries; then evaluate the native Electron client bridge and exact helper bundle layout in a disposable release-signed build. Only after the same tests pass inside the final notarized app should production Laya be migrated or described as OS-network-isolated.

## Apple references

- [App Sandbox](https://developer.apple.com/documentation/security/app-sandbox) describes OS-enforced capability restrictions and links to the network client/server entitlements.
- [Discovering and diagnosing App Sandbox violations](https://developer.apple.com/documentation/security/discovering-and-diagnosing-app-sandbox-violations) recommends a separate helper when a component needs a different capability set and distinguishes direct helpers from XPC services.
- [Creating XPC services](https://developer.apple.com/documentation/xpc/creating-xpc-services) documents bundled XPC services and client/server messaging.
- [The network client entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.client) defines outgoing connection capability.
- [Embedding a helper tool in a sandboxed app](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app) documents helper signing and inherited sandbox considerations.

Parent verification reran the paired TCP/UDP probe successfully; see [the recorded evidence](feature-verification/laya-xpc-2026-10-29.json), including exact per-run container IDs that macOS would not allow cleanup to remove. The remaining directories contain OS-managed test-container metadata, not user inputs or model data.
