# LumenBazaar Backend

LumenBazaar Backend is the infrastructure service for the LumenBazaar protocol. It owns the x402 facilitator API, Bazaar discovery API, MCP server, SDK packages, workers, examples, receipts, metrics, and conformance support.

The first implementation keeps SDKs and examples in this repository. They can move to dedicated repositories later if their release cadence diverges from the backend service.

## Stack

- Node.js 24
- TypeScript
- Fastify
- PostgreSQL with Prisma
- Redis with BullMQ
- Stellar SDK
- `@x402/stellar`

## Development

```bash
corepack enable
pnpm install
pnpm check
```

Start local dependencies with:

```bash
docker compose up postgres redis
```

The Compose file also includes API and worker service definitions for full local runs.

Set `CORS_ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins. Pubnet is not
advertised outside a mainnet runtime. Exact and `upto` schemes are also omitted from
`/v1/supported` until the process is started with real runtime adapters; the default exact adapter
fails closed, and testnet `upto` refuses synthetic local bindings.

## Repository Layout

```txt
apps/
  api/
  worker/
  mcp-server/
  examples/
packages/
  shared/
  seller-sdk/
  buyer-sdk/
  stellar-payments/
  testkit/
```

## Security

This repository stores payment receipts and settlement evidence. It must never store Stellar private keys, seed phrases, or wallet secrets.

## Related Repositories

- [Frontend](https://github.com/LumenRoute/lumenbazaar-frontend)
- [Contracts](https://github.com/LumenRoute/lumenbazaar-contracts)
- [Documentation](https://github.com/LumenRoute/lumenbazaar-docs)
