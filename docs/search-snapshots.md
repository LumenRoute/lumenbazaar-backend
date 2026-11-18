# Search snapshot pagination

Search materializes ranked result values before issuing an opaque random snapshot
ID and validated integer offset cursor. Continuations must repeat the same parsed
query filters (limit may change). Subsequent catalog edits do not change results
already captured. The five-minute TTL is absolute. Expiry, process restart or a
request routed to another process returns SEARCH_SNAPSHOT_EXPIRED (HTTP 410,
details.restart=true); restart without the cursor. Buyer SDK exposes
SearchSnapshotExpired. Deploy with sticky routing for uninterrupted traversal.

Snapshots are process-local, at most 100 live snapshots and 10,000 resources per
snapshot. Capacity failures are explicit rather than silently partial traversal.
Initial capture enumerates catalog pages and is not a database MVCC snapshot;
stability is guaranteed for continuation after capture, not concurrent changes
during initial capture. Snapshots expire lazily on subsequent search requests.
