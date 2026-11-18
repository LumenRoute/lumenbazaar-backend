# Canonical resource URLs

Persist HTTPS URLs using WHATWG URL parsing: lowercase/IDNA host, default port
removal and dot-segment resolution; decode only unreserved percent-encoded ASCII
and uppercase other escape hex digits. Preserve path case, reserved encoded
separators and trailing slashes. Reject credentials, query strings, fragments,
malformed percent encoding and unsupported schemes. Existing seller-domain and
route-template safety checks still apply.

The canonical endpoint is stored in url; displayUrl preserves submitted spelling.
Existing rows remain untouched by the additive nullable displayUrl migration.
Before any historical backfill run scripts/audit-resource-urls.ts with a read-only
database role. It reports IDs needing normalization, invalid records and
seller-scoped collision groups without printing URLs. Review collisions manually;
do not silently merge distinct resource IDs. There is no automatic historical
rewrite or unique constraint in this migration.
