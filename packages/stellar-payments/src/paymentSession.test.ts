import { describe, expect, it, vi } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import {
  InMemoryPaymentSessionStore,
  PaymentSessionService,
  createGeneratedUptoSessionBindings,
  type GeneratedUptoSessionClient
} from "./index.js";

const contractId = "CDLZUPTOSESSIONCONTRACT000000000000000000000000000000000";
const assetContractId = "CDLZUSDCTOKENCONTRACT0000000000000000000000000000000000";
const usageHash = "a".repeat(64);

describe("PaymentSessionService", () => {
  it("fails closed when capped sessions are disabled", async () => {
    const service = new PaymentSessionService(loadConfig({}));

    await expect(service.createSession(sessionRequest())).rejects.toMatchObject({
      code: "VALIDATION_FAILED"
    });
  });

  it("creates contract-backed capped sessions and stores generated IDs", async () => {
    const client: GeneratedUptoSessionClient = {
      create_session: vi.fn(async () => "contract_session_1"),
      settle: vi.fn()
    };
    const service = new PaymentSessionService(enabledConfig(), {
      bindings: createGeneratedUptoSessionBindings(() => client),
      store: new InMemoryPaymentSessionStore()
    });

    const session = await service.createSession(sessionRequest());

    expect(session).toMatchObject({
      network: "stellar:testnet",
      buyer: localIssuerPublicKey,
      capAmount: "1",
      spentAmount: "0",
      remainingAmount: "1",
      contractId,
      contractSessionId: "contract_session_1",
      assetContractId,
      status: "open"
    });
    expect(client.create_session).toHaveBeenCalledWith(
      localIssuerPublicKey,
      localIssuerPublicKey,
      assetContractId,
      10_000_000n,
      50,
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
  });

  it("refuses synthetic bindings when upto is enabled outside local development", () => {
    expect(
      () =>
        new PaymentSessionService(
          loadConfig({
            ENABLE_UPTO_SCHEME: "true",
            LUMEN_ENV: "testnet"
          })
        )
    ).toThrow("ENABLE_UPTO_SCHEME requires live Soroban bindings");
  });

  it("settles once up to the capped amount without using exact payment payloads", async () => {
    const client: GeneratedUptoSessionClient = {
      create_session: vi.fn(async () => "contract_session_2"),
      settle: vi.fn(async () => ({ transactionHash: "tx_upto_1", ledger: 321 }))
    };
    const service = new PaymentSessionService(enabledConfig(), {
      bindings: createGeneratedUptoSessionBindings(() => client)
    });
    const session = await service.createSession(sessionRequest());

    const settled = await service.settleSession({
      sessionId: session.id,
      amount: "0.25",
      usageHash,
      currentLedger: 25
    });

    expect(settled).toMatchObject({
      scheme: "upto",
      id: session.id,
      status: "settled",
      spentAmount: "0.25",
      remainingAmount: "0.75",
      transactionHash: "tx_upto_1",
      ledger: 321
    });
    expect(client.settle).toHaveBeenCalledWith("contract_session_2", 2_500_000n, usageHash);
    await expect(
      service.settleSession({
        sessionId: session.id,
        amount: "0.01",
        usageHash: "b".repeat(64)
      })
    ).rejects.toMatchObject({
      code: "REPLAY_DETECTED"
    });
  });

  it("rejects generated clients that omit on-chain settlement evidence", async () => {
    const client: GeneratedUptoSessionClient = {
      create_session: vi.fn(async () => "contract_session_missing_evidence"),
      settle: vi.fn(async () => undefined)
    };
    const service = new PaymentSessionService(enabledConfig(), {
      bindings: createGeneratedUptoSessionBindings(() => client)
    });
    const session = await service.createSession(sessionRequest());

    await expect(
      service.settleSession({
        sessionId: session.id,
        amount: "0.25",
        usageHash
      })
    ).rejects.toThrow("did not return transaction hash and ledger evidence");
  });

  it("rejects over-cap, expired, and invalid usage-hash settlements", async () => {
    const service = new PaymentSessionService(enabledConfig());
    const session = await service.createSession(sessionRequest());

    await expect(
      service.settleSession({
        sessionId: session.id,
        amount: "1.01",
        usageHash
      })
    ).rejects.toMatchObject({
      code: "AMOUNT_MISMATCH"
    });
    await expect(
      service.settleSession({
        sessionId: session.id,
        amount: "0.01",
        usageHash: "0".repeat(64)
      })
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_PAYLOAD"
    });
    await expect(
      service.settleSession({
        sessionId: session.id,
        amount: "0.01",
        usageHash,
        currentLedger: 50
      })
    ).rejects.toMatchObject({
      code: "AUTH_EXPIRED"
    });
  });
});

function enabledConfig() {
  return loadConfig({
    ENABLE_UPTO_SCHEME: "true",
    STELLAR_TESTNET_UPTO_SESSION_CONTRACT_ID: contractId,
    STELLAR_TESTNET_USDC_CONTRACT_ID: assetContractId
  });
}

function sessionRequest() {
  return {
    scheme: "upto",
    network: "stellar:testnet",
    buyer: localIssuerPublicKey,
    asset: {
      code: "USDC",
      issuer: localIssuerPublicKey
    },
    capAmount: "1.00",
    payTo: localIssuerPublicKey,
    resourceId: "resource_upto_1",
    sellerId: "seller_upto_1",
    expiresAtLedger: 50,
    currentLedger: 25
  };
}
