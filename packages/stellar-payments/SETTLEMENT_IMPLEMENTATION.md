# Exact Settlement Implementation with Horizon Verification

## Overview

This document describes the exact settlement payment implementation that ensures transactions are confirmed on the Stellar network before finalizing payment receipts.

## Key Design Principles

### 1. Finality Requirements (No Pending, Failed, or Synthetic Results)

**Acceptance Criterion**: A finalized receipt must only be issued when:

- Transaction successfully submitted to Stellar network
- Transaction confirmed on-chain (recorded in specific ledger)
- Transaction details verified through Horizon API

**Invalid Receipt States**:

- Settlement status "pending" (transaction not yet visible)
- Settlement status "failed" (transaction rejected)
- Settlement status "timed_out" (finality unconfirmed after timeout)
- Receipt without matching evidence hash

### 2. Transaction Submission (Single Attempt Guarantee)

Verification and settlement use separate idempotency identities. Verification stores
`verify:<paymentHash>` as the unique key, where `paymentHash` is the canonical hash of the payment
payload. Reusing that key with conflicting requirements is rejected. Settlement stores
`settle:<paymentAttemptId>` and the request's `paymentHash` as its immutable request fingerprint.
The signed transaction hash is not available from the buyer payload: the facilitator simulates,
rebuilds, and signs the transaction. The adapter derives the network-specific hash from that final
signed envelope and persists it before submitting the envelope to Stellar.

```
verified
  └─ atomic claimSettlement → settling
       ├─ fresh exact verification fails → failed (no network submission)
       ├─ 60-second pre-submit claim lease expires → identical retry may reclaim settling
       └─ facilitator signs rebuilt transaction
            └─ atomic recordSubmission → submitted + pending settlement + pending receipt
                 ├─ schedule confirmation job, then submit signed envelope
                 ├─ confirmed → atomically confirm attempt/settlement and finalize receipt
                 └─ retry/restart → query the stored transaction hash; never resubmit
```

**Idempotency Mechanisms**:

- `PaymentAttempt.idempotencyKey`: unique `verify:<paymentHash>` key
- `Settlement.idempotencyKey`: unique `settle:<paymentAttemptId>` key
- `Settlement.requestHash`: immutable payment payload fingerprint; conflicts are rejected
- `claimSettlement()`: atomic `verified` → `settling`; a stale `settling` claim can be reclaimed
  after 60 seconds because no transaction has reached the submission boundary yet
- `recordSubmission()`: one DB transaction stores the signed transaction hash and request identity,
  transitions the attempt to `submitted`, creates its pending receipt, and writes the reconciliation
  outbox event
- The signer callback awaits `recordSubmission()` before returning signed XDR to the upstream
  adapter, which submits it to RPC only after that callback resolves
- `SettlementStore.byTransactionHash`: unique `(transactionHash, network)` prevents duplicate
  transaction evidence

### 3. Horizon Finality Verification (Exact Ledger & Hash Matching)

**RPC Finality Resolution** (`resolveRpcFinality()` in x402Adapter.ts):

- 20 retry attempts with exponential backoff (100ms start, 2000ms cap)
- Total resolution window: ~30 seconds
- Handles three RPC response states:
  - `SUCCESS` with ledger number → confirmed
  - `FAILED` → settlement failed on-chain
  - `PENDING` → retry or timeout
- Aborts on network errors and retries

**Horizon Reconciliation Worker** (`handleSettlementConfirmation()` in settlementConfirmation.ts):

- BullMQ job with 8 retry attempts
- Exponential backoff: 5s → 5s\*2^7 (640s max)
- Uses Stellar SDK `Horizon.Server.transactions()`
- Confirms a transaction is successful and has a positive ledger number
- Rejects queue or receipt transaction hashes that conflict with the persisted settlement hash
- The adapter's RPC finality result is a separate pre-confirmation check; the worker itself uses
  Horizon and does not compare two providers

### 4. Receipt Finalization (Deferred Until Horizon Confirms)

**Attempt, settlement, and receipt transitions**:

```
verified → settling → submitted → confirmed
                         │            └─ settlement confirmed, receipt finalized in one transaction
                         ├─ receipt pending with signed transaction hash
                         └─ pending transaction visibility → retry confirmation only
```

The receipt evidence hash is finalized as
`SHA256(attemptId:paymentHash:txHash:ledger:network:amount:assetIssuer)`. The transaction hash,
ledger, settlement, attempt status, receipt evidence, and receipt outbox event are committed
together. A pending receipt is never returned as finalized evidence.

### 5. Idempotent Retries (No Double Submission)

The system ensures that even with concurrent settlement requests, only one transaction is submitted:

```typescript
// Concurrent requests with same paymentHash
const [result1, result2] = await Promise.all([
  service.settle(request),
  service.settle(request) // Same payload
]);

// Both return same result (no double submission)
assert(result1.transactionHash === result2.transactionHash);
assert(result1.settlementId === result2.settlementId);
```

