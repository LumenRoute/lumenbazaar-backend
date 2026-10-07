# Settlement reconciliation

Hosted workers use BullMQ and Redis. Settlement confirmation jobs use
`settlement-<paymentAttemptId>` as the deterministic job identifier, survive worker restarts, retry
with eight bounded exponential-backoff attempts, and move to the dead-letter queue after attempts
are exhausted.

At startup the worker scans for `settling` attempts without a settlement and non-final settlements
with transaction evidence. It enqueues one reconciliation job per payment attempt. The API does not
resubmit these payments. The API also enqueues the same deterministic job immediately after it
durably records a non-final submission; an enqueue outage is audit-logged and the startup scan is
the recovery path.

## States

- `pending`: Horizon does not yet expose a final result; retry within the bounded policy.
- `reconciled`: chain confirmation, payment state, and finalized receipt were committed atomically.
- `needs_review`: chain failure, exhausted retries, or missing transaction evidence requires an
  operator decision.

Each check increments `reconciliationAttempts` and records `lastReconciledAt`. Terminal reasons are
stored in `reconciliationReason` and a public-safe audit record. Dead-letter reasons must not include
signed payloads, credentials, private keys, or authorization entries.

## Recovery

For `needs_review`, compare the stored transaction hash with Horizon or RPC before changing state.
Never move a payment back to `verified` and never submit it again from the worker. If the transaction
is confirmed, rerun reconciliation to finalize the existing receipt evidence. If it failed, retain
the attempt, settlement, receipt, and audit rows.

Cleanup may mark expired unsubmitted attempts and add retention audit records. It must not delete
financial payment, settlement, receipt, or reconciliation evidence.
