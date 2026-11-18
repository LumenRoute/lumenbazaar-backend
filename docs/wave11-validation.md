# Wave 11 integration validation

This branch merges four independent issue branches for #95, #97, #105 and #107.

- pnpm 10.28.0 frozen install: passed; Node 24.22.1.
- New focused coverage: 9 tests passed (UTF-8/escaped payload limits, oversized
  worker job rejection, URL normalization/rejection, snapshot stability/query
  validation/expiry, hash chaining and audit error propagation).
- Prisma schema validation: passed.
- Full pnpm check: attempted; fails at existing repository formatting debt
  (109 files). The initial checkout also had stale generated OpenAPI artifacts;
  artifacts were regenerated in this integration.
- Independent lint: 147 repository errors.
- Untouched develop typecheck: 232 errors. Integration initially 222 errors;
  introduced display URL and error-map typing issues were subsequently corrected.
- Full test suite: executed separately; numerous existing asset configuration,
  payment fixture and integration dependency failures. See local validation logs.
- Migration verification: blocked by existing Unix shell assignment syntax on
  Windows; database execution of the new migrations is not claimed.

Limitations requiring reviewer attention:
- Search snapshots are process-local and bounded (100 snapshots / 10,000 rows,
  five-minute TTL); restart or routing to another instance requires restarting
  traversal. Initial capture is not MVCC; subsequent traversal is immutable.
- Audit coverage targets existing resource status/update/rollback operations.
  No new admin endpoint or permission is introduced. A database owner can bypass
  append-only triggers, so external chain-head anchoring is recommended.
- URL migration is additive; run the read-only audit before any historical
  backfill. Existing records are not automatically rewritten or deduplicated.

This is ready for maintainer review, but the repository-wide gate is not green.
Do not interpret focused tests as proof that all repository checks passed.
