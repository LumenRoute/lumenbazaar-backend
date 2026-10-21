# Catalog moderation and quarantine

Catalog moderation is additive. Quarantining a resource version changes only
its moderation state; seller-authored metadata and historical version records
are never rewritten or deleted.

## States

- `visible`: the version can appear in discovery and search.
- `quarantined`: the version is hidden from public discovery and search.
- `under_appeal`: the version remains hidden while a seller appeal is reviewed.

Discovery responses also expose a separate `discoveryState`:

- `discoverable`: active and visible.
- `quarantined`: hidden because of moderation.
- `outage`: hidden because the seller marked the resource inactive.
- `draft`: not yet published.

This keeps moderation separate from a seller-declared outage.

## Audit trail

Every quarantine, appeal, appeal rejection, and restore creates an immutable
`ResourceModerationAction` row with a reason code, evidence references,
reviewer identity, resulting state, and timestamp. The database trigger
`ResourceModerationAction_immutable` rejects updates and deletes. Each action
can also create a seller `ModerationNotification` whose delivery status is
tracked as `pending`, `notified`, `failed`, or `not_required`.

## API

Operator endpoints require a reviewer identity in the request body:

- `GET /v1/operator/resources/{id}/moderation`
- `POST /v1/operator/resources/{id}/versions/{version}/quarantine`
- `POST /v1/operator/resources/{id}/versions/{version}/restore`
- `POST /v1/operator/resources/{id}/versions/{version}/reject-appeal`
- `POST /v1/operator/moderation/notifications/{notificationId}`

Seller endpoints:

- `GET /v1/sellers/{sellerId}/resources/{id}/moderation`
- `POST /v1/sellers/{sellerId}/resources/{id}/versions/{version}/appeal`

When seller API authentication is present, the authenticated seller must own
the resource.

## Search and discovery

Public discovery and search read only `visible` resources. Search index
rebuilds re-read moderation state immediately before writing each document and
store quarantined documents as `stale`, so a queued reindex cannot make a
quarantined resource discoverable.

## Data safety

Use only synthetic or explicitly public testnet evidence references (for
example `synthetic://moderation/report/001`). Do not include secrets, private
keys, signed private payloads, or production records in evidence, notes, or
test fixtures.
