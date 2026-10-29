# Shared public snapshot artifact service

`services/public-snapshots` is a small self-hostable delivery foundation for
already-computed field snapshots. It does not fetch source data, select an
evaluation time, read the desktop's private library, or deploy a public
endpoint. The publisher takes an explicit local JSON artifact, validates it,
normalizes it through `@intoponet/field-snapshot`'s canonical v3 algorithm and
parser, then writes the content-addressed bytes to a dedicated directory.

## Local use

The command requires a snapshot file and an explicit storage directory:

```sh
npm run publish --workspace @intoponet/public-snapshots -- \
  /path/to/canonical-public-snapshot.json /path/to/public-snapshot-store
```

The service requires the same dedicated storage directory and binds to loopback
by default:

```sh
SNAPSHOT_STORE_PATH=/path/to/public-snapshot-store \
  npm run start --workspace @intoponet/public-snapshots
```

The default host is `127.0.0.1` and port is `8788`. A caller must explicitly
set `HOST` to bind elsewhere. This repository does not configure a default
public URL, proxy, deployment, authorization policy, or external data source.

## Artifact and HTTP contract

- Input must use the current `intoponet.field-snapshot.v2` schema with the
  `log1p-separated-v3` aggregation algorithm, a valid explicit evaluation time,
  and a matching canonical `snapshot-v1-<sha256>` ID. The publisher rejects a
  snapshot evaluation time more than five minutes ahead of its injected clock
  (the CLI uses the local system clock), matching desktop client clock-skew
  tolerance. It accepts old evaluation times, which clients label stale.
- Every source must be a validated `public-record`; synthetic fixtures and
  synthetic or legacy measurement data are rejected. The publisher checks
  finite latitude/longitude within geographic bounds, a finite positive radius
  no larger than 20,040 km, canonical UTC timestamps, and bounded source,
  measurement, topic, and optional-detail strings. Input is capped at 5 MiB and
  10,000 sources.
- The future-time bound applies to the snapshot evaluation time only. Source
  metadata dates are checked for canonical UTC syntax; the publisher does not
  reject a source record merely because a future event date such as `endedAt`
  follows the snapshot evaluation time. Those dates remain publisher-supplied
  source assertions.
- Unknown fields are removed by parsing and serializing the normalized
  contract. The stored artifact is the exact immutable JSON byte sequence for
  that normalized snapshot. The publisher rejects an ID that does not match
  that normalized content, rejects band values inconsistent with the
  normalized records, and drops unknown fields during serialization.
- The store creates `<snapshot-id>.json` using a create-if-absent filesystem
  operation. It will not overwrite an existing ID with different bytes. A
  `latest.json` manifest is replaced atomically only after the immutable file
  is present. Temporary files and the store directory are fsynced before
  publication completes. The manifest carries the snapshot ID, SHA-256, source evaluation
  time, and bounded artifact path; it has no publisher-local clock field.
- `GET` and `HEAD /latest` return the latest manifest. `GET` and `HEAD
  /snapshots/<snapshot-id>` return immutable snapshot bytes. Responses include
  SHA-256 ETags. The latest manifest uses `no-store`; content-addressed
  snapshots use long-lived immutable caching.
- Missing pointers, dangling pointers, digest mismatches, noncanonical bytes,
  and invalid stored snapshots fail closed. Unsupported methods receive 405;
  unrecognized paths receive 404.

Two clients can request the same artifact at different local times and receive
the same ID, evaluation time, and exact bytes because those values come from
the published artifact and atomic manifest, not from request time. A client
must pin the returned ID if it needs to keep using one version while a later
publisher advances `/latest`.

## Trust and delivery limits

The publisher checks that source records satisfy the application's public
record schema and required attribution fields. A `public-record` label and
attribution text are publisher assertions, not evidence. The service does not
independently verify publication rights, license claims, source accuracy, or
absence of personal information. The storage directory owner is trusted.

The digest and content ID detect accidental or partial modification relative
to the manifest and canonical snapshot contract. They are not a publisher
signature: an operator who can edit both the manifest and files can replace an
artifact. Protect the storage directory and use an authenticated, reviewed
deployment path if it is exposed beyond a trusted local environment. The
implementation is designed for a single local filesystem that supports
same-directory hard links and atomic rename; it does not coordinate writers
across independent hosts or object stores.

This service does not make today's independent client/source polling
synchronized. It does not provide scheduled ingestion, a globally agreed
evaluation clock, source freshness guarantees, server-side source adapters,
retention/garbage collection, signed provenance, or automatic client adoption.
An operator must create a normalized artifact from public records with a fixed
evaluation time and explicitly publish it. No shared service is selected by
default in the desktop, and no public endpoint has been deployed or tested.
