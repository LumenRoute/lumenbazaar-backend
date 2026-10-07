# Payment Incident And Rollback Runbook

Use the response `x-correlation-id` to connect an API request to durable payment evidence. Never
paste signing keys, authorization entries, bearer tokens, payment payloads, or credentials into an
incident ticket. Metrics use only bounded network, result, dependency, queue, route, and tool labels;
do not add resource, wallet, transaction, receipt, or correlation identifiers as metric labels.

## First response

1. Check API and MCP `/ready`, then inspect API and MCP `/metrics`.
2. Search `PaymentAttempt`, `Settlement`, `Receipt`, and `AuditLog` by `correlationId`.
3. Preserve database records and BullMQ failed/dead-letter jobs before restarting a worker.
4. Disable the signer or remove the affected service from ingress if new settlements are unsafe.
5. Record the alert, correlation ID, bounded error code, affected network, and UTC time only.

Example read-only evidence query:

```sql
SELECT 'attempt' AS kind, id, "correlationId", status, "createdAt"
FROM "PaymentAttempt" WHERE "correlationId" = $1
UNION ALL
SELECT 'settlement', id, "correlationId", status, "createdAt"
FROM "Settlement" WHERE "correlationId" = $1
UNION ALL
SELECT 'receipt', id, "correlationId", status, "createdAt"
FROM "Receipt" WHERE "correlationId" = $1;
```

## Dependency outage

Confirm the failing `lumenbazaar_dependency_up` label and readiness check. Keep liveness online,
remove the payment service from traffic, restore the dependency, apply migrations, and require two
successful readiness probes before re-enabling traffic. Do not bypass readiness.

## Signer failure

Stop new settlement traffic and verify the configured signer provider and key version through the
secret manager. Rotate or revoke compromised material according to `docs/security/facilitator-signer.md`.
Do not print the secret or submit a diagnostic transaction until readiness succeeds.

## Stuck settlement

Inspect `lumenbazaar_stuck_settlements`, the settlement-confirmation queue, and the correlated
settlement. A submitted transaction hash must be reconciled against Horizon before retrying. Never
resubmit solely because the API timed out; duplicate submission can double-pay.

## Reconciliation review

For `needs_review`, compare the stored transaction hash, network, amount, asset, and recipient with
Horizon. Mark evidence only through the reconciliation worker. Retain the dead-letter job and audit
record when escalation is required.

## Replay spike

Check whether the spike is repeated idempotent client traffic or conflicting requirements. Block an
abusive client at ingress when identified, but preserve replay rejection evidence. Do not log payment
signatures or authorization entries while investigating.

## Verification rejections

Break down the bounded `result` and `network` labels, then inspect error codes using correlation IDs.
Validate clock/ledger expiry, accepted asset configuration, trustlines, recipient, and signer health.

## Queue backlog

Check Redis readiness, worker replicas, failed jobs, and database latency. Scale consumers only after
confirming jobs are idempotent. Keep failed jobs until correlated settlement state is understood.

## Rollback

Roll application services back to the last compatible image and keep the additive correlation
columns and audit records in place. Disable payment ingress during rollback. Do not reverse migration
`0007_observability_correlation` while any new-version service or correlated record exists. After the
rollback, deploy migrations, start one worker, verify queue depth decreases, verify `/ready`, and then
restore traffic gradually.
