# Catalog Soft-Delete and Purge Policy

## Overview

When a seller deletes a catalog resource, the resource enters a **soft-deleted** state rather than being immediately purged from the database. This policy protects settlement records and payment evidence while providing a bounded restoration window for accidental deletions.

## Restoration Window

**Duration**: 30 days (from `RESOURCE_RESTORATION_WINDOW_MS` in `packages/shared/src/restorationPolicy.ts`)

Deleted resources can be restored by their owner only within this window. After the window expires, resources are permanently purged by the worker.

### Calculation

```
Soft-deleted at: 2024-01-10 14:00:00 UTC
Restoration deadline: 2024-02-09 14:00:00 UTC (now + 30 days)
```

Restoration is allowed only if:
- `restoreDeadline > now()`
- Caller is the resource owner
- Resource is not already purged

## Soft-Delete Process

### Endpoint

```http
DELETE /v1/resources/:id
If-Match: <version>
```

**Prerequisites**:
- Caller must be the resource owner (authenticated via API key)
- Request must include `If-Match` header with current resource version (optimistic concurrency)

**Response** (on success):
```json
{
  "id": "resource_abc123",
  "sellerId": "seller_xyz",
  "status": "active",
  "version": 2,
  "deletedAt": "2024-01-10T14:00:00Z",
  "deletedBy": "seller_xyz",
  "restoreDeadline": "2024-02-09T14:00:00Z",
  "purgedAt": null
}
```

**Error Responses** (distinct error codes):

- `FORBIDDEN`: Caller does not own the resource
- `RESOURCE_VERSION_CONFLICT`: Optimistic concurrency conflict (version mismatch)
- `RESOURCE_NOT_FOUND`: Resource does not exist

### Schema Changes

| Column | Type | Purpose |
|--------|------|---------|
| `deletedAt` | `TIMESTAMP` | When the resource was soft-deleted (NULL if not deleted) |
| `deletedBy` | `TEXT` | Seller ID that deleted the resource |
| `restoreDeadline` | `TIMESTAMP` | Deadline after which restoration is no longer allowed |
| `purgedAt` | `TIMESTAMP` | When the resource was permanently purged (NULL if not purged) |

Indexes support efficient queries for:
- Finding deleted resources: `@@index([deletedAt])`
- Finding expiring/expired resources: `@@index([restoreDeadline])`
- Batched purge queries: `@@index([status, restoreDeadline])`

## Restoration Process

### Endpoint

```http
POST /v1/resources/:id/restore
If-Match: <version>
```

**Prerequisites**:
- Resource must be soft-deleted (`deletedAt IS NOT NULL`)
- Restoration deadline must not have expired (`restoreDeadline > now()`)
- Resource must not be purged (`purgedAt IS NULL`)
- Caller must be the resource owner
- Request must include `If-Match` header with current resource version

**Response** (on success):
```json
{
  "id": "resource_abc123",
  "sellerId": "seller_xyz",
  "status": "active",
  "version": 3,
  "deletedAt": null,
  "deletedBy": null,
  "restoreDeadline": null,
  "purgedAt": null
}
```

**Error Responses** (distinct error codes):

- `VALIDATION_FAILED`: Resource is not soft-deleted
- `RESTORE_WINDOW_EXPIRED`: Restoration window has expired
- `RESOURCE_PURGED`: Resource has been permanently purged
- `FORBIDDEN`: Caller does not own the resource
- `RESOURCE_VERSION_CONFLICT`: Optimistic concurrency conflict
- `RESOURCE_NOT_FOUND`: Resource does not exist

## Purge Process

### Schedule

The purge worker runs as a recurring job to permanently purge expired resources. It can also be invoked manually via:

```bash
# Manually enqueue a purge job (implementation-specific)
```

### Batched Purge Algorithm

**Batch Size**: 100 resources per job (configurable via `PURGE_BATCH_SIZE`)

**Ordering** (deterministic and stable):
1. Primary: `restoreDeadline` ascending (oldest first)
2. Secondary: `id` ascending (for stability)

**Process**:
1. Query up to 100 soft-deleted resources past their `restoreDeadline`
2. For each resource:
   - Update atomically only if still in soft-deleted state (`deletedAt IS NOT NULL, purgedAt IS NULL`)
   - Set `purgedAt = now()` (mark as purged)
   - Tombstone catalog data (see below)
   - Mark search documents as stale
3. Log purge metrics: batch size, purged count, skipped, failed
4. If batch is full, schedule next job (resumable pagination)

### Idempotency

The purge worker is idempotent:
- Conditional updates prevent double-purging
- Re-running a job or handling overlapping runs cannot fail or corrupt data
- Attempt to purge already-purged resource is a no-op

### Settlement Evidence Preservation

Resources are never cascade-deleted; settlement and receipt records remain intact. Instead, catalog data is **tombstoned**:

**Before Purge**:
```json
{
  "name": "Private Payment API",
  "description": "Handles user PII",
  "url": "https://private.example.com/pay",
  "inputSchema": {"apiKey": {"type": "string"}, "email": {"type": "string"}},
  "outputSchema": {...}
}
```

