# Settlement reconciliation

Hosted workers use BullMQ and Redis. Settlement confirmation jobs use
`settlement-<paymentAttemptId>` as the deterministic job identifier, survive worker restarts, retry
with eight bounded exponential-backoff attempts, and move to the dead-letter queue after attempts
are exhausted.

At startup the worker scans non-final settlements that have a persisted transaction hash and
enqueues one reconciliation job per payment attempt. It does not enqueue `settling` attempts without
a settlement: these are pre-submit claims and have no network transaction to confirm. An identical
API retry may reclaim that claim after its 60-second lease expires. Once signed transaction evidence
is stored, the attempt is `submitted`; the API enqueues the deterministic confirmation job before
the adapter submits the signed envelope. Retries of `submitted` attempts only query the stored hash
and never invoke submission again. If enqueueing fails, the startup scan recovers the committed
intent.

Verification keys are `verify:<paymentHash>`. Settlement keys are
`settle:<paymentAttemptId>`, with `requestHash` storing the canonical payment payload fingerprint.
The same key with a conflicting fingerprint or transaction hash is rejected.

## Horizon result handling

The confirmation worker queries Horizon by the persisted transaction hash. It accepts only a
successful transaction response with a positive integer ledger. A not-found response or timeout is
pending and is retried within the bounded BullMQ policy. A failed transaction or malformed response
is sent to operator review. The adapter performs its own RPC finality check before returning an
immediate success response; the worker does not compare Horizon and RPC results.

Before writing confirmation, the worker also checks that the queued hash and any existing receipt
hash match the stored settlement hash. A conflict is marked `needs_review`; it never overwrites
evidence or causes another network submission.

## States

- `pending` / `submitted`: no final agreed result yet; retry confirmation within the bounded policy.
- `reconciled`: Horizon confirmed the transaction; payment state and finalized receipt were
committed atomically.
- `needs_review`: conflicting evidence, chain failure, exhausted retries, or missing
transaction evidence requires an operator decision.

The pre-submit `settling` state is different from `submitted`: if no transaction hash was committed,
an identical API request may reclaim it only after the 60-second lease. Worker retries never submit
transactions.

Each check increments `reconciliationAttempts` and records `lastReconciledAt`. Terminal reasons are
stored in `reconciliationReason` and a public-safe audit record. Dead-letter reasons must not include
signed payloads, credentials, private keys, or authorization entries.

## Recovery

For `needs_review`, compare the stored transaction hash with Horizon and the RPC finality
adapter before changing state. Never move a payment back to `verified` and never submit it
again from the worker. If both sources confirm the transaction at the same ledger, rerun
reconciliation to finalize the existing receipt evidence. If both sources report failure, retain
the attempt, settlement, receipt, and audit rows.

Cleanup may mark expired unsubmitted attempts and add retention audit records. It must not delete
financial payment, settlement, receipt, or reconciliation evidence.
