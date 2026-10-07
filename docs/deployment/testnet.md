# Testnet Deployment

This runbook deploys the backend API, worker, and MCP server against Stellar testnet. The
deployment owns Postgres, Redis, and the discovery search index used by the API.

## Services

- API: `pnpm start:api`
- Worker: `pnpm start:worker`
- MCP stdio: `pnpm start:mcp`
- MCP Streamable HTTP: `pnpm start:mcp:http`

## Environment

`config/testnet.release.env` records the non-secret public release profile and Phase 10 testnet
contract identifiers. Supply deployment secrets, including database credentials and signer access,
through the hosting provider rather than committing them.

Required settings:

- `NODE_ENV=production`
- `LUMEN_ENV=testnet`
- `API_PUBLIC_URL`
- `MCP_PUBLIC_URL`
- `MCP_TRUST_PROXY` (`true` only behind an ingress that replaces client forwarding headers)
- `DATABASE_URL`
- `REDIS_URL`
- `STELLAR_TESTNET_RPC_URL`
- `STELLAR_TESTNET_HORIZON_URL`
- `STELLAR_TESTNET_USDC_ISSUER`
- `STELLAR_TESTNET_USDC_CONTRACT_ID`
- `FACILITATOR_ACCOUNT`
- `FACILITATOR_SIGNER_PROVIDER=environment`
- `FACILITATOR_SIGNER_NETWORK=stellar:testnet`
- `FACILITATOR_SIGNING_KEY_VERSION`
- `STELLAR_MAX_TRANSACTION_FEE_STROOPS` (recommended initial ceiling: `50000`)
- `STELLAR_INCLUSION_FEE_STROOPS` (recommended initial bid: `100`)

Store `FACILITATOR_SIGNING_KEY` only in the hosting provider's secret manager. It is intentionally
absent from `config/testnet.release.env`. Follow
[`docs/security/facilitator-signer.md`](../security/facilitator-signer.md) for provisioning,
rotation, revocation, and incident handling.

Validate the file before rollout:

```bash
pnpm deploy:testnet:check
```

The placeholder template can be checked separately for schema completeness:

```bash
pnpm deploy:testnet:check:example
```

To validate the Compose topology before creating `.env.testnet`, point the service env file at the
committed example:

```bash
LUMEN_ENV_FILE=.env.testnet.example docker compose --env-file .env.testnet.example -f docker-compose.testnet.yml config
```

## Docker Compose

```bash
docker compose --env-file .env.testnet -f docker-compose.testnet.yml build
docker compose --env-file .env.testnet -f docker-compose.testnet.yml up -d postgres redis
docker compose --env-file .env.testnet -f docker-compose.testnet.yml run --rm api pnpm prisma:migrate:deploy
docker compose --env-file .env.testnet -f docker-compose.testnet.yml up -d api worker mcp-server
```

Health checks:

```bash
curl "$API_PUBLIC_URL/health"
curl "$API_PUBLIC_URL/ready"
curl "$API_PUBLIC_URL/version"
curl "$API_PUBLIC_URL/metrics"
curl "$API_PUBLIC_URL/v1/supported"
curl "https://lumenbazaar-mcp.onrender.com/health"
curl "https://lumenbazaar-mcp.onrender.com/metrics"
curl "https://lumenbazaar-mcp.onrender.com/ready"
curl "https://lumenbazaar-mcp.onrender.com/version"
curl "https://lumenbazaar-mcp.onrender.com/schema"
curl "$PAID_RESOURCE_PUBLIC_URL/health"
curl "$PAID_RESOURCE_PUBLIC_URL/ready"
curl "$PAID_RESOURCE_PUBLIC_URL/version"
curl "$PAID_RESOURCE_PUBLIC_URL/metrics"
```

`/health` is process liveness only. `/ready` returns HTTP 503 unless Postgres, Redis, migrations,
the active Stellar RPC and Horizon endpoints, configured assets, and any required signer are ready.
The supported-schemes response uses the same evaluated state and cannot advertise a payment adapter
whose dependencies are unavailable.

The MCP service advertises discovery and receipt tools only while its backend is ready, and
advertises payment preparation and paid-call tools only while the backend reports the official
exact capability. Its HTTP boundary rate-limits callers, caps declared request bodies, does not
publish OAuth metadata, never forwards caller credentials, and pins paid calls to the resource URL
stored in the catalog.

