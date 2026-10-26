# ADR-009: Gazetteer identity and spatial indexing

- Status: Proposed; implementation and data-import policy pending planner review.
- Date: 2026-10-23

## Decision

Use GeoNames feature IDs as namespaced stable identities (`geonames:<geonameId>`) for country, admin1, admin2, and populated-place records. Keep name resolution separate from spatial aggregation. Resolve exact normalized names to zero, one, or multiple candidates; never choose one arbitrarily when ambiguous. A query can be scoped by country/admin1. Parent references are joined from the GeoNames countryInfo, admin1CodesASCII, admin2Codes, and populated-place records when those records exist.

The `@intoponet/place-catalog` package provides bounded, pure TSV readers and in-memory lookup. It performs no download, database write, geocoding request, or fallback to inferred neighborhoods. Coordinates are WGS84 point anchors. A populated-place point is not a boundary or a claim that every nearby person is represented. Country/admin levels are explicitly coarse. Missing results carry source scope; unsupported country codes are distinct from a miss inside a represented country. Neither state means low or absent activity.

GeoNames publishes a daily `allCountries.zip` export and describes its coverage as millions of features and populated places, but also supplies the data “as is” without completeness or accuracy warranty. The global feature file is the eventual import source; `cities15000.zip` is only an optional bootstrap/test scope. GeoNames defines that file as places with population greater than 15,000 or capitals (about 25,000 records), never as “all cities.” A production import must record the export date, exact source files, parser version, and selected feature-class/code policy. It should process bounded chunks, retain all supported `P` populated-place rows from the declared extract (not just a population threshold), and publish an explicit refresh/update policy. The readme also describes daily modification/deletion files that could support incremental updates, subject to reconciliation policy. This foundation package intentionally contains no downloaded extract and makes no claim of global runtime coverage. [GeoNames export and terms](https://www.geonames.org/export/), [GeoNames download readme](https://download.geonames.org/export/dump/readme.txt), [GeoNames coverage and WGS84 description](https://www.geonames.org/about.html).

GeoNames states CC-BY licensing, commercial use allowed, and requests attribution with a link or reference. It also aggregates data from many sources (including some source-specific notices). Before distribution of a derived production bundle, record the exact attribution text and review whether all bundled fields are covered by the published terms; GeoNames’ “as is” notice remains a quality limitation. API service credits/rate limits apply to web services; this package uses downloadable exports, not the API. [GeoNames data and terms](https://www.geonames.org/export/).

## Coverage and identity constraints

- GeoNames IDs are the catalog’s source identity. Do not imply that names are globally unique or immutable natural keys.
- Country/admin hierarchy is available only where corresponding source records are included. Parent IDs are best-effort joins by GeoNames administrative codes; missing parents remain missing and must not be fabricated.
- `allCountries-populated-features` means the populated feature records from a dated GeoNames extract, not exhaustive settlements, service coverage, or current human attention.
- `cities15000-subset` is a deliberately partial scope; no-match results must preserve that fact.
- Unknown country/source coverage is returned as unsupported or not found with scope metadata. Downstream products must preserve unknown separately from zero.
- Coordinates on administrative records are representative points from the gazetteer, not polygon boundaries. No neighborhood or fine-grained presence may be inferred from these anchors.

## Spatial cell system recommendation

Keep administrative/populated-place identity independent of the spatial index. For a future multiresolution hex field, recommend H3 as the first prototype because it uses an explicit hierarchical cell index and offers efficient parent/child operations. H3 documents that parent truncation has approximate geographic containment, even though a cell at a fixed resolution and logical index hierarchy are exact; its global grid includes pentagons. Therefore use H3 hierarchy for aggregation only, and use a separately validated polygon/region operation whenever exact geographic containment matters. [H3 indexing documentation](https://h3geo.org/docs/highlights/indexing/).

S2 is a credible alternative: it uses a six-face cube projection, recursively subdivided into four-child cells with geodesic edges and 64-bit cell IDs. No tile implementation or H3 dependency is introduced by this ADR. Benchmark actual renderer and aggregation needs before adopting either library; cell IDs are not place IDs. [S2 cell hierarchy](https://s2geometry.io/devguide/s2cell_hierarchy).

## Implementation and acceptance boundary

The package parses caller-supplied bounded TSV strings and exposes deterministic place nodes and name lookup. It validates metadata, coordinates and import limits; rejects duplicate IDs; records dataset scope; retains same-name candidates; and handles antimeridian distance with the shortest wrapped longitude delta. Its opt-in `import:geonames` CLI accepts local `countryInfo.txt`, `admin1CodesASCII.txt`, `admin2Codes.txt`, and `allCountries.txt` (or `cities15000.txt`) inputs. It streams the populated-place file, writes an NDJSON catalog into a staging directory, records source SHA-256 hashes, scope/date/counts and output hash in a versioned manifest, checks that inputs did not change during import, and atomically renames the completed staging directory to a new output path. It refuses an existing output path. The CLI has finite row and line-size bounds; a maximum 20 million place-file rows and 1 MB per line.

The command does not fetch or download source files. No global dataset has been imported or audited here. Before a full import, an operator still needs to obtain the dated official files, run the importer with the correct source scope, verify the manifest and output, and choose a refresh/update cadence; the GeoNames daily modification/deletion files still need a reconciliation design. Alternate-name resolution, polygons, tile selection, and complete country/admin coverage also remain future work. Acceptance of this geography policy and any production dataset is pending planner review.

Example local import command:

```sh
npm run import:geonames --workspace @intoponet/place-catalog -- \
  --countries /path/to/countryInfo.txt \
  --admin1 /path/to/admin1CodesASCII.txt \
  --admin2 /path/to/admin2Codes.txt \
  --places /path/to/allCountries.txt \
  --snapshot-date 2026-10-23 --scope allCountries \
  --out /path/to/new-versioned-output
```

## Planner verification

The bounded parser and local importer foundation were reviewed on 2026-10-23.
An independent import of the downloaded cities15000 subset produced 85,938
unique nodes: 252 country/territory records, 3,865 admin1, 47,642 admin2 and
34,179 populated places. Output hashes matched and all emitted parent references
resolved. See `experiments/place-catalog/bootstrap-evidence.json`. This validates
the importer on real data; it does not establish all-city runtime coverage.
The source files and generated catalog are temporary review artifacts under
`/tmp/intoponet-geonames-review`, not bundled production data.

The full `allCountries` feature-class P import was subsequently run and streamed
through independent verification: 5,232,029 populated-place records across 248
country codes, with all emitted parent references resolved and the output hash
verified. `experiments/place-catalog/global-evidence.json` records the exact
source hashes, counts and provider modification time. This does not include
alternateNamesV2 or a runtime search index; navigation and refresh remain open.
