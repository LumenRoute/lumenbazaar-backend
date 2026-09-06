# Testnet Deployment

This runbook deploys the backend API, worker, and MCP server against Stellar testnet. The
deployment owns Postgres, Redis, and the discovery search index used by the API.

## Services

- API: `pnpm start:api`
- Worker: `pnpm start:worker`
- MCP stdio: `pnpm start:mcp`
- MCP Streamable HTTP: `pnpm start:mcp:http`

## Environment

Create `.env.testnet` from `.env.testnet.example` and replace every `.example` URL and placeholder
account before deploying.

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
- `FACILITATOR_ACCOUNT`

Validate the file before rollout:

```bash
pnpm deploy:testnet:check --env-file .env.testnet
```

The committed example file can be checked with placeholders allowed:

```bash
pnpm deploy:testnet:check
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
curl "$API_PUBLIC_URL/v1/supported"
curl "https://mcp.testnet.lumenbazaar.example/health"
```

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
