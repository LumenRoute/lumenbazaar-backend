import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { buildApiApp } from "../app.js";

const contractId = "CDLZUPTOSESSIONCONTRACT000000000000000000000000000000000";
const assetContractId = "CDLZUSDCTOKENCONTRACT0000000000000000000000000000000000";
const usageHash = "c".repeat(64);

describe("payment session routes", () => {
  it("keeps capped sessions behind deployment configuration", async () => {
    const app = buildApiApp({
      logger: false,
      config: loadConfig({ ENABLE_UPTO_SCHEME: "true" })
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/payment-sessions",
      payload: sessionRequest()
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("SETTLEMENT_FAILED");
    await app.close();
  });

  it("creates, fetches, and settles capped sessions through isolated routes", async () => {
    const app = buildApiApp({
      logger: false,
      config: enabledConfig()
    });

    const supported = await app.inject({ method: "GET", url: "/v1/supported" });
    const created = await app.inject({
      method: "POST",
      url: "/v1/payment-sessions",
      payload: sessionRequest()
    });
    const fetched = await app.inject({
      method: "GET",
      url: `/v1/payment-sessions/${created.json().id}`
    });
    const settled = await app.inject({
      method: "POST",
      url: `/v1/payment-sessions/${created.json().id}/settle`,
      payload: {
        amount: "0.25",
        usageHash,
        currentLedger: 25
      }
    });

    expect(supported.json()).toMatchObject({
      schemes: expect.arrayContaining([
        expect.objectContaining({
          name: "upto",
          network: "stellar:testnet",
          assets: [
            {
              code: "USDC",
              issuer: localIssuerPublicKey,
              contractId: assetContractId,
              decimals: 7
            }
          ],
          extensions: expect.objectContaining({
            contractId,
            sessionEndpoint: "/v1/payment-sessions"
          })
        })
      ]),
      extensions: {
        upto: true,
        uptoContracts: [
          {
            network: "stellar:testnet",
            contractId
          }
        ]
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      network: "stellar:testnet",
      capAmount: "1",
      remainingAmount: "1",
      status: "open",
      contractId,
      assetContractId
    });
    expect(fetched.json()).toEqual(created.json());
    expect(settled.statusCode).toBe(200);
    expect(settled.json()).toMatchObject({
      scheme: "upto",
      id: created.json().id,
      status: "settled",
      spentAmount: "0.25",
      remainingAmount: "0.75"
    });
    await app.close();
  });

  it("does not route upto payloads through exact settlement", async () => {
    const app = buildApiApp({
      logger: false,
      config: enabledConfig()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/settle",
      payload: {
        paymentAttemptId: "attempt_1",
        paymentPayload: {
          scheme: "upto",
          network: "stellar:testnet",
          sessionId: "payment_session_1",
          amount: "0.01",
          usageHash
        },
        paymentRequirements: {
          scheme: "upto",
          network: "stellar:testnet",
          amount: "1",
          payTo: localIssuerPublicKey
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PAYMENT_PAYLOAD");
    await app.close();
  });

  it("uses the route session ID over any settlement body session ID", async () => {
    const app = buildApiApp({
      logger: false,
      config: enabledConfig()
    });
    const first = await app.inject({
      method: "POST",
      url: "/v1/payment-sessions",
      payload: sessionRequest("route_session_first")
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/payment-sessions",
      payload: sessionRequest("route_session_second")
    });

    const settled = await app.inject({
      method: "POST",
      url: `/v1/payment-sessions/${first.json().id}/settle`,
      payload: {
        sessionId: second.json().id,
        amount: "0.25",
        usageHash
      }
    });
    const fetchedFirst = await app.inject({
      method: "GET",
      url: `/v1/payment-sessions/${first.json().id}`
    });
    const fetchedSecond = await app.inject({
      method: "GET",
      url: `/v1/payment-sessions/${second.json().id}`
    });

    expect(settled.statusCode).toBe(200);
    expect(settled.json().id).toBe(first.json().id);
    expect(fetchedFirst.json().status).toBe("settled");
    expect(fetchedSecond.json().status).toBe("open");
    await app.close();
  });
});

function enabledConfig() {
  return loadConfig({
    ENABLE_UPTO_SCHEME: "true",
    STELLAR_TESTNET_UPTO_SESSION_CONTRACT_ID: contractId,
    STELLAR_TESTNET_USDC_CONTRACT_ID: assetContractId
  });
}

function sessionRequest(resourceId = "resource_upto_route") {
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
    resourceId,
    sellerId: "seller_upto_route",
    expiresAtLedger: 50,
    currentLedger: 25
  };
}