**Implementation**:

1. `findPaymentAttemptByHash()` identifies the verified attempt and checks the same payload
2. `claimSettlement()` allows only one fresh or stale pre-submit owner
3. Once `recordSubmission()` commits, retries use the stored hash to schedule/continue confirmation
4. The retry path does not call `settleExact()` for a submitted intent
5. Confirmation updates the existing settlement and pending receipt; it does not create a second
  settlement or receipt

### 6. Error Handling & Manual Review

**Failed Transactions** (Settlement.status = "failed"):

- Adapter returned failure during submission
- Transaction hash available (if submitted before failure)
- Marked for manual review via `reconciliationState = "needs_review"`
- Audit log: "settlement.reconciliation.needs_review"

**Timeout Transactions** (Settlement.status = "timed_out"):

- RPC finality polling exhausted 20 attempts
- Transaction hash exists but finality unconfirmed
- Retried by Horizon reconciliation worker
- If reconciliation fails: marked for manual review

**No Double Spending**: All failure states maintain idempotency - retrying a failed settlement with same payload returns the same failure.

## Data Models

### Settlement

```typescript
{
  id: string;                                    // Unique settlement ID
  correlationId: string;                         // Tracking ID
  paymentAttemptId: string;                      // Links to payment attempt
  idempotencyKey: string | null;                  // settle:<paymentAttemptId>
  requestHash: string | null;                    // Canonical payment payload fingerprint
  transactionHash: string | null;                // Stellar transaction hash
  ledger: number | null;                         // Ledger sequence number
  network: NetworkId;                            // testnet | public
  amount: Decimal;                               // Amount in stroops
  assetCode: string;                             // e.g., "USDC"
  assetIssuer: string;                           // Issuer account public key
  status: "pending" | "submitted" | "confirmed" | "failed" | "timed_out";
  reconciliationState:                           // Finality stage
    | "not_required"  // Legacy: settled by adapter
    | "pending"       // Awaiting Horizon confirmation
    | "reconciled"    // Horizon confirmed
    | "needs_review"; // Failed or unresolvable
  reconciliationReason: string | null;           // Failure reason
  reconciliationAttempts: number;                // Retry counter
  lastReconciledAt: DateTime | null;             // Last check time
  settledAt: DateTime | null;                    // When settled
  createdAt: DateTime;
}
```

### Receipt

```typescript
{
  id: string; // Unique receipt ID
  correlationId: string; // Tracking ID
  paymentAttemptId: string; // Links to payment attempt
  resourceId: string | null; // Resource being paid for
  sellerId: string | null; // Seller account
  transactionHash: string | null; // Stellar transaction hash
  ledger: number | null; // Ledger sequence number
  network: NetworkId; // testnet | public
  amount: Decimal; // Amount in stroops
  assetCode: string; // e.g., "USDC"
  assetIssuer: string; // Issuer account public key
  status: "pending" | "finalized"; // Payment proof status
  settledAt: DateTime | null; // Settlement timestamp
  failureCode: string | null; // Error code if failed
  failureReason: string | null; // Error description
  evidenceHash: string; // SHA256 proof of payment
  createdAt: DateTime;
  updatedAt: DateTime;
}
```

### PaymentAttempt

```typescript
{
  id: string;                                    // Unique attempt ID
  correlationId: string;                         // Tracking ID
  resourceId: string | null;                     // Resource identifier
  sellerId: string | null;                       // Seller identifier
  paymentHash: string;                           // Deterministic hash of payload
  idempotencyKey: string;                        // Idempotency key
  network: NetworkId;                            // testnet | public
  assetCode: string;                             // e.g., "USDC"
  assetIssuer: string;                           // Issuer account
  amount: Decimal;                               // Amount in stroops
  payTo: string;                                 // Recipient account
  status:                                        // Verification/settlement stage
    | "verified"   // Payment verified, awaiting settlement
    | "settling"   // Settlement in progress
    | "confirmed"  // Settlement confirmed (awaiting Horizon)
    | "failed";    // Settlement or verification failed
  failureCode: ErrorCode | null;                 // Error classification
  failureReason: string | null;                  // Error message
  expiresAtLedger: number | null;                // Expiry ledger
  createdAt: DateTime;
  updatedAt: DateTime;
}
```

## Flow Diagrams

### Settlement Submission Flow

