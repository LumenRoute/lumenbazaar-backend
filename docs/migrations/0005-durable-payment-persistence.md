# Durable payment persistence migration

Migration `0005_durable_payment_persistence` adds unique payment idempotency keys,
settlement reconciliation state, and immutable receipt evidence hashes.

## Upgrade

1. Back up the PostgreSQL database.
2. Stop API instances that can create payment attempts.
3. Run `pnpm prisma migrate deploy`.
4. Run `pnpm prisma:validate`, start one API instance, and verify `/ready`.
5. Restore normal API and worker capacity.

Existing attempts are backfilled with `verify:<paymentHash>`. Existing receipt evidence is
backfilled from its immutable receipt, attempt, transaction, and ledger identifiers.

## Evidence retention

Payment attempts with settlement or receipt evidence cannot be deleted through a cascading
relationship. Retain all three records under the financial-record policy; archive them together
if a future retention policy requires cold storage. These tables store hashes and public chain
evidence only. They must not store signed payloads, authorization entries, private keys, or signer
credentials.

## Rollback

Application rollback is safe only before new rows depend on these columns. Stop writers, restore
the pre-migration application, then drop `Receipt_evidenceHash_key`,
`PaymentAttempt_idempotencyKey_key`, and the three added columns. For any production traffic after
the upgrade, restore the pre-upgrade database backup instead so financial evidence and idempotency
history are not lost. Restoring the old foreign-key cascade behavior is not recommended.
