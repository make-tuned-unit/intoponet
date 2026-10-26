# Isolated public feed ingestion pilot

This CLI is a one-shot, public-metadata-only replay tool. It is not wired into
the desktop startup path. It requires one explicit source ID, an explicit
dedicated data directory, and `--enable-live` for an admitted live endpoint.
The research registry is not modified or globally enabled by the CLI.

```sh
node experiments/public-feed-pilot/run.mjs \
  --source-id hinckley-bosworth-news \
  --data-dir /absolute/path/to/intoponet-public-feed-pilot \
  --enable-live
```

For controlled local replay, the same explicitly admitted source can be paired
with a loopback test endpoint. `--fixture` selects the fetch service's
loopback-only mode and `--feed-url` is required:

```sh
node experiments/public-feed-pilot/run.mjs \
  --source-id hinckley-bosworth-news \
  --data-dir /absolute/path/to/intoponet-public-feed-fixture \
  --fixture --feed-url http://127.0.0.1:8765/rss.xml
```

The command writes `fetch-cache.v1.json`, `history.v1.json`, and
`ingestion-manifest.v1.json` with owner-only file permissions. The manifest
contains only approved titles, canonical links, dates, hashes, source health,
and attribution/license evidence. It excludes descriptions, article bodies,
images, and media. A `no-store` response removes that source's previously
retained history rows. An outage records stale/error health while preserving
the historical public metadata; an empty successful poll is recorded as a
decline rather than an outage.

## Bounded pilot limitations

- The scheduler is invoked once by this CLI; continuous desktop scheduling is
  not wired.
- Production URL checks perform DNS preflight but the fetch transport does not
  pin DNS answers. Keep live execution limited to the individually reviewed
  registry endpoint until a pinned transport/endpoint policy is reviewed.
- Story geography stays unknown without defensible item-level evidence.
- Source registry admission is deliberately limited to the scoped Hinckley
  metadata pilot. The CLI requires the exact source ID; it never enables all
  registry rows.
