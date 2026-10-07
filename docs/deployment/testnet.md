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
curl "$API_PUBLIC_URL/v1/supported"
curl "https://lumenbazaar-mcp.onrender.com/health"
```

`/health` is process liveness only. `/ready` returns HTTP 503 unless Postgres, Redis, migrations,
the active Stellar RPC and Horizon endpoints, configured assets, and any required signer are ready.
The supported-schemes response uses the same evaluated state and cannot advertise a payment adapter
whose dependencies are unavailable.

## Endpoint Manifest

Publish the current testnet URLs in `docs/deployment/testnet-endpoints.json` after DNS and ingress
are configured. The docs repository can import that manifest directly or copy the values into
Mintlify pages.

## Post-Deployment Checks

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
