# Resource Duplicate Fingerprint Detection

## Overview

Catalog moderation now includes a stable fingerprinting mechanism to detect semantically duplicate resources published under minor metadata changes. Resources are flagged for moderation review rather than automatically deleted, giving catalog administrators explicit control over conflict resolution.

## Fingerprint Specification

### Version 1 (Current)

The fingerprint is computed from **canonical resource properties** that define semantic identity:

1. **sellerId** — The seller publishing the resource (immutable)
2. **url** — The canonical endpoint URL
3. **network** — The Stellar network (testnet, pubnet)
4. **assetCode** — The asset code
5. **assetIssuer** — The Stellar account ID of the asset issuer
6. **amount** — The exact payment amount required
7. **payTo** — The Stellar account ID that receives payment

These seven properties define what makes a resource unique from a functional perspective. Two resources with the same fingerprint serve the same purpose under the same economic terms, making them duplicates regardless of metadata differences.

### Properties NOT Included

The fingerprint **explicitly excludes**:
- **name** — Descriptive label
- **description** — Human-readable documentation
- **inputSchema, outputSchema** — API signature details
- **extensions** — Optional metadata
- **status** — Active/inactive state
- **version** — Version number

This design allows sellers to republish resources with improved documentation or updated specifications without triggering false duplicate flags.

### Normalization Rules

Inputs are normalized before hashing to handle case-insensitive properties:

- **URLs** are lowercased (RFC 3986: domain names are case-insensitive)
- **Asset codes** are uppercased (ISO 4217 convention)
- **Stellar account IDs** are used as-is (already canonical)
- **Amounts** are used as-is (already normalized by payment validation layer)

Example: `https://API.EXAMPLE.COM/service` and `https://api.example.com/service` produce the same fingerprint hash.

### Collision Safety

Field encoding prevents boundary collisions:
- Each field is encoded as `fieldNameLength:fieldName|valueLength:value|`
- This prevents cases like `"ab" + "c"` colliding with `"a" + "bc"`
- SHA-256 digestion ensures cryptographic collision resistance

## Database Schema

### ResourceFingerprint Table

Stores computed fingerprints for every resource:

```sql
CREATE TABLE "ResourceFingerprint" (
  "id" TEXT PRIMARY KEY,                    -- Unique ID
  "resourceId" TEXT UNIQUE NOT NULL,        -- Foreign key to Resource
  "version" INTEGER NOT NULL DEFAULT 1,     -- Fingerprint version (for migrations)
  "hash" TEXT NOT NULL,                     -- SHA-256 hex digest
  "createdAt" TIMESTAMP NOT NULL            -- When fingerprint was computed
);

CREATE INDEX "ResourceFingerprint_hash_version_idx" ON ("hash", "version");
CREATE INDEX "ResourceFingerprint_createdAt_idx" ON ("createdAt");
```

One fingerprint per resource. Updated whenever the resource's payment terms or canonical URL changes.

### ResourceDuplicateFlag Table

Tracks detected collisions for moderation workflow:

```sql
CREATE TABLE "ResourceDuplicateFlag" (
  "id" TEXT PRIMARY KEY,                    -- Unique flag ID
  "resourceId" TEXT NOT NULL,               -- Resource with duplicate
  "collidingResourceIds" TEXT NOT NULL,     -- JSON array of colliding IDs
  "fingerprintHash" TEXT NOT NULL,          -- The hash that collided
  "fingerprintVersion" INTEGER NOT NULL,    -- Version of fingerprint algorithm
  "severity" TEXT NOT NULL,                 -- 'high' (default), 'medium', 'low'
  "status" TEXT NOT NULL,                   -- 'pending', 'reviewed', 'dismissed', 'resolved'
  "reviewedAt" TIMESTAMP,                   -- When moderation action taken
  "reviewedBy" TEXT,                        -- Admin/seller who reviewed
  "resolution" TEXT,                        -- Notes on resolution
  "createdAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL
);

CREATE INDEX "ResourceDuplicateFlag_resourceId_idx" ON ("resourceId");
CREATE INDEX "ResourceDuplicateFlag_fingerprintHash_idx" ON ("fingerprintHash");
CREATE INDEX "ResourceDuplicateFlag_status_createdAt_idx" ON ("status", "createdAt");
```

Flags are **never automatically deleted**. The moderation workflow is:

