# Phase 24 Testnet Exact Flow Gate

Status: blocked on hosted deployment and funded testnet identities.

The local implementation and release tooling are ready, but Gate B is not complete. The endpoint
manifest remains `template`, so no public API, worker, MCP, Postgres, Redis, paid-resource, migration
run, external exact payment, restart, or transaction evidence is claimed. Maintainer deployment is
tracked in [GitHub issue 22](https://github.com/LumenRoute/lumenbazaar-backend/issues/22).

Live refresh on 2026-10-07: the configured API `/health` returned HTTP 200, but `/version` reported
`environment: local` with no commit and `/ready` returned HTTP 404. The configured MCP `/health`
returned HTTP 404. These responses are deployment blocker evidence, not Gate B evidence.

## Completed local evidence

- `pnpm check` passes.
- `pnpm audit --prod` reports no production advisories as of 2026-10-07.
- The endpoint manifest requires full service commit SHAs and a separate migration run ID.
- `pnpm deploy:testnet:probe` validates public API, MCP, and paid-resource surfaces.
- `pnpm deploy:testnet:exact` uses the official v2 Stellar client and verifies durable idempotency
  after an operator-confirmed API and worker restart.
- The evidence writer excludes the private key and encoded payment signature.

## Remaining maintainer gate

1. Provision Postgres, Redis, signer secret access, and a funded client/seller testnet setup.
2. Deploy API, worker, MCP, and paid weather services at the recorded commits.
3. Run `pnpm prisma:migrate:deploy` separately and record its provider run ID.
4. Catalog the deployed paid resource and replace every manifest placeholder.
5. Run the public probe, conformance, load smoke, and exact flow from outside the host.
6. Restart API and worker during the exact gate pause, then publish the sanitized evidence.
7. Verify `/v1/supported` still advertises only the exact capability proven by the live flow.
