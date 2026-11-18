# Privileged resource mutation audit

Resource updates (including status changes/moderation) and historical rollbacks
write a dedicated append-only audit row in the same Prisma transaction. Audit
failure aborts the business change. Actor is the authenticated seller ID when
present, otherwise the internal system identity. An explicit reason code,
action, resource target, request correlation and success outcome are retained.
Raw mutation input, payment data and secrets are never included.

A transaction-scoped PostgreSQL advisory lock serializes SHA-256 chain extension.
Each hash covers the canonical insertion fields and previous hash. Database
triggers reject UPDATE, DELETE and TRUNCATE. No application mutation endpoints
exist for audit records. Database owners can bypass triggers: export chain heads
to independent storage for protection against privileged database tampering.

Scope is the existing resource moderation/recovery APIs; no new admin privilege
or endpoint is introduced. Failed requests roll back the success audit with the
mutation; existing denial logs remain separate.
