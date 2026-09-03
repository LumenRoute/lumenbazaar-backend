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

Local services are defined in `docker-compose.yml` once the database and worker layers are enabled.

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
