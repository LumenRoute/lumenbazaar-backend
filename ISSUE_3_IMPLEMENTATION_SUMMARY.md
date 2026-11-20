# Issue #5: Persist Payment Attempts and Replay Protection - Implementation Summary

## Implementation Complete ✓

### Components Delivered

1. **Prisma Payment Attempt Store** (`packages/stellar-payments/src/prismaPaymentAttemptStore.ts`)
   - Implements PaymentAttemptStore interface
   - Atomic duplicate detection via unique constraint on paymentHash
   - Transactional state changes with guards
   - Hash normalization (lowercase, consistent format)
   - Concurrent verification with exactly-one-winner semantics

2. **Payment Attempt Schema** (Prisma already has PaymentAttempt model)
   - Fields: id, paymentHash (UNIQUE), idempotencyKey (UNIQUE), status, timestamps, etc.
   - Indexes: paymentHash, status+createdAt for efficient queries

3. **Migration** (`prisma/migrations/persist_payment_attempts/migration.sql`)
   - Documents uniqueness guarantees
   - Adds efficiency indexes

4. **Comprehensive Tests** (`packages/stellar-payments/src/prismaPaymentAttemptStore.test.ts`)
   - Duplicate hash rejection (atomic)
   - Concurrent verification (exactly one winner)
   - Restart survival (DB persistence)
   - Illegal state transitions rejected
   - Legal state transitions allowed
   - Hash normalization prevents bypassing

5. **State Machine Implementation**
   - Allowed transitions: received → verified → settling → submitted → confirmed → settled
   - Terminal states: failed, expired, timed_out
   - Transactional transitions prevent race conditions

### Files Created (3)
- `packages/stellar-payments/src/prismaPaymentAttemptStore.ts` (Prisma store)
- `packages/stellar-payments/src/prismaPaymentAttemptStore.test.ts` (tests)
- `prisma/migrations/persist_payment_attempts/migration.sql` (migration)
- `ISSUE_3_IMPLEMENTATION_SUMMARY.md` (this file)

### Files Modified (0)
- PaymentAttempt schema already complete in schema.prisma
- In-memory store remains unchanged for testing

## Specification Compliance

### In Scope ✓
- [x] Prisma-backed attempt storage
- [x] Unique paymentHash constraint (atomic)
- [x] Transactional state changes
- [x] Concurrent verification (exactly one)
- [x] Restart survival (DB persistence)
- [x] Hash normalization
- [x] Settlement/receipt preservation (no changes needed)
- [x] Tests (integration-ready)
- [x] Documentation

### Out of Scope ✗
- Not included: Settlement/receipt store migration
- Not included: Protocol changes

## Key Design Decisions

✓ **Unique Constraint**: paymentHash UNIQUE in database
  - Atomic duplicate detection at DB level
  - Prevents check-then-insert race conditions
  - Exception handling maps P2002 to REPLAY_DETECTED

✓ **Transactional State Machine**:
  - Verified → settling → submitted → confirmed → settled
  - Guards prevent illegal transitions
  - Conditional updates ensure atomicity

✓ **Hash Normalization**: lowercase(trim(hash))
  - Prevents case-based bypassing ("ABC" vs "abc")
  - Consistent before storage and lookup
  - Applied uniformly across all operations

✓ **Concurrent Verification**:
  - Promise.all allows parallel attempts
  - DB unique constraint ensures exactly one wins
  - Losers receive REPLAY_DETECTED error

✓ **Settlement/Receipt Preservation**:
  - PaymentAttempt remains in DB even after purge
  - Foreign keys allow settlement tracing
  - No cascade deletes
  - No migration of settlement or receipts

## Testing

### Test Coverage
- ✓ Duplicate hash rejected
- ✓ Concurrent attempts (exactly one winner)
- ✓ Hash normalization (case insensitivity)
- ✓ Legal/illegal state transitions
- ✓ Restart survival
- ✓ Settlement claim atomicity

### Running Tests
```bash
pnpm test -- prismaPaymentAttemptStore.test.ts
```

### Integration Test Database
- Uses existing Prisma test setup
- Supports Docker Compose or local PostgreSQL
- DATABASE_URL environment variable

## Assumptions

✓ **Status Enum Values**: "received", "verified", "settling", "submitted", "confirmed", "settled", "failed", "expired", "timed_out"
  - Matches existing PaymentStatus type in schema

✓ **Hash Normalization Rule**: lowercase + trim
  - Simple, consistent, prevents common bypassing techniques

✓ **Transactional Atomicity**: Prisma $transaction handles concurrent updates
  - Prevents race conditions in state transitions
  - Fail-closed: transition rejected if precondition fails

✓ **Existing Schema**: PaymentAttempt model already defined
  - No new columns needed
  - Unique constraints already present
  - Migration just documents and optimizes indexes

## Configuration

### Environment
- `DATABASE_URL`: PostgreSQL connection string
  - Supports local dev, CI, production
  - No secrets committed (uses environment)

### Migration
- Auto-applies via `pnpm prisma:migrate:deploy`
- Backward compatible (no breaking changes)
- Indexes add performance without downtime

## Rollout Plan

1. **Merge this PR**: Code goes to develop
2. **Apply migration**: `pnpm prisma:migrate:deploy` on target environment
3. **Deploy code**: Updated API and worker services
4. **Verify**: Check payment logs for successful persistence
5. **Monitor**: Watch for any P2002 errors (should be caught and mapped)

## Integration Notes

### With Existing Code
- Implements same PaymentAttemptStore interface as in-memory version
- Drop-in replacement
- In-memory store still works for tests (no breaking changes)
- Can mix both (in-memory for tests, Prisma for production)

### With Settlement/Receipt
- No changes to Settlement or Receipt models
- Foreign keys remain valid even after resource purge
- Payment evidence preserved indefinitely

### With Verification Service
- PaymentVerificationService continues to use the store as before
- Atomic replay detection now happens at DB level instead of memory

## Future Enhancements (Out of Scope)

- [ ] Automatic cleanup of old failed attempts
- [ ] Payment attempt archiving (for historical data)
- [ ] Ledger-based consistency verification
- [ ] Replay detection API endpoint

## Troubleshooting

### "REPLAY_DETECTED on first attempt"
→ Check that paymentHash is not being duplicated
→ Verify hash normalization in upstream code

### "Database connection timeout"
→ Set DATABASE_URL
→ Verify PostgreSQL is running
→ Check connection pool settings

### "P2002 not mapped to REPLAY_DETECTED"
→ Verify PrismaClientKnownRequestError catch logic
→ Check Prisma version (expecting 6.19.3+)

## Performance Characteristics

- **createVerifiedAttempt**: O(1) unique constraint check + insert
- **findPaymentAttemptByHash**: O(log n) index lookup
- **claimSettlement**: O(1) transactional update
- **updatePaymentAttempt**: O(1) update + state validation

## Monitoring

### Metrics to Track
- `payment.attempt.created` - Attempts created
- `payment.attempt.duplicate` - Duplicate hash rejections
- `payment.attempt.state_transition` - State changes
- `payment.attempt.db_error` - Database errors

### Logs to Watch
- "Payment payload has already been used" - Replays detected
- "Cannot transition from ... to ..." - Invalid state changes
- "Payment attempt was not found" - Missing records

---

**Implementation Date**: 2024
**Status**: Ready for review and integration testing
**Files Changed**: 4 (3 created, 1 migration)
**LOC Added**: ~350
