# Beacon registry

The public side of Beacons (PRD §4.6): a small HTTP API over Postgres (Neon). See
`docs/architecture/ADR-006-beacon-anti-sybil.md` for the design and its limits.

## Run against Neon

1. Create a Neon project and copy its connection string, for example
   `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`.
2. Apply the schema:

   ```sh
   DATABASE_URL='postgresql://…' npm run migrate --workspace @intoponet/beacon-registry
   ```

3. Start the service. It needs Node 22.6 or newer:

   ```sh
   DATABASE_URL='postgresql://…' BEACON_SECRET="$(openssl rand -hex 32)" BEACON_ADMIN_TOKEN="$(openssl rand -hex 24)" \
     npm start --workspace @intoponet/beacon-registry
   ```

   Host it anywhere that runs Node and gives it an https address.
4. In the app, open Settings › Beacons and enter the registry's https address. For
   development, you can instead set `INTOPONET_BEACON_REGISTRY` before launching.

The standalone server applies per-network limits to the direct TCP peer address
only. It ignores `X-Forwarded-For`; behind a reverse proxy, every client would share
the proxy's address.

On Neon Functions there is no trustworthy client address, so production goes through
the edge proxy in `website/api/registry.js` (served at `https://intoponet.com/registry`). Set
the same `BEACON_EDGE_SECRET` (32+ random characters) on the Function and on the Vercel
project, plus `BEACON_REGISTRY_ORIGIN` (the Function's invocation URL, no trailing
slash) on Vercel. With the secret set, the Function refuses publishes and reports that
don't come through the proxy. See ADR-006 for every limit.

Operator switches (Function env): `BEACON_PUBLISH_PAUSED=1` pauses publishing;
`BEACON_GLOBAL_PUBLISH_PER_DAY` overrides the daily ceiling. A daily trigger
(`beacon-retention` in `neon.ts`) purges records past their retention period;
`POST /v1/admin/purge` runs it by hand.

After `neon deploy --env .env.local`, confirm new code is serving (for example
`GET /v1/transparency` returns 200). On 30 October 2026 `neon deploy` reported success
without replacing the running code; `neon functions deploy beacons --src src/function.ts`
(which keeps existing Function env) did.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/health` | Database reachable. |
| GET | `/v1/beacons?cell=…&bbox=minLat,minLon,maxLat,maxLon&topic=…&limit=…` | Aggregates per page: bucketed counts, prominence and contest notes. Never keys. |
| POST | `/v1/beacons` | Signed `publish` request. Body is validated by `@intoponet/beacon-core`. |
| POST | `/v1/beacons/:id/withdraw` | Signed by the publishing key. |
| POST | `/v1/reports` | Signed `report`. Kinds: spam, harmful, misleading, broken, contest (contest needs a reason). |
| GET | `/v1/export` | Public aggregates, for mirrors and federation. |
| GET | `/v1/transparency` | Monthly report and moderation counts, limits and retention. No URLs or keys. |
| GET | `/v1/admin/queue` | Bearer `BEACON_ADMIN_TOKEN`. |
| POST | `/v1/admin/review` | `{ url, action: "restore" or "remove", reason }`. Bearer token required; logged. |
| GET | `/v1/admin/log` | Latest 200 moderation decisions. Bearer token required. |
| POST | `/v1/admin/purge` | Run the retention purge now. Bearer token required. |

## Tests

The tests run against a real Postgres, which they wipe:

```sh
BEACON_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/beacons npm test --workspace @intoponet/beacon-registry
```

The HTTP boundary tests use a local mock registry and need no database:

```sh
npm run test --workspace @intoponet/beacon-registry -- src/http.test.ts src/functionHttp.test.ts
```
