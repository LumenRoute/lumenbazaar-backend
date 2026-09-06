# Load Test Baselines

The backend load runner covers the facilitator verify path, settlement path, discovery search,
and local worker throughput. Generated reports belong in `load-results/` and are ignored by git
because they contain environment-specific URLs, timing, and operational details.

## Runner

```bash
pnpm load:test --targets verify,settle,search,worker --requests 100 --concurrency 10 --output load-results/local.json
```

Useful options:

- `--base-url`: API origin to test. Defaults to `http://localhost:3000`.
- `--environment`: Baseline label such as `local`, `staging`, or `testnet`.
- `--targets`: Comma-separated target list: `verify`, `settle`, `search`, `worker`.
- `--verify-template`: JSON template for `/v1/verify`.
- `--settle-template`: JSON template used to create a payment attempt before `/v1/settle`.
- `--search-query`: Query used against `/v1/discovery/search`.

Templates may contain `{runId}`, `{target}`, `{index}`, and `{paymentHash}` placeholders. The
runner always injects a unique `paymentHash` into `paymentPayload` so replay protection is
exercised during verify and settle tests.

## Staging Baseline

```bash
pnpm load:test \
  --environment staging \
  --base-url https://api.staging.lumenbazaar.example \
  --targets verify,settle,search,worker \
  --requests 500 \
  --concurrency 25 \
  --verify-template docs/performance/exact-payment-template.json \
  --settle-template docs/performance/exact-payment-template.json \
  --output load-results/staging.json
```

Required record fields from `load-results/staging.json`:

- `runId`
- backend commit SHA
- API URL
- target summaries for `verify`, `settle`, `search`, and `worker`
- `ok`, `failed`, `requestsPerSecond`, and `latencyMs.p95` for each target
- operational notes for rate limits, RPC errors, and queue depth during the run

## Testnet Baseline

```bash
pnpm load:test \
  --environment testnet \
  --base-url https://api.testnet.lumenbazaar.example \
  --targets verify,settle,search,worker \
  --requests 200 \
  --concurrency 10 \
  --verify-template docs/performance/exact-payment-template.json \
  --settle-template docs/performance/exact-payment-template.json \
  --output load-results/testnet.json
```

Testnet runs require funded Stellar testnet accounts, trustlines for the configured asset, and
valid authorization payloads compatible with the deployed facilitator configuration. If settlement
returns failures, keep the report and attach the matching `/metrics` snapshot so RPC and adapter
errors are visible.

## Acceptance Gates

- `verify`, `settle`, and `search` must complete without unhandled runner errors.
- Each HTTP target must report status-code counts and latency percentiles.
- Worker throughput must process the requested number of local jobs.
- Staging and testnet baselines must be refreshed after endpoint, adapter, queue, or rate-limit
  changes.
