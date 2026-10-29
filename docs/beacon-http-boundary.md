# Beacon registry HTTP boundary

The registry accepts JSON request bodies up to 16,384 **bytes**. Both hosting
adapters enforce that limit as the body streams in:

- The standalone Node server checks a declared `Content-Length` before retaining
  the body and tracks each incoming chunk's byte length. It stops accumulating
  on overflow, returns 413, and drains the remaining request bytes without
  buffering them. UTF-8 decoding is strict; malformed JSON and invalid UTF-8
  return 400 before the registry sees a request.
- The Neon Function uses `ReadableStream.getReader()` and checks every chunk's
  byte length. On overflow it cancels the reader and returns 413. It no longer
  calls `request.text()` before checking a character count.

The 16,384-byte limit bounds bytes retained and concatenated by these handlers.
The HTTP/runtime may deliver an individual chunk that was already allocated by
the platform; the handlers do not claim to control transport-side buffering.

The standalone server uses only `request.socket.remoteAddress` as a network
identity. It never reads `X-Forwarded-For`. That address is the TCP peer: if a
reverse proxy sits in front of the server, it is the proxy's address. Do not
enable forwarded addresses without a documented, authenticated proxy contract
that ensures the proxy removes client-supplied forwarding headers and inserts
the verified source address.

Neon Functions do not currently supply a verified source address to this
handler. The Function omits `ip`, so the registry's per-key limit remains
active while the per-network limit is not. It deliberately does not infer a
client address from request headers. Network-level abuse limits for that
deployment need an edge proxy/platform feature with documented client-IP
semantics; the deployment remains a private-beta configuration until this
limitation is addressed.

## Verification

The HTTP adapter tests run a real local Node HTTP server with a mock registry.
They check that spoofed forwarding headers do not replace the direct peer,
Unicode payloads are counted by UTF-8 bytes, chunked bodies are rejected during
streaming, malformed and invalid UTF-8 JSON do not reach the registry, and a
valid body exactly at the byte cap is accepted. The Neon helper tests use real
Web `Request` streams to check the same cap and cancellation behavior. These
tests require no database; registry/Postgres integration tests remain separate.

```sh
npm run test --workspace @intoponet/beacon-registry -- src/http.test.ts src/functionHttp.test.ts
npm run typecheck --workspace @intoponet/beacon-registry
```
