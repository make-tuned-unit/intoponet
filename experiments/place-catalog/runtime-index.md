# Place catalog runtime index foundation

The package now supports a disk-backed SQLite lookup index for the versioned
GeoNames import described in [ADR-009](../../docs/architecture/ADR-009-geography.md).
The implementation lives in `packages/place-catalog/src/runtime-index.ts` and
is exposed only through the Node-only `@intoponet/place-catalog/runtime-index`
subpath. It is not suitable for renderer bundles.

## Current behavior

- `index:geonames` streams the imported `places.ndjson` into an immutable,
  versioned SQLite file. It checks the input hash, row counts, parent references,
  SQLite integrity and that the input did not change during indexing. The
  staging file is linked into place only after those checks pass.
- Index rows keep GeoNames IDs as stable namespaced IDs, names and normalized
  ASCII names, country/admin codes, parent IDs, coordinates, population, feature
  code and point/coarse precision. Exact name lookup keeps ambiguous matches;
  callers can bound candidates and child pages. ID, ancestor and paginated child
  queries support hierarchy traversal without losing siblings beyond one page.
- `reconcilePlaceIndexes(previous, next)` compares immutable snapshots by ID in
  SQLite, reporting added, removed and changed counts with at most 1,000 sample
  IDs. It refuses mixed scopes. Changed records include name, parent, code,
  coordinate, population, feature and precision changes.
- `publishPlaceIndexPointer(index, pointer)` atomically replaces a small current
  pointer only after opening and validating the target index.
  `openPublishedPlaceCatalog(pointer)` accepts a basename-only target and checks
  the index hashes and snapshot date against the pointer.
- Inputs are bounded to 4 GB, 6 million nodes and 1 MB per NDJSON line. Lookup,
  child and reconciliation sample results have explicit limits.
- Name lookup is exact-only after normalization: there is no prefix/fuzzy match,
  alternate-name dataset, reverse geocoding or nearby-place query. Child pages
  follow source parent IDs; they do not indicate geographic containment. The
  convenience `getChildren` method returns one page; full traversal uses
  `getChildrenPage` and its cursor.

## Refresh procedure

1. Obtain and retain the official GeoNames source files for a dated snapshot.
2. Import them to a new, non-existing catalog directory using the importer and
   record the manifest. The import does not download data.
3. Build a new, non-existing SQLite index path, for example:

   ```sh
   npm run index:geonames --workspace @intoponet/place-catalog -- \
     --catalog-dir /path/to/catalog-2026-10-24 \
     --out /path/to/indexes/places-2026-10-24.sqlite
   ```

4. Run `reconcilePlaceIndexes(oldIndex, newIndex)` and review the snapshot
   hashes, scope and change counts/sample IDs. Reconciliation is an audit aid;
   it does not decide whether upstream changes should be accepted.
5. After review, call `publishPlaceIndexPointer(newIndex, currentPointer)`.
   Keep old immutable index files for rollback and reproducibility.

This is a full-snapshot rebuild and comparison foundation. It does not yet apply
GeoNames daily modification/deletion files incrementally, set a scheduled
refresh cadence, or make a production promotion decision. The existing global
evidence covers 5,232,029 populated-place rows and 252 country/territory nodes
in the imported extract; it is evidence for that dated GeoNames scope, not a
claim that every real-world settlement is represented.

## Acceptance evidence and gaps

Verified locally on fixture snapshots: stable ID lookup, exact-name resolution
and ambiguity, country/admin1 filtering, ancestor/child traversal, coverage
status, bounded result limits, immutable index creation, input/hash rejection,
pointer publication and reopening, plus added/removed/changed reconciliation.
Package checks pass with `npm run test --workspace @intoponet/place-catalog`
and `npm run typecheck --workspace @intoponet/place-catalog`.

The imported 5.23m-row catalog is recorded in
`global-evidence.json`, but its temporary source/output directory is not present
in this workspace. A full-scale SQLite index build and practical latency/storage
measurement therefore remain unverified. Renderer/desktop integration and
navigation UX, alternate-name resolution, polygon containment, spatial-cell selection,
automated daily updates and refresh cadence also remain open. GeoNames attribution
and source-specific notices must continue to accompany distributed derived data;
see ADR-009 for licensing and spatial precision constraints.
