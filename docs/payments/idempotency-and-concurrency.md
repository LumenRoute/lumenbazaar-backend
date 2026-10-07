# Payment idempotency and concurrency

Exact payments use the payment payload hash as the verification idempotency boundary. PostgreSQL
enforces unique payment hashes and `verify:<paymentHash>` keys. An identical retry with matching
network, asset, amount, and recipient returns the original attempt. A conflicting or terminal
authorization is rejected.

Settlement ownership is an atomic `verified -> settling` database transition. Only the process
that changes the row may call the Stellar settlement adapter. Other API replicas wait briefly for
the durable outcome and then return the original receipt, the original failure, or a bounded
`settling` response. A confirmed or failed retry never calls the adapter again.

The `settling` claim deliberately has no lock expiry. Automatically expiring it could permit a
second chain submission after an API timeout or process death. A process interruption leaves the
claim durable for the reconciliation worker to inspect against chain state before any transition.
Database constraints remain the final guard for payment hashes, idempotency keys, attempt
settlements, transaction hashes, and receipt evidence.

Hosted API replicas use a shared Redis fixed-window counter. The increment and first-request expiry
are one Lua operation, and Redis keys contain only a SHA-256 client-key digest. Local and test
environments retain an in-memory counter.

## Recovery expectations

- `verified`: safe to claim exactly once.
- `settling`: never resubmit from an API retry; reconcile chain state.
- `confirmed`: return the stored settlement and receipt.
- `failed` or `timed_out`: return the stored failure and reconcile any recorded transaction hash.
- Missing receipt after a confirmed state: treat as incomplete durable state and reconcile.