## Endpoint Manifest

Publish the current testnet URLs in `docs/deployment/testnet-endpoints.json` after DNS and ingress
are configured. The docs repository can import that manifest directly or copy the values into
Mintlify pages.

## Post-Deployment Checks

Replace every placeholder in `docs/deployment/testnet-endpoints.json`, set `status` to `deployed`,
record the full Git SHA for each service and the hosting provider's separate migration run ID, then
run the public probe from outside the hosting environment:

```bash
pnpm deploy:testnet:probe -- --output deployment-evidence/testnet-probe.json
```

The probe fails unless API, MCP, and paid-resource health, readiness, version, and metrics endpoints
are public; deployed version endpoints match the pinned commits; exact testnet is advertised; MCP
advertises its paid-call tool; and the paid resource returns a canonical v2 `PAYMENT-REQUIRED`.

Fund a separate testnet client account with the configured asset and supply its secret only through
the operator's secret environment. The exact gate creates the authorization with the official
`@x402/stellar` client, executes `402 -> sign -> verify -> retry -> settle -> receipt`, and pauses
without writing the replayable signature. Restart the pinned API and worker while it is paused, wait
for readiness, then press Enter:

```bash
CLIENT_PRIVATE_KEY="$CLIENT_PRIVATE_KEY" pnpm deploy:testnet:exact
```

The gate retrieves the same receipt and repeats settlement with the in-memory authorization. It
fails if the receipt or transaction identity changes. The generated evidence contains only a hash
of the authorization, public transaction/receipt facts, commit pins, and probe results. Review it
before publication; never publish the client secret or encoded `PAYMENT-SIGNATURE`.

Run conformance:

```bash
curl -X POST "$API_PUBLIC_URL/v1/conformance/runs" \
  -H "content-type: application/json" \
  -d '{"network":"stellar:testnet","includeReserved":true}'
```

Run load baselines:

```bash
pnpm load:test \
  --environment testnet \
  --base-url "$API_PUBLIC_URL" \
  --targets verify,settle,search,worker \
  --requests 200 \
  --concurrency 10 \
  --verify-template docs/performance/exact-payment-template.json \
  --settle-template docs/performance/exact-payment-template.json \
  --output load-results/testnet.json
```

Check the matching metrics snapshot:

```bash
curl "$API_PUBLIC_URL/metrics"
```

## Search

The testnet API serves discovery search from the resource catalog and search index. No separate
search container is required for this backend deployment. Run the worker beside the API so
`resource-indexing` and `search-sync` queues continue to refresh indexed metadata.

## Testnet Example Catalog

Deploy the weather, RAG, and MCP example applications with these start commands:

```bash
pnpm --filter @lumenbazaar/example-paid-weather-api start
pnpm --filter @lumenbazaar/example-paid-rag-api start
pnpm --filter @lumenbazaar/example-paid-mcp-tool start
```

Create one seller record for each deployment hostname and complete its domain challenge. Catalog
publication rejects unverified sellers, non-HTTPS targets, IP or local hostnames, URLs outside the
seller domain, route mismatches, and oversized or deeply nested schemas. Once the sellers and
public URLs exist, validate, publish, inspect, browse, and search all three records in one gate:

```bash
API_BASE_URL="$API_PUBLIC_URL" \
WEATHER_RESOURCE_BASE_URL="$WEATHER_PUBLIC_URL" \
WEATHER_SELLER_ID="$WEATHER_SELLER_ID" \
RAG_RESOURCE_BASE_URL="$RAG_PUBLIC_URL" \
RAG_SELLER_ID="$RAG_SELLER_ID" \
MCP_RESOURCE_BASE_URL="$MCP_RESOURCE_PUBLIC_URL" \
MCP_SELLER_ID="$MCP_SELLER_ID" \
pnpm catalog:testnet:seed
```

The command exits nonzero unless every metadata document validates, all three resources are
cataloged and inspectable, and both browse and search return the new durable records. The paid
weather and MCP examples also expose clean buyer SDK calls for the official exact verification,
paid retry, settlement, and receipt sequence. Do not record the phase as live evidence until one
of those calls completes against the public testnet services without fixture substitution.
