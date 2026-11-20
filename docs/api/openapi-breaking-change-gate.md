# OpenAPI Breaking-Change Detection Gate

## Overview

The breaking-change detection gate automatically compares the generated OpenAPI specification against a pinned release baseline and enforces that breaking changes are explicitly reviewed and approved before deployment.

**Goals:**
- Prevent unintended breaking changes from reaching CI
- Make breaking changes visible in code review
- Provide a clear migration path for approved breaking changes
- Fail closed: unknown or unclassifiable changes are treated as breaking

## How It Works

### 1. Specification Generation

The build process generates a fresh OpenAPI specification:

```bash
pnpm openapi:generate
```

This produces:
- `docs/api/openapi.json` - Generated spec (always up-to-date)
- `docs/api/conformance.json` - Conformance spec

### 2. Breaking-Change Detection

The gate compares the generated spec against the **baseline**:

```bash
pnpm openapi:check
```

Comparison process:
1. Load baseline from `docs/api/baseline/openapi.baseline.json`
2. Load generated spec from `docs/api/openapi.json`
3. Detect changes by comparing:
   - Paths (removed, added)
   - Operations (removed, added)
   - Parameters (removed, become required, schema changed)
   - Response codes (removed, added)
   - Response properties (removed, added)
   - Security requirements (changed)

### 3. Change Classification

Each detected change is classified as:

**BREAKING** (fail-closed by default):
- Removed paths or operations
- Removed or newly-required request parameters
- Removed response codes or properties
- Changed security requirements
- Narrowed types, enums, or ranges
- Tightened constraints (min/max, pattern, format)

**ADDITIVE** (always allowed):
- New paths or operations
- New optional request parameters
- New response codes or properties
- Widened enums on responses

**UNKNOWN** (treated as BREAKING):
- Changes the gate cannot confidently classify
- Fail-closed behavior: when in doubt, block and ask for human review

### 4. Approval Gate

A breaking change passes the gate only if ALL of the following are true:

1. ✓ Change is recorded in `docs/api/compat-decisions.json`
2. ✓ API version was bumped (`info.version` in spec)
3. ✓ Migration notes are provided and non-empty

If all three conditions are met, the change is moved from `breaking` to `approvedBreaking` in the report and CI passes.

### 5. Baseline Update

After a breaking change is approved and merged:
1. The new spec becomes the baseline
2. `docs/api/baseline/openapi.baseline.json` is updated
3. Subsequent changes are compared against this new baseline

## Workflow: Approve a Breaking Change

### Step 1: Make Your API Change

Modify your API (e.g., remove a deprecated endpoint):

```typescript
// Remove from apps/api/src/openapi.ts or routes
app.delete("/v1/resources/legacy/:id", ...); // REMOVED
```

### Step 2: Generate New Spec

```bash
pnpm openapi:generate
```

This creates a fresh `docs/api/openapi.json`.

### Step 3: Run the Gate (Locally)

```bash
pnpm openapi:check
```

Output:
```
❌ UNAPPROVED BREAKING CHANGES:
  - Operation removed: DELETE /v1/resources/legacy/{id}
    (Record in docs/api/compat-decisions.json with changeId: change_.v1.resources.legacy.id.delete.path)

Result: FAIL
```

### Step 4: Record Your Decision

Add an entry to `docs/api/compat-decisions.json`:

```json
{
  "changeId": "change_.v1.resources.legacy.delete.path",
  "description": "Removed deprecated /v1/resources/legacy/{id} endpoint",
  "apiVersion": "0.2.0",
  "migrationNotes": "Clients should use /v1/resources/{id} instead. The new endpoint provides identical functionality with improved performance. Support for the legacy endpoint will end on 2024-06-01.",
  "approvedAt": "2024-01-15T10:30:00Z",
  "reason": "Cleanup of deprecated API surface before 1.0 release. The endpoint has been marked as deprecated for 6 months with clear migration guidance."
}
```

**Important**: `migrationNotes` must be non-empty and provide actionable guidance.

### Step 5: Bump the API Version

In your spec definition (or `package.json` if the version is derived from there), bump the version:

```json
{
  "info": {
    "version": "0.2.0"  // Changed from 0.1.0
  }
}
```

### Step 6: Regenerate and Verify

```bash
pnpm openapi:generate
pnpm openapi:check
```

