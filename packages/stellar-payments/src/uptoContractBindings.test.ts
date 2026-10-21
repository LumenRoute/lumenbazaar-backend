import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import {
  createGeneratedUptoSessionBindings,
  createLocalUptoSessionContractBindings,
  createStellarSdkUptoSessionBindings,
  mapSorobanError,
  type GeneratedUptoSessionClient,
  type SorobanRpcClientLike
} from "./uptoContractBindings.js";
import { type FacilitatorSignerProvider } from "./facilitatorSigner.js";

const contractId = "CD7CTRMZ3AZBJ672KIYU7ZBAKF34WQT3A7GWQWVBNWGCTPFBFNLK5P47";
const assetContractId = "CBKZELMURIRIRK5D533ANHFKUSBD6FMF7RWQWRLPZC7IKXGO5XIQTUX2";
const usageHash = "a".repeat(64);
const resourceHash = "b".repeat(64);

const buyerKeypair = Keypair.random();
const sellerKeypair = Keypair.random();
const facilitatorKeypair = Keypair.random();

function mockSignerProvider(): FacilitatorSignerProvider {
  return {
    assertReady: vi.fn(async () => {}),
    getSigner: vi.fn(async () => ({
      address: facilitatorKeypair.publicKey(),
      signTransaction: vi.fn(async (xdr: string) => ({
        signedTxXdr: xdr,
        signerAddress: facilitatorKeypair.publicKey()
      })),
      signAuthEntry: vi.fn()
    })),
    getSignerByKeyId: vi.fn(),
    getStatus: vi.fn(async () => ({
      address: facilitatorKeypair.publicKey(),
      keyVersion: "v1",
      keyId: "key-1",
      state: "active" as const,
      network: "stellar:testnet" as const,
      provider: "environment" as const
    })),
    getAuditEvents: vi.fn(async () => [])
  };
}

function testConfig() {
  return loadConfig({
    ENABLE_UPTO_SCHEME: "true",
    STELLAR_TESTNET_UPTO_SESSION_CONTRACT_ID: contractId,
    STELLAR_TESTNET_USDC_CONTRACT_ID: assetContractId,
    STELLAR_TESTNET_USDC_ISSUER: localIssuerPublicKey
  });
}

describe("mapSorobanError", () => {
  it("maps signature and unauthorized errors to INVALID_SIGNATURE", () => {
    expect(mapSorobanError("HostError: Error(Auth, InvalidAction)").code).toBe("INVALID_SIGNATURE");
    expect(mapSorobanError("Bad signature for invocation").code).toBe("INVALID_SIGNATURE");
  });

  it("maps expired errors to AUTH_EXPIRED", () => {
    expect(mapSorobanError("Contract call expired at ledger 50").code).toBe("AUTH_EXPIRED");
    expect(mapSorobanError("timebound expiration passed").code).toBe("AUTH_EXPIRED");
  });

  it("maps balance and cap errors to AMOUNT_MISMATCH", () => {
    expect(mapSorobanError("Insufficient balance in account").code).toBe("AMOUNT_MISMATCH");
    expect(mapSorobanError("Amount exceeds max session cap").code).toBe("AMOUNT_MISMATCH");
  });

  it("maps asset and contract errors to ASSET_MISMATCH", () => {
    expect(mapSorobanError("Invalid asset trustline").code).toBe("ASSET_MISMATCH");
  });

  it("maps duplicate and already exists errors to REPLAY_DETECTED", () => {
    expect(mapSorobanError("Session already exists").code).toBe("REPLAY_DETECTED");
    expect(mapSorobanError("duplicate invocation detected").code).toBe("REPLAY_DETECTED");
  });

  it("maps unknown errors to SETTLEMENT_FAILED", () => {
    expect(mapSorobanError("Some unknown node panic").code).toBe("SETTLEMENT_FAILED");
  });
});