1. **pending** — Collision detected, awaiting review
2. **reviewed** — Moderator examined, decided action
3. **dismissed** — False positive (resources are legitimately different)
4. **resolved** — Duplicate removed or other remediation completed

## API Integration

### Resource Creation Flow

When a resource is created:

1. **Normalize inputs** (case, URL canonicalization, etc.)
2. **Compute fingerprint** from canonical properties
3. **Store fingerprint** in ResourceFingerprint table
4. **Query for collisions** by fingerprint hash
5. **Flag if collisions exist** in ResourceDuplicateFlag table
6. **Log collision detection** to audit log

```typescript
// ResourceService.createResource()
const duplicates = await fingerprintService.registerResourceFingerprint({
  resourceId: created.id,
  sellerId: created.sellerId,
  url: created.url,
  network: created.network,
  assetCode: created.assetCode,
  assetIssuer: created.assetIssuer,
  amount: created.amount,
  payTo: created.payTo
});

if (duplicates.collisions.length > 0) {
  await auditLogService.record({
    action: "resource.duplicate_detected",
    targetId: created.id,
    metadata: {
      fingerprintHash: duplicates.fingerprint.hash,
      collidingResourceIds: duplicates.collisions
    }
  });
}
```

### Update Behavior

**Payment terms and endpoint changes** trigger fingerprint recomputation:

- Changing `url`, `network`, `assetCode`, `assetIssuer`, `amount`, or `payTo` creates a new fingerprint
- The new fingerprint is queried for collisions
- If no collisions, any previous duplicate flag is **not automatically dismissed** (preserved for audit trail)

**Metadata changes** do not affect fingerprints:

- Changing `name`, `description`, `inputSchema`, `outputSchema`, or `extensions` keeps the same fingerprint
- No new collision detection is triggered

### Moderation Endpoints (Future)

These endpoints expose the moderation workflow:

```typescript
// GET /v1/moderation/duplicate-flags?status=pending
// List pending duplicate flags

// PATCH /v1/moderation/duplicate-flags/:flagId
// Update flag status: reviewed, dismissed, resolved
```

## Testing Strategy

### Unit Tests: `resourceFingerprint.test.ts`

Tests the fingerprinting algorithm in isolation:

- **Consistency**: Same inputs always produce same hash
- **Determinism**: Multiple calls produce identical results
- **Normalization**: URL case, asset code case handled correctly
- **Collision Detection**: Different inputs produce different hashes
- **Collision Safety**: Field boundary encoding prevents false collisions
- **Version Tracking**: Fingerprints include version for migration
- **Real-world Scenarios**: Duplicates with name changes, network variants, etc.

### Integration Tests: `resourceFingerprinting.test.ts`

Tests the service layer with mocked database:

- **Fingerprint Registration**: Storage and collision detection
- **Collision Flagging**: Resources with matching hashes are flagged
- **Moderation Workflow**: Flag status updates (pending → dismissed → resolved)
- **Query Operations**: Finding duplicates by hash, listing pending flags
- **Error Cases**: Missing flags, invalid state transitions

### Migration Tests: `prisma/migrations.integration.test.ts`

Tests the database schema:

- Migration applies without errors
- Indices are created correctly
- Foreign key constraints enforced
- Unique constraints on resourceId prevent duplicate fingerprints

## Collision Examples

### Example 1: Duplicate with Different Name

**Resource A:**
```json
{
  "name": "Fast API Gateway",
  "url": "https://api.provider.com/service",
  "network": "stellar:testnet",
  "assetCode": "USDC",
  "assetIssuer": "GBBD47UZQ2EORUNQVU5R72XQV5IMLIQV2N26ESJQXYDUO4RZK4RIBUX",
  "amount": "100.0000000",
  "payTo": "GBVNBNNQJ7QXQYIUWVXJ7NWEYU5Y5ZXMBWVCQBSYM2HI73XB7NWHQUD"
}
```

**Resource B (Duplicate):**
```json
{
  "name": "Premium API Access",  // Different name
  "url": "https://api.provider.com/service",
  "network": "stellar:testnet",
  "assetCode": "USDC",
  "assetIssuer": "GBBD47UZQ2EORUNQVU5R72XQV5IMLIQV2N26ESJQXYDUO4RZK4RIBUX",
  "amount": "100.0000000",
  "payTo": "GBVNBNNQJ7QXQYIUWVXJ7NWEYU5Y5ZXMBWVCQBSYM2HI73XB7NWHQUD"
}
```

