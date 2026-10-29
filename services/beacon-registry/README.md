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
only. It ignores `X-Forwarded-For`; when deployed behind a reverse proxy, clients
will share the proxy's address for this interim limit unless a trusted-proxy
contract is implemented. Neon Functions do not expose a verified client address
to this function, so the function does not guess one from request headers and
does not apply the per-network limit. This remains a private-beta limitation.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/health` | Database reachable. |
| GET | `/v1/beacons?cell=…&bbox=minLat,minLon,maxLat,maxLon&topic=…&limit=…` | Aggregates per page: bucketed counts, prominence and contest notes. Never keys. |
| POST | `/v1/beacons` | Signed `publish` request. Body is validated by `@intoponet/beacon-core`. |
| POST | `/v1/beacons/:id/withdraw` | Signed by the publishing key. |
| POST | `/v1/reports` | Signed `report`. Kinds: spam, harmful, misleading, broken, contest (contest needs a reason). |
| GET | `/v1/export` | Public aggregates, for mirrors and federation. |
| GET | `/v1/admin/queue` | Bearer `BEACON_ADMIN_TOKEN`. |
| POST | `/v1/admin/review` | `{ url, action: "restore" or "remove" }`. Bearer token required. |

## Tests

The tests run against a real Postgres, which they wipe:

```sh
BEACON_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/beacons npm test --workspace @intoponet/beacon-registry
```

The HTTP boundary tests use a local mock registry and need no database:

```sh
npm run test --workspace @intoponet/beacon-registry -- src/http.test.ts src/functionHttp.test.ts
```