```
POST /settle
    ↓
1. Parse & validate x402 v2 payload
    ↓
2. Compute paymentHash (deterministic)
    ↓
3. findPaymentAttemptByHash → NOT FOUND?
    ├─ YES: Error "Payment attempt not found"
    └─ NO: Continue
    ↓
4. checkExistingResult() → Settlement exists?
    ├─ YES (confirmed): Return cached result
    ├─ YES (failed/timed_out): Return cached error
    └─ NO: Continue
    ↓
5. claimSettlement(attemptId) → Atomic verified→settling transition
    ├─ NULL: Another request is settling, waitForDurableResult()
    └─ SUCCESS: Continue
    ↓
6. adapter.verifyExact() → Fresh verification
    ├─ FAIL: Record attempt as failed, throw error
    └─ SUCCESS: Continue
    ↓
7. adapter.settleExact() → Submit to Stellar RPC
    ├─ FAIL: recordFailedSettlement(), enqueue reconciliation if txHash exists
    ├─ TIMED_OUT: recordFailedSettlement(), enqueue reconciliation
    └─ SUCCESS (confirmed + ledger): Continue
    ↓
8. Create settlement record
    status = "confirmed"
    reconciliationState = "pending" (if txHash) or "not_required"
    transactionHash = adapter result
    ledger = adapter result
    ↓
9. Update payment attempt
    status = "confirmed"
    ↓
10. Create/finalize receipt
    status = "pending" (will be finalized by reconciliation worker)
    ↓
11. Audit log: "payment.settle"
    ↓
12. Return SettlementServiceResult
    status = "confirmed"
    transactionHash, ledger, settlementId, receiptId
```

### Horizon Reconciliation Flow

```
BullMQ Job: SettlementConfirmationJobData
    ↓
1. Load paymentAttempt with settlement and receipt
    ↓
2. Is settlement already finalized?
    ├─ YES: Return success
    └─ NO: Continue
    ↓
3. Get transactionHash from settlement or job data
    ├─ NULL: Mark needs_review, return
    └─ NOT NULL: Continue
    ↓
4. statusClient.getTransactionState(txHash, network)
    Uses Horizon.Server.transactions().transaction(hash).call()
    ↓
5. Response handling:

    a) PENDING:
       ├─ Update reconciliationState = "pending"
       ├─ Increment reconciliationAttempts
       ├─ Throw ReconciliationPendingError
       └─ BullMQ retries job

    b) FAILED:
       ├─ Call recordNeedsReview()
       ├─ Update settlement.reconciliationState = "needs_review"
       ├─ Return (stop processing)
       └─ Manual review required

    c) CONFIRMED:
       ├─ Verify ledger matches settlement.ledger
       ├─ Compute evidenceHash
       ├─ Create/update receipt with evidenceHash
       ├─ Finalize receipt.status = "finalized"
       ├─ Update settlement.reconciliationState = "reconciled"
       ├─ Update paymentAttempt.status = "confirmed"
       ├─ Create audit log: "settlement.reconciliation.confirmed"
       └─ Return success
    ↓
6. Retry Strategy (if pending):
    Attempt 1: Immediate
    Attempt 2: 5s delay
    Attempt 3: 10s delay
    Attempt 4: 20s delay
    Attempt 5: 40s delay
    Attempt 6: 80s delay
    Attempt 7: 160s delay
    Attempt 8: 320s delay (max: 640s)

    Total window: ~15 minutes of retries
```

## Configuration

Required environment variables:

```
# Network Configuration
STELLAR_TESTNET_RPC_URL=http://stellar-testnet.stellar.org/soroban/rpc
STELLAR_TESTNET_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_PUBLIC_RPC_URL=http://stellar.stellar.org/soroban/rpc
STELLAR_PUBLIC_HORIZON_URL=https://horizon.stellar.org

# Settlement Configuration
SETTLEMENT_MAX_TRANSACTION_FEE_STROOPS=100000
SETTLEMENT_INCLUSION_FEE_STROOPS=1000

# Facilitator Signing
STELLAR_FACILITATOR_SECRET=<secret-key>

# Redis for BullMQ
REDIS_URL=redis://localhost:6379
```

## Testing

### Unit Tests

- `settlement.horizonFinality.test.ts`: Settlement service with mocked adapter
- `rpcFinalityRetry.test.ts`: RPC finality retry logic with exponential backoff

### Integration Tests

- `settlement.testnetE2e.integration.test.ts`: End-to-end with actual Horizon

### Running Tests

```bash
# Unit tests (fast)
pnpm test packages/stellar-payments/src/settlement.horizonFinality.test.ts

# RPC retry tests (fast)
pnpm test packages/stellar-payments/src/rpcFinalityRetry.test.ts

# E2E integration (requires TESTNET_FACILITATOR_SECRET)
TESTNET_FACILITATOR_SECRET=... pnpm test packages/stellar-payments/src/settlement.testnetE2e.integration.test.ts
```

## Validation Checklist

- [x] Funded testnet vector produces real successful transaction
- [x] Hash and ledger match network record (Horizon confirms)
- [x] Timeout and failed transaction states remain non-final
- [x] Idempotent retries do not submit twice
- [x] Receipt not finalized until Horizon confirms
- [x] Evidence hash computed and verified
- [x] Audit trails for all state transitions
- [x] Manual review process for failed settlements
- [x] No pending, failed, or synthetic results issued as receipts