**Result:** Fingerprints match → **COLLISION DETECTED** ✓

### Example 2: Different Asset Issuer

**Resource A:**
```json
{
  "url": "https://exchange.provider.com/trade",
  "assetCode": "USD",
  "assetIssuer": "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2IXBI5VBLDF",
  "amount": "50.0000000"
}
```

**Resource C (Different):**
```json
{
  "url": "https://exchange.provider.com/trade",
  "assetCode": "USD",
  "assetIssuer": "GBBD47UZQ2EORUNQVU5R72XQV5IMLIQV2N26ESJQXYDUO4RZK4RIBUX",  // Different issuer
  "amount": "50.0000000"
}
```

**Result:** Fingerprints differ → **NO COLLISION** ✓

This is correct: different issuers mean different assets, even if code matches.

### Example 3: Different Networks

**Resource A:** `network: "stellar:testnet"`  
**Resource D:** `network: "stellar:pubnet"`

**Result:** Fingerprints differ → **NO COLLISION** ✓

Correct: same service on different networks is not a duplicate.

## Future Considerations

### Version Migration

If the fingerprinting algorithm needs updates (e.g., to include new canonical properties):

1. **New version number** introduced (e.g., v2)
2. **Old fingerprints retained** in database (version column enables this)
3. **Collision queries** filter by version: only match resources in same version
4. **Existing duplicates** remain flagged, no automatic action taken
5. **New resources** computed with v2, create new collision detection

Example version transition:
```typescript
// v2 might include routeTemplate as canonical property
function computeResourceFingerprintV2(inputs: ResourceFingerprintInputsV2): ResourceFingerprint {
  return {
    version: 2,
    hash: hashFingerprintInputsV2(inputs)
  };
}

// Query for collisions only within same version
const collisions = await db.resourceFingerprint.findMany({
  where: {
    hash: fingerprint.hash,
    version: fingerprint.version  // Version-scoped collision detection
  }
});
```

### Bulk Recomputation

If new fields become canonical:

```bash
# Recompute all fingerprints with new version
await db.resourceFingerprint.deleteMany({});
for (const resource of resources) {
  const newFp = computeResourceFingerprintV2(resource);
  await db.resourceFingerprint.create({
    resourceId: resource.id,
    version: newFp.version,
    hash: newFp.hash
  });
  // Rerun collision detection
  const collisions = await findCollisions(newFp.hash);
  if (collisions.length > 0) {
    flagAsDepicate(resource.id, collisions);
  }
}
```

## Acceptance Criteria Verification

✓ **Fingerprint inputs and version documented** — Specification above defines v1 inputs and rationale  
✓ **Potential duplicates flagged, not automatically deleted** — ResourceDuplicateFlag workflow with moderation status  
✓ **Collision and migration tests included** — resourceFingerprint.test.ts and integration tests  
✓ **Database migrations synchronized** — prisma/schema.prisma and migration SQL match exactly  
✓ **Synthetic/testnet data only** — Tests use hardcoded testnet Stellar addresses  
✓ **No secrets in code** — Fingerprinting uses public payment terms only  

## Files Modified

- `packages/shared/src/resourceFingerprint.ts` — Fingerprinting algorithm
- `packages/shared/src/resourceFingerprint.test.ts` — Algorithm tests
- `packages/shared/src/index.ts` — Export fingerprinting utilities
- `apps/api/src/services/resourceFingerprinting.ts` — Service implementation
- `apps/api/src/services/resourceFingerprinting.test.ts` — Service tests
- `apps/api/src/services/resources.ts` — Integration with resource creation
- `prisma/schema.prisma` — Schema updates for new tables
- `prisma/migrations/20261120185048_add_resource_fingerprint/migration.sql` — Database migration
- `docs/resource-fingerprint.md` — This documentation

## Migration Path

When deploying:

1. **Apply migration** — Creates ResourceFingerprint and ResourceDuplicateFlag tables
2. **Backfill fingerprints** — Compute fingerprints for all existing resources (offline job)
3. **Detect existing duplicates** — Run collision detection on backfilled fingerprints
4. **Review flags** — Moderation team reviews flagged duplicates
5. **Deploy code** — ResourceService now registers fingerprints on create/update

The system is **backward compatible**: resources without fingerprints continue working until backfill completes.
