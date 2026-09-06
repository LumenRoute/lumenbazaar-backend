# LumenBazaar Backend Implementation Plan

Source document: `../LUMENBAZAAR_FULL_PROJECT_DOCUMENTATION.md`

Repo role: the core infrastructure repository containing the x402 facilitator, Bazaar discovery API, MCP server, SDK packages, workers, examples, conformance runner, metrics, and shared service contracts.

Primary stack:

- Node.js
- TypeScript
- Fastify or NestJS
- PostgreSQL
- Redis
- BullMQ
- Prisma or Drizzle
- PostgreSQL full-text search first, with Meilisearch, Typesense, or pgvector as later options
- `@x402/stellar`
- Stellar SDK

Target layout:

```txt
apps/
  api/
  worker/
  mcp-server/
  examples/
    paid-weather-api/
    paid-rag-api/
    paid-mcp-tool/

packages/
  shared/
  seller-sdk/
  buyer-sdk/
  stellar-payments/
  testkit/
```

Implementation rules:

- Keep the exact x402 flow contract-free where Stellar/Soroban auth entries and Stellar Asset Contract support are sufficient.
- Use `@x402/stellar` for Stellar payment handling instead of reimplementing core settlement logic.
- Store receipts and settlement evidence, never private keys.
- Prefer testnet acceptance before mainnet.
- Every failure path must return a stable machine-readable error code.
- Keep SDKs in this repo first; split them into a future `lumenbazaar-sdk` repo only if they grow.

## Phase 1: Repository Foundation

Parts:

