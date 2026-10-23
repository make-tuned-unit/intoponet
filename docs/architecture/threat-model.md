# V1 trust boundaries

## Processes and data

| Boundary | Trust | Allowed |
|---|---|---|
| Intoponet main process | Privileged host | Create sandboxed views; validate typed commands |
| Trusted shell renderer | Limited trusted UI | Invoke the allowlisted browser-host API |
| Website renderer | Untrusted | Normal HTTP(S) browsing inside its Chromium sandbox |
| Local browser profile | Private local state | Cookies and site storage in a dedicated partition |
| Public network | Untrusted | Website traffic initiated by Chromium |

The current V1 contains no Laya worker, public field client or beacon publisher.
Those boundaries must be added separately rather than extending the website
bridge.

## Enforced now

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- no preload or privileged bridge in arbitrary website renderers
- an explicit, discriminated command API in `@intoponet/browser-api`
- runtime validation and trusted-shape copying for every IPC command
- HTTP(S)-only in-panel navigation
- denied website permission requests during the spike
- popup targets denied with an explicit shell error
- HTTPS and insecure HTTP origins have distinct, continuously visible states
- no telemetry or cloud model endpoint

## Known gaps before public beta

- IPC parser fuzz/property tests beyond the current malformed-payload cases
- download, certificate-error, WebAuthn, password/autofill and popup policies
- safe-browsing/malware protection and external-protocol consent
- profile encryption/key management and private browsing partitions
- crash recovery, signed updates, Chromium CVE intake and emergency releases
- dependency lock/SBOM, license review and independent security assessment

Any unsandboxed web content, generic privileged page bridge, hidden inference
egress, or private data in logs remains a release blocker.