**After Purge** (all fields redacted):
```json
{
  "name": "[Purged]",
  "description": "[Purged]",
  "url": "https://removed/",
  "displayUrl": "[Purged]",
  "inputSchema": {},
  "outputSchema": {},
  "extensions": {},
  "deletedAt": null,
  "deletedBy": null,
  "restoreDeadline": null,
  "purgedAt": "2024-02-10T14:00:00Z"
}
```

**Why**: Payment attempts, settlements, and receipts reference resources by `resourceId`. Settlement processes need to verify that evidence (e.g., `transactionHash`, `ledger`, amount) still exists and can be traced. Purging only the catalog data while preserving the foreign key allows audits to reconstruct payment history even after resource deletion.

## Observability

### Logging

**Soft-Delete**:
```json
{"event": "resource.soft_delete", "resourceId": "...", "sellerId": "...", "restoreDeadline": "..."}
```

**Restore**:
```json
{"event": "resource.restore", "resourceId": "...", "sellerId": "...", "restoredAt": "..."}
```

**Purge Batch** (per job):
```json
{
  "event": "resource.purge.batch",
  "batchSize": 100,
  "purgedCount": 98,
  "skippedCount": 2,
  "failedCount": 0,
  "resources": ["id1", "id2", ...],
  "failures": null
}
```

### Metrics

- `resource.purge.batch_size`: Histogram of batch sizes processed
- `resource.purge.total`: Counter of total resources purged
- `resource.purge.skipped`: Counter of skipped (concurrent modification)
- `resource.purge.failures`: Counter of purge failures

## Authorization

### Soft-Delete
- Requires seller API key with scope including resource management
- Owner validation: caller's `sellerId` must match resource owner
- Failure: `FORBIDDEN`

### Restore
- Requires seller API key with scope including resource management
- Owner validation: caller's `sellerId` must match resource owner
- Failure: `FORBIDDEN`

### Purge (Worker)
- No authorization check (system/worker privilege)
- Runs as internal service

## Migration Notes

For existing deployments:

1. **Deploy migration** (`prisma migrate deploy`):
   - Adds 4 columns: `deletedAt`, `deletedBy`, `restoreDeadline`, `purgedAt`
   - Adds 3 indexes for query performance
   - No data corruption; all columns default to NULL

2. **Deploy API and worker code**:
   - New endpoints become available immediately
   - Worker picks up purge jobs from queue

3. **Enable purge jobs** (operations):
   - Configure purge job schedule (e.g., daily or hourly)
   - Monitor first batches for any anomalies

## Examples

### Example 1: Delete and Restore Within Window

```bash
# Delete (soft)
curl -X DELETE \
  https://api.example.com/v1/resources/resource_abc \
  -H "Authorization: Bearer seller_key" \
  -H "If-Match: 1"

# Response (2 hours later, within 30-day window)
{
  "deletedAt": "2024-01-10T14:00:00Z",
  "restoreDeadline": "2024-02-09T14:00:00Z",
  "version": 2
}

# Restore
curl -X POST \
  https://api.example.com/v1/resources/resource_abc/restore \
  -H "Authorization: Bearer seller_key" \
  -H "If-Match: 2"

# Response
{
  "deletedAt": null,
  "restoreDeadline": null,
  "version": 3
}
```

### Example 2: Purge After Window Expiry

```bash
# (30+ days later) Worker purges automatically
{
  "event": "resource.purged",
  "resourceId": "resource_abc",
  "sellerId": "seller_xyz",
  "deadline": "2024-02-09T14:00:00Z",
  "purgedAt": "2024-02-10T14:00:00Z"
}

# Settlement records remain; catalog data is tombstoned
SELECT "settlementId" FROM "Settlement"
WHERE "paymentAttemptId" IN (
  SELECT id FROM "PaymentAttempt" WHERE "resourceId" = 'resource_abc'
)
-- Returns rows; settlement is not deleted
```

## Testing

### Test Coverage

- **Soft-Delete**:
  - Owner-only restriction
  - Optimistic concurrency (version check)
  - Distinct error codes

- **Restoration**:
  - Window boundary (inside, at edge, past)
  - Non-owner rejection
  - Already-purged rejection
  - Not-deleted rejection

- **Purge**:
  - Idempotency (no double-purge, no data corruption)
  - Batch limits and deterministic ordering
  - Settlement evidence retention

### Running Tests

```bash
pnpm test -- resources.softDelete.test.ts
```

## Troubleshooting

### Issue: "RESTORE_WINDOW_EXPIRED"

The restoration deadline has passed (30 days after soft-delete). Resource cannot be restored.

**Solution**: Resource is permanently purged; recreate if needed.

### Issue: Purge job stuck or slow

Purge jobs process up to 100 resources per job. For large datasets:

1. Check Redis queue (`redis-cli LLEN resource-purge`)
2. Verify worker processes are running
3. Check logs for purge failures
4. Increase worker concurrency or batch size if needed (requires code change)

### Issue: Settlement references to purged resource

Purge is designed to NOT cascade-delete settlements. References remain; catalog data is tombstoned.

**Verification**:
```sql
SELECT count(*) FROM "Settlement" s
JOIN "PaymentAttempt" pa ON s."paymentAttemptId" = pa.id
WHERE pa."resourceId" = 'purged_resource_id'
  AND pa."resourceId" IS NOT NULL;
-- Should return > 0 (settlement exists even after resource purge)
```