describe("createStellarSdkUptoSessionBindings", () => {
  it("creates a session, returning actual non-null transaction hash and ledger", async () => {
    const rpcClient: SorobanRpcClientLike = {
      simulateTransaction: vi.fn(async () => ({
        result: {
          retval: "sc_session_123"
        }
      })),
      sendTransaction: vi.fn(async () => ({
        status: "PENDING",
        hash: "tx_hash_create_123"
      }))
    };

    const resolveFinality = vi.fn(async () => ({
      status: "confirmed" as const,
      ledger: 42
    }));

    const bindings = createStellarSdkUptoSessionBindings({
      config: testConfig(),
      signerProvider: mockSignerProvider(),
      rpcClient,
      resolveFinality
    });

    const result = await bindings.createSession({
      assetContractId,
      buyer: buyerKeypair.publicKey(),
      seller: sellerKeypair.publicKey(),
      contractId,
      expiresAtLedger: 100,
      maxAmountStroops: 10_000_000n,
      network: "stellar:testnet",
      resourceHash
    });

    expect(result).toEqual({
      contractSessionId: "sc_session_123",
      ledger: 42,
      transactionHash: "tx_hash_create_123"
    });
    expect(rpcClient.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(rpcClient.sendTransaction).toHaveBeenCalledTimes(1);
    expect(resolveFinality).toHaveBeenCalledWith({
      network: "stellar:testnet",
      rpcUrl: expect.any(String),
      transactionHash: "tx_hash_create_123"
    });
  });

  it("settles a session, returning actual non-null transaction hash and ledger", async () => {
    const rpcClient: SorobanRpcClientLike = {
      simulateTransaction: vi.fn(async () => ({
        result: {}
      })),
      sendTransaction: vi.fn(async () => ({
        status: "PENDING",
        hash: "tx_hash_settle_456"
      }))
    };

    const resolveFinality = vi.fn(async () => ({
      status: "confirmed" as const,
      ledger: 99
    }));

    const bindings = createStellarSdkUptoSessionBindings({
      config: testConfig(),
      signerProvider: mockSignerProvider(),
      rpcClient,
      resolveFinality
    });

    const result = await bindings.settleSession({
      contractId,
      contractSessionId: "sc_session_123",
      network: "stellar:testnet",
      actualAmountStroops: 2_500_000n,
      usageHash,
      seller: sellerKeypair.publicKey(),
      buyer: buyerKeypair.publicKey()
    });

    expect(result).toEqual({
      ledger: 99,
      transactionHash: "tx_hash_settle_456"
    });
    expect(rpcClient.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(rpcClient.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("enforces buyer and seller authorization requirements", async () => {
    const bindings = createStellarSdkUptoSessionBindings({
      config: testConfig(),
      signerProvider: mockSignerProvider()
    });

    // Invalid buyer public key
    await expect(
      bindings.createSession({
        assetContractId,
        buyer: "invalid-key",
        seller: sellerKeypair.publicKey(),
        contractId,
        expiresAtLedger: 100,
        maxAmountStroops: 10_000_000n,
        network: "stellar:testnet",
        resourceHash
      })
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_PAYLOAD"
    });

    // Invalid seller public key on create
    await expect(
      bindings.createSession({
        assetContractId,
        buyer: buyerKeypair.publicKey(),
        seller: "invalid-key",
        contractId,
        expiresAtLedger: 100,
        maxAmountStroops: 10_000_000n,
        network: "stellar:testnet",
        resourceHash
      })
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_PAYLOAD"
    });

    // Missing seller on settle
    await expect(
      bindings.settleSession({
        contractId,
        contractSessionId: "sc_session_123",
        network: "stellar:testnet",
        actualAmountStroops: 2_500_000n,
        usageHash
      })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED"
    });
  });

  it("maps simulation failure to stable LumenError codes", async () => {
    const rpcClient: SorobanRpcClientLike = {
      simulateTransaction: vi.fn(async () => {
        throw new Error("HostError: Error(Auth, BadSignature)");
      })
    };

    const bindings = createStellarSdkUptoSessionBindings({
      config: testConfig(),
      signerProvider: mockSignerProvider(),
      rpcClient
    });

    await expect(
      bindings.createSession({
        assetContractId,
        buyer: buyerKeypair.publicKey(),
        seller: sellerKeypair.publicKey(),
        contractId,
        expiresAtLedger: 100,
        maxAmountStroops: 10_000_000n,
        network: "stellar:testnet",
        resourceHash
      })
    ).rejects.toMatchObject({
      code: "INVALID_SIGNATURE"
    });
  });

  it("maps duplicate submission status to REPLAY_DETECTED", async () => {
    const rpcClient: SorobanRpcClientLike = {
      simulateTransaction: vi.fn(async () => ({ result: {} })),
      sendTransaction: vi.fn(async () => ({
        status: "DUPLICATE",
        hash: "tx_dup"
      }))
    };

    const bindings = createStellarSdkUptoSessionBindings({
      config: testConfig(),
      signerProvider: mockSignerProvider(),
      rpcClient
    });

    await expect(
      bindings.createSession({
        assetContractId,
        buyer: buyerKeypair.publicKey(),
        seller: sellerKeypair.publicKey(),
        contractId,
        expiresAtLedger: 100,
        maxAmountStroops: 10_000_000n,
        network: "stellar:testnet",
        resourceHash
      })
    ).rejects.toMatchObject({
      code: "REPLAY_DETECTED"
    });
  });

  it("maps on-chain finality failure to SETTLEMENT_FAILED", async () => {
    const rpcClient: SorobanRpcClientLike = {
      simulateTransaction: vi.fn(async () => ({ result: {} })),
      sendTransaction: vi.fn(async () => ({
        status: "PENDING",
        hash: "tx_failed_finality"
      }))
    };

    const resolveFinality = vi.fn(async () => ({
      status: "failed" as const
    }));

    const bindings = createStellarSdkUptoSessionBindings({
      config: testConfig(),
      signerProvider: mockSignerProvider(),
      rpcClient,
      resolveFinality
    });

    await expect(
      bindings.createSession({
        assetContractId,
        buyer: buyerKeypair.publicKey(),
        seller: sellerKeypair.publicKey(),
        contractId,
        expiresAtLedger: 100,
        maxAmountStroops: 10_000_000n,
        network: "stellar:testnet",
        resourceHash
      })
    ).rejects.toMatchObject({
      code: "SETTLEMENT_FAILED"
    });
  });
});

describe("createGeneratedUptoSessionBindings", () => {
  it("enforces seller authorization and extracts actual ledger/hash evidence", async () => {
    const client: GeneratedUptoSessionClient = {
      create_session: vi.fn(async () => ({
        contractSessionId: "gen_session_1",
        ledger: 10,
        transactionHash: "tx_gen_create"
      })),
      settle: vi.fn(async () => ({
        ledger: 11,
        transactionHash: "tx_gen_settle"
      }))
    };

    const bindings = createGeneratedUptoSessionBindings(() => client);

    const created = await bindings.createSession({
      assetContractId,
      buyer: buyerKeypair.publicKey(),
      seller: sellerKeypair.publicKey(),
      contractId,
      expiresAtLedger: 50,
      maxAmountStroops: 5_000_000n,
      network: "stellar:testnet",
      resourceHash
    });

    expect(created).toEqual({
      contractSessionId: "gen_session_1",
      ledger: 10,
      transactionHash: "tx_gen_create"
    });

    // Settle requires seller authorization
    await expect(
      bindings.settleSession({
        contractId,
        contractSessionId: "gen_session_1",
        network: "stellar:testnet",
        actualAmountStroops: 1_000_000n,
        usageHash
      })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED"
    });

    const settled = await bindings.settleSession({
      contractId,
      contractSessionId: "gen_session_1",
      network: "stellar:testnet",
      actualAmountStroops: 1_000_000n,
      usageHash,
      seller: sellerKeypair.publicKey()
    });

    expect(settled).toEqual({
      ledger: 11,
      transactionHash: "tx_gen_settle"
    });
  });
});

describe("createLocalUptoSessionContractBindings", () => {
  it("returns non-null ledger and transaction hash for local contracts", async () => {
    const bindings = createLocalUptoSessionContractBindings();

    const created = await bindings.createSession({
      assetContractId,
      buyer: buyerKeypair.publicKey(),
      seller: sellerKeypair.publicKey(),
      contractId,
      expiresAtLedger: 50,
      maxAmountStroops: 5_000_000n,
      network: "stellar:testnet",
      resourceHash
    });

    expect(created.ledger).toBeTypeOf("number");
    expect(created.transactionHash).toBeTypeOf("string");

    const settled = await bindings.settleSession({
      contractId,
      contractSessionId: created.contractSessionId,
      network: "stellar:testnet",
      actualAmountStroops: 1_000_000n,
      usageHash,
      seller: sellerKeypair.publicKey()
    });

    expect(settled.ledger).toBeTypeOf("number");
    expect(settled.transactionHash).toBeTypeOf("string");
  });
});