- Scaffold a TypeScript monorepo.
- Add package manager workspaces.
- Add base lint, format, test, and typecheck scripts.
- Add `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, PR template, issue template, and CI.

Completion check:

- Fresh clone can install dependencies and run all base checks.

## Phase 2: Application Skeletons

Parts:

- Create `apps/api`.
- Create `apps/worker`.
- Create `apps/mcp-server`.
- Create examples folder.
- Create shared packages folder.

Completion check:

- Each app can start with a placeholder health response or CLI message.

## Phase 3: Configuration System

Parts:

- Define environment variables.
- Validate configuration with Zod or equivalent.
- Support `local`, `testnet`, `staging`, and `mainnet`.
- Add network configuration for `stellar:testnet` and `stellar:pubnet`.
- Add default USDC configuration.

Completion check:

- Bad configuration fails at startup with a clear error.

## Phase 4: Docker Compose

Parts:

- Add local PostgreSQL.
- Add local Redis.
- Add optional local search service if selected.
- Add backend API and worker service definitions.
- Add `.env.example`.

Completion check:

- Backend dependencies can run locally from Docker Compose.

## Phase 5: Shared Package

Parts:

- Create `packages/shared`.
- Add shared network constants.
- Add shared API response envelope types.
- Add shared error code definitions.
- Add shared pagination and cursor types.

Completion check:

- API, worker, MCP server, and SDK packages can import shared types.

## Phase 6: Database Foundation

Parts:

- Choose Prisma or Drizzle.
- Add migration system.
- Add base database client.
- Add test database setup.

Completion check:

- Empty database can run migrations successfully.

## Phase 7: Core Database Tables

Parts:

- Add `sellers`.
- Add `seller_domains`.
- Add `resources`.
- Add `resource_versions`.
- Add `resource_schemas`.
- Add `payment_requirements`.

Completion check:

- Resource and seller records can be created and queried in integration tests.

## Phase 8: Payment Database Tables

Parts:

- Add `payment_attempts`.
- Add `settlements`.
- Add `receipts`.
- Add payment hash uniqueness constraints.
- Add indexes for network, seller, resource, and status.

Completion check:

- Replayed payment hashes cannot be persisted twice.

## Phase 9: Discovery And Operations Tables

Parts:

- Add `catalog_events`.
- Add `mcp_servers`.
- Add `mcp_tools`.
- Add `search_documents`.
- Add `conformance_runs`.
- Add `network_status`, `api_clients`, `rate_limit_events`, `audit_logs`, and `operator_configs`.

Completion check:

- Discovery, MCP, conformance, and operations records have migrations and tests.

## Phase 10: API Server Base

Parts:

- Add Fastify or NestJS server.
- Add request IDs.
- Add structured logging.
- Add JSON schema validation.
- Add central error handler.

Completion check:

- All API errors use a consistent response shape.

## Phase 11: Health And Metadata Endpoints

Parts:

- Implement `GET /health`.
- Implement `GET /version`.
- Implement `GET /metrics`.
- Implement `GET /v1/networks`.

Completion check:

- Local checks can verify API health, version, metrics, and supported networks.

## Phase 12: Stellar Client Layer

Parts:

- Create `packages/stellar-payments`.
- Add RPC client factory.
- Add Horizon client factory if needed.
- Add network passphrase handling.
- Add asset configuration lookup.

Completion check:

- Testnet and pubnet clients are selected from explicit network configuration.

## Phase 13: Facilitator `/supported`

Parts:

- Implement `GET /v1/supported`.
- Return supported schemes, networks, and assets.
- Include exact scheme support.
- Reserve versioned extension fields for future `upto` support.

Completion check:

- `/supported` output matches x402 conformance expectations.

## Phase 14: Payment Payload Model

Parts:

- Define x402 payment payload schema.
- Define Stellar exact scheme validation schema.
- Validate amount, asset, recipient, network, expiry, and authorization fields.
- Normalize malformed input into stable errors.

Completion check:

- Invalid payload tests return `INVALID_PAYMENT_PAYLOAD` or a more specific code.

## Phase 15: Exact Payment Verification

Parts:

- Implement `PaymentVerificationService`.
- Use `@x402/stellar` for Stellar verification.
- Reject unsupported networks.
- Reject unsupported assets.
- Reject wrong recipient, wrong amount, and expired auth entries.

Completion check:

- `POST /v1/verify` accepts valid testnet exact payments and rejects invalid ones.

## Phase 16: Replay Protection

Parts:

- Compute or extract stable payment hash.
- Store payment attempts before settlement.
- Add uniqueness enforcement.
- Return `REPLAY_DETECTED` for reused payment payloads.

Completion check:

- Replaying the same payment payload fails deterministically.

## Phase 17: Exact Payment Settlement

Parts:

- Implement `SettlementService`.
- Submit valid settlement transaction through Stellar tooling.
- Persist settlement status.
- Capture transaction hash and ledger.
- Handle trustline and network failures.

Completion check:

- `POST /v1/settle` settles a valid testnet exact payment and returns transaction evidence.

## Phase 18: Receipt Service

Parts:

- Create `ReceiptService`.
- Persist receipt ID, payment attempt, settlement status, transaction hash, amount, asset, network, seller, and resource.
- Add `GET /v1/receipts/:receiptId`.
- Add receipt finalization hook.

Completion check:

- Successful settlements produce retrievable receipts.

## Phase 19: Stable Error Code System

Parts:

- Implement all documented error codes.
- Map validation, x402, Stellar, database, and rate-limit failures.
- Include human-readable message and machine-readable code.
- Avoid leaking secrets in errors.

Completion check:

- Every failed verification and settlement returns a stable code.

## Phase 20: Seller Service

Parts:

- Implement `SellerService`.
- Add `POST /v1/sellers`.
- Add `GET /v1/sellers/:sellerId`.
- Add seller wallet and display name validation.

Completion check:

- Seller records can be created and fetched through the API.

## Phase 21: Seller Domain Verification

Parts:

- Add domain verification challenge model.
- Implement `POST /v1/sellers/:sellerId/verify-domain`.
- Support well-known file or DNS challenge flow.
- Record `domainVerifiedAt`.

Completion check:

- Unverified sellers cannot publish trusted catalog metadata.

## Phase 22: Resource CRUD

Parts:

- Implement `GET /v1/resources`.
- Implement `POST /v1/resources`.
- Implement `GET /v1/resources/:id`.
- Implement `PATCH /v1/resources/:id`.
- Implement `DELETE /v1/resources/:id`.

Completion check:

- Resource lifecycle works with seller ownership checks.

## Phase 23: Discovery Metadata Schema

Parts:

- Define Bazaar resource metadata schema.
- Support HTTP endpoints.
- Support MCP tools.
- Version metadata.
- Store input and output schemas.

Completion check:

- Metadata validation can distinguish valid HTTP resources and valid MCP tools.

## Phase 24: Route Template Validation

Parts:

- Validate route template syntax.
- Reject traversal and malformed templates.
- Match URL path parameters to schema where possible.
- Return `ROUTE_TEMPLATE_INVALID` for failures.

Completion check:

- Route poisoning attempts are rejected in tests.

## Phase 25: Catalog Validation

Parts:

- Implement `CatalogValidationService`.
- Implement `POST /v1/discovery/validate`.
- Validate seller domain ownership.
- Validate payment requirements and schemas.
- Return non-mutating validation results.

Completion check:

- Sellers can check metadata before publishing.

## Phase 26: Cataloging

Parts:

- Implement `POST /v1/discovery/catalog`.
- Persist versioned resource metadata.
- Write catalog event logs.
- Reject forged seller metadata.
- Queue indexing jobs.

Completion check:

- Valid resources are cataloged and invalid resources are rejected with stable reasons.

## Phase 27: Discovery Browse

Parts:

- Implement `GET /v1/discovery/resources`.
- Add pagination.
- Add filters for network, asset, type, seller, price, and extension.
- Return deterministic metadata.

Completion check:

- Frontend can browse cataloged resources through the discovery API.

## Phase 28: Search Index V1

Parts:

- Implement `SearchService`.
- Start with PostgreSQL full-text search.
- Index name, description, seller, type, schemas, network, asset, and quality fields.
- Add result ranking fields.

Completion check:

- Search returns ranked resources for natural language-like queries.

## Phase 29: Search Endpoint

Parts:

- Implement `GET /v1/discovery/search`.
- Support query, filters, limit, and cursor.
- Return `partialResults` when indexing or ranking is incomplete.
- Include ranking metadata.

Completion check:

- Search supports query and filters expected by frontend and MCP clients.

## Phase 30: Worker Foundation

Parts:

- Configure BullMQ.
- Add queue naming.
- Add worker lifecycle and graceful shutdown.
- Add retry and dead-letter policies.

Completion check:

- Worker app can process a test job locally.

## Phase 31: Settlement Confirmation Worker

Parts:

- Add `settlement-confirmation-worker`.
- Poll or subscribe for transaction confirmation.
- Update settlement and receipt status.
- Record ledger information.

Completion check:

- Settled payments become finalized after confirmation.

## Phase 32: Resource Indexing Workers

Parts:

- Add `resource-indexing-worker`.
- Add `search-sync-worker`.
- Rebuild resource search documents.
- Track cataloging outcomes.

Completion check:

- Cataloged resources become searchable through async indexing.

## Phase 33: Network And Cleanup Workers

Parts:

- Add `network-health-worker`.
- Add `receipt-finalizer-worker`.
- Add `stale-payment-cleanup-worker`.
- Persist network status for operator dashboards.

Completion check:

- Operator status endpoints reflect backend dependency health.

## Phase 34: Seller SDK Package

Parts:

- Create `@lumenbazaar/seller-sdk`.
- Add Express middleware.
- Add Fastify middleware.
- Add Next.js route helper.
- Add x402 payment requirement builder.
- Add Bazaar metadata builder and parser.

Completion check:

- Example seller endpoint can return 402 payment requirements with minimal code.

## Phase 35: Seller SDK Validation Helpers

Parts:

- Add route template validation helper.
- Add schema validation helper.
- Add MCP tool metadata helper.
- Add cataloging response parser.

Completion check:

- Seller SDK catches common metadata mistakes before API submission.

## Phase 36: Buyer SDK Package

Parts:

- Create `@lumenbazaar/buyer-sdk`.
- Add search resources helper.
- Add inspect payment terms helper.
- Add prepare payment payload helper.
- Add verify and settle helpers.

Completion check:

- Buyer SDK can discover and inspect resources.

## Phase 37: Buyer SDK Paid Call Flow

Parts:

- Add retry-paid-request helper.
- Add receipt fetch helper.
- Add local budget limits.
- Add stable error mapping.

Completion check:

- Buyer SDK can run search, pay, retry, settle, and receipt flow on testnet.

## Phase 38: Testkit Package ✓

Parts:

- Create `@lumenbazaar/testkit`. ✓
- Add mock facilitator. ✓
- Add fake 402 response generator. ✓
- Add payment payload fixtures. ✓
- Add discovery metadata fixtures. ✓
- Add conformance fixtures. ✓

Completion check:

- SDKs, frontend, examples, and backend tests can share deterministic fixtures. ✓

## Phase 39: MCP Server Foundation ✓

Parts:

- Scaffold `apps/mcp-server`. ✓
- Add shared backend client. ✓
- Add deterministic tool registration. ✓
- Add structured MCP errors. ✓

Completion check:

- MCP server starts locally and lists available tools. ✓

## Phase 40: MCP Discovery Tools ✓

Parts:

- Implement `search_paid_resources`. ✓
- Implement `inspect_resource`. ✓
- Implement `list_supported_networks`. ✓
- Return schemas and payment requirements. ✓

Completion check:

- Agent can search and inspect paid resources through MCP. ✓

## Phase 41: MCP Payment Tools

Parts:

- Implement `prepare_payment`.
- Implement `call_paid_resource`.
- Implement `get_payment_receipt`.
- Implement `inspect_budget`.
- Enforce local budget caps.

Completion check:

- Agent can call a paid testnet resource and receive result plus receipt.

## Phase 42: Example Paid Weather API

Parts:

- Build `apps/examples/paid-weather-api`.
- Use seller SDK middleware.
- Publish Bazaar metadata.
- Add buyer SDK test call.

Completion check:

- Weather example demonstrates a full testnet exact payment.

## Phase 43: Example Paid RAG API

Parts:

- Build `apps/examples/paid-rag-api`.
- Define input and output schemas.
- Add per-request pricing.
- Add receipt verification example.

Completion check:

- RAG example demonstrates API monetization with x402 terms.

## Phase 44: Example Paid MCP Tool

Parts:

- Build `apps/examples/paid-mcp-tool`.
- Add MCP metadata.
- Register tool in discovery.
- Add MCP client test.

Completion check:

- Paid MCP example can be discovered and called through LumenBazaar MCP.

## Phase 45: Conformance Runner

Parts:

- Implement conformance test definitions.
- Test `/supported`.
- Test `/verify`.
- Test `/settle`.
- Record exact scheme results.
- Reserve `upto` test slots.

Completion check:

- Conformance runs are persisted and queryable from `/v1/conformance/runs`.

## Phase 46: OpenAPI Generation

Parts:

- Generate OpenAPI spec from API routes.
- Publish JSON and markdown artifacts.
- Add schema sync check in CI.
- Support docs repo consumption.

Completion check:

- Docs can import or reference current API contracts.

## Phase 47: Rate Limiting And Audit Logs

Parts:

- Add rate limiting for facilitator, discovery, and seller endpoints.
- Record rate-limit events.
- Add audit logs for cataloging, verification, settlement, and domain verification.
- Avoid sensitive payload logging.

Completion check:

- Abuse-sensitive endpoints are protected and observable.

## Phase 48: Metrics And Monitoring

Parts:

- Emit API uptime metrics.
- Emit verify and settle latency metrics.
- Emit RPC error metrics.
- Emit settlement success rate.
- Emit queue depth and search latency metrics.

Completion check:

- `/metrics` exposes the data required by operator and public metrics dashboards.

## Phase 49: Security Regression Tests

Parts:

- Test forged seller metadata.
- Test forged route templates.
- Test replay attacks.
- Test expired auth entry reuse.
- Test wrong asset and recipient settlement.
- Test search index poisoning.

Completion check:

- Documented threats have targeted regression coverage.

## Phase 50: Upto Session Backend Integration

Parts:

- Add `upto` scheme feature flag.
- Integrate generated contract bindings.
- Add payment session APIs after contract deployment is available.
- Add settlement up to capped amount.
- Add `upto` conformance tests.

Completion check:

- Backend supports exact payments and capped `upto` sessions without mixing their validation paths.

## Phase 51: Load Tests ✓

Parts:

- Add verify endpoint load tests. ✓
- Add settle endpoint load tests. ✓
- Add search endpoint load tests. ✓
- Add worker throughput tests. ✓

Completion check:

- Performance baselines are recorded for testnet and staging. ✓

## Phase 52: Testnet Deployment

Parts:

- Deploy API.
- Deploy worker.
- Deploy MCP server.
- Configure testnet Stellar RPC and Horizon.
- Configure Postgres, Redis, and search.
- Publish testnet endpoint URLs.

Completion check:

- End-to-end seller, buyer, discovery, MCP, and receipt flows work on testnet.

## Phase 53: Mainnet Readiness

Parts:

- Review asset and trustline configuration.
- Review signer and key management guidance.
- Add production rate limits.
- Run conformance against mainnet configuration.
- Verify monitoring and incident response hooks.

Completion check:

- Mainnet launch is blocked only by explicit operational and security approval, not missing implementation.

## Phase 54: Maintenance

Parts:

- Maintain compatibility with x402 spec updates.
- Keep SDKs aligned with API schema changes.
- Track upstream Stellar tooling updates.
- Add regression tests for each production incident or bug.

Completion check:

- Backend remains self-hostable, testable, and aligned with frontend, contracts, and docs.
