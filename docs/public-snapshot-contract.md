# Public field snapshot identity and clock contract

## Snapshot identity

Current `intoponet.field-snapshot.v2` snapshots use an ID in this form:

```text
snapshot-v1-<64 lowercase hexadecimal characters>
```

The suffix is SHA-256 over canonical JSON for the snapshot content, excluding
the `id` field. The identity payload includes the identity format version,
snapshot schema, aggregation algorithm version, normalized `createdAt`,
coverage note, normalized source records, and derived aggregate bands. Object
keys are serialized in stable lexical order. Arrays retain their semantic
order; aggregation sorts sources and bands, chooses duplicate-URL winners by a
stable canonical record ordering, and sorts each band's source IDs before
hashing. URL identity canonicalizes scheme and host case and ignores
fragments, while preserving case-sensitive paths and query strings. `/A` and
`/a` remain separate records. Equal-weight sources use canonical record order
before scoring and summation.

To reproduce an identity, callers must use the same normalized input record
multiset, explicit evaluation timestamp, coverage result, and algorithm
version. Changing source content, evaluation time, coverage metadata, or the
algorithm changes the ID. Source array ordering and arrival order for duplicate
URLs do not.

`parseFieldSnapshot` does not trust the serialized ID. It validates and
normalizes the content, recomputes the canonical ID, and returns that ID. Old
v1 caches and prior v2 snapshots with count/hour IDs are migrated to a current
v2 snapshot with a recomputed ID. Prior v2 records using the
`log1p-separated-v2` aggregation are recalculated with
`log1p-separated-v3`; new snapshots identify that algorithm version
explicitly. Current-format snapshots with an invalid `createdAt` or an
unsupported aggregation algorithm are rejected. Optional display details
continue to be sanitized before the resulting snapshot ID is computed.

The ID is a reproducibility/content identity, not a signature or source
authenticity proof. It detects differing normalized snapshot content when
compared with a known ID; it does not prove who produced the snapshot or that
upstream observations are true.

## Evaluation clock and artifact handoff

The aggregation evaluation time is an explicit millisecond timestamp passed to
`aggregateSnapshot` or `publicFieldSnapshot`. A non-finite or out-of-range time
is rejected. Production refresh code should capture one evaluation time and
pass it through all transformations for that snapshot. `aggregateSnapshot`'s
fixed default is retained for deterministic fixtures; reproducible production
work must pass `now` explicitly.

This contract describes one immutable snapshot artifact: compute it once, keep
its content and ID together, then hand those bytes and that ID to readers. It
does not coordinate source polling clocks, serialize concurrent refresh jobs,
guarantee atomic cache publication, or ensure that separate consumers receive
the same artifact. Global ingestion synchronization and consistent multi-reader
delivery remain separate system work.