Output:
```
✓ APPROVED BREAKING CHANGES:
  - Operation removed: DELETE /v1/resources/legacy/{id}

✓ Baseline updated to 0.2.0

Result: PASS
```

### Step 7: Commit

```bash
git add docs/api/compat-decisions.json docs/api/baseline/openapi.baseline.json package.json
git commit -m "chore: approve breaking change and bump API version to 0.2.0"
```

### Step 8: Create PR

Create a PR with your changes. Code review should include:
- Verification that migration notes are clear
- Discussion of deprecation timeline if applicable
- Confirmation that the new API design is correct

## Example: Additive Change (No Approval Needed)

Adding a new optional parameter requires no approval:

```bash
# Add parameter to endpoint
# Regenerate spec
pnpm openapi:generate

# Check gate
pnpm openapi:check
```

Output:
```
✓ ADDITIVE CHANGES:
  - Optional parameter added: filter (query) in GET /v1/resources

Result: PASS
```

No `compat-decisions.json` entry needed; additive changes are always allowed.

## CI Integration

The `.github/workflows/ci.yml` runs the gate on every PR:

```yaml
- name: Check OpenAPI breaking changes
  run: pnpm openapi:check
  continue-on-error: false

- name: Upload OpenAPI report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: openapi-breaking-changes-report
    path: docs/api/breaking-changes-report.json
```

**Behavior**:
- ✓ Gate passes → PR can merge
- ✗ Gate fails → PR is blocked until breaking changes are approved
- Report artifact is always uploaded for review (even on success)

## Checking Locally

Before pushing, always run:

```bash
pnpm openapi:check
```

This ensures CI will not be blocked by a preventable failure.

## Files and Directories

| File/Directory | Purpose |
|---|---|
| `docs/api/openapi.json` | Generated OpenAPI spec (always current) |
| `docs/api/baseline/openapi.baseline.json` | Baseline for comparison (updated after approval) |
| `docs/api/compat-decisions.json` | Approved breaking changes |
| `docs/api/breaking-changes-report.json` | Latest gate report (artifacts in CI) |
| `scripts/openapi.ts` | Main script; calls gate after generation |
| `scripts/openapiBreakingChangeDetector.ts` | Detector and classifier logic |

## Troubleshooting

### "UNKNOWN CHANGES (treated as breaking)"

The gate found changes it cannot confidently classify. This is fail-closed behavior.

**Fix**: Review the change manually in `docs/api/breaking-changes-report.json` and either:
- Update the detector logic to handle the new case (if it should be ADDITIVE)
- Approve it in `compat-decisions.json` (if it should be BREAKING)

### "Baseline not found"

On first run or after migration, the baseline may not exist.

**Fix**: The gate creates a new baseline automatically. Run:

```bash
pnpm openapi:check
```

Verify the report looks correct, then commit `docs/api/baseline/openapi.baseline.json`.

### "Version not bumped"

You approved a breaking change but did not increment `info.version` in the spec.

**Fix**: Bump the version in your spec definition and regenerate:

```bash
pnpm openapi:generate
pnpm openapi:check
```

### "Migration notes empty"

You recorded a change in `compat-decisions.json` but left `migrationNotes` blank.

**Fix**: Provide clear, actionable migration guidance. Example:

❌ Bad:
```json
"migrationNotes": "Use the new API instead"
```

✓ Good:
```json
"migrationNotes": "Replace all calls to `/v1/resources/legacy/{id}` with `/v1/resources/{id}`. Response format is identical; no client code changes required other than the URL. Transition timeline: the legacy endpoint will be removed on 2024-06-01. Contact support@example.com with questions."
```

## Best Practices

1. **Minimize breaking changes**: Prefer additive changes and deprecation periods.

2. **Communicate early**: Use deprecation headers/warnings before removing endpoints.

3. **Clear migration path**: Always provide examples and timing in migration notes.

4. **Version semantically**: Follow semver; breaking changes typically warrant a minor or major version bump.

5. **Document decisions**: Record the _why_ in `compat-decisions.json`, not just the _what_.

6. **Review thoroughly**: Breaking changes require explicit human approval in code review.

## References

- [OpenAPI 3.1 Specification](https://spec.openapis.org/oas/v3.1.0)
- [Semantic Versioning](https://semver.org/)
- [API Deprecation Best Practices](https://apiguide.readthedocs.io/en/latest/versioning.html)
