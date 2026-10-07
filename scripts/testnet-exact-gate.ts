import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

import {
  fetchReceipt,
  runPaidResourceFlow,
  serializePaymentPayload,
  settlePayment,
  type PaidResourceFlowResult,
  type PaymentPayload,
  type PaymentRequirements,
  type ReceiptResult,
  type SettlePaymentResult
} from "../packages/buyer-sdk/src/index.js";
import { decodePaymentRequiredV2 } from "../packages/stellar-payments/src/index.js";

import {
  probeTestnetDeployment,
  type TestnetEndpointManifest,
  type TestnetProbeEvidence
} from "./testnet-probe.js";

export type ExactGateEvidence = {
  authorizationHash: string;
  checkedAt: string;
  deployment: TestnetProbeEvidence;
  paidResponse: {
    bodyHash: string;
    statusCode: number;
  };
  receipt: ReceiptResult;
  restartConfirmedByOperator: true;
  settlement: {
    correlationId: string;
    ledger: number;
    receiptId: string;
    transactionHash: string;
  };
};

export type ExactGateDependencies = {
  fetchImpl?: typeof fetch;
  restartGate: () => Promise<void>;
  sign: (requirements: PaymentRequirements, resource: { url: string }) => Promise<PaymentPayload>;
  runFlow?: (options: {
    apiUrl: string;
    paymentPayload: PaymentPayload;
    resourceId: string;
    resourceUrl: string;
  }) => Promise<PaidResourceFlowResult>;
  settle?: (
    apiUrl: string,
    input: {
      x402Version: 2;
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    }
  ) => Promise<SettlePaymentResult>;
  receipt?: (apiUrl: string, receiptId: string) => Promise<ReceiptResult>;
};

export async function runExactTestnetGate(
  manifest: TestnetEndpointManifest,
  deployment: TestnetProbeEvidence,
  dependencies: ExactGateDependencies
): Promise<ExactGateEvidence> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const challengeResponse = await fetchImpl(manifest.paidResource.resourceUrl, {
    method: "GET",
    signal: AbortSignal.timeout(30_000)
  });
  if (challengeResponse.status !== 402) {
    throw new Error(`Paid resource returned HTTP ${challengeResponse.status} instead of 402.`);
  }
  const encodedChallenge = challengeResponse.headers.get("payment-required");
  if (encodedChallenge === null) throw new Error("Paid resource omitted PAYMENT-REQUIRED.");
  const challenge = decodePaymentRequiredV2(encodedChallenge);
  const requirements = challenge.accepts.find(
    (accept) => accept.scheme === "exact" && accept.network === "stellar:testnet"
  ) as PaymentRequirements | undefined;
  if (challenge.x402Version !== 2 || requirements === undefined) {
    throw new Error("Paid resource challenge is not official v2 Stellar exact.");
  }

  const paymentPayload = await dependencies.sign(requirements, {
    url: manifest.paidResource.resourceUrl
  });
  assertSameRequirements(paymentPayload.accepted, requirements);

  const runFlow = dependencies.runFlow ?? ((options) => runPaidResourceFlow(options));
  const flow = await runFlow({
    apiUrl: manifest.api.baseUrl,
    paymentPayload,
    resourceId: manifest.paidResource.resourceId,
    resourceUrl: manifest.paidResource.resourceUrl
  });
  if (!flow.call.success || flow.settlement === undefined || flow.receipt === undefined) {
    throw new Error("Exact payment flow did not return a paid response, settlement, and receipt.");
  }
  assertFinalReceipt(flow.receipt);

  await dependencies.restartGate();

  const receiptLookup = dependencies.receipt ?? fetchReceipt;
  const settle = dependencies.settle ?? settlePayment;
  const restartedReceipt = await receiptLookup(manifest.api.baseUrl, flow.receipt.id);
  const repeatedSettlement = await settle(manifest.api.baseUrl, {
    x402Version: 2,
    paymentPayload,
    paymentRequirements: requirements
  });
  assertFinalReceipt(restartedReceipt);
  if (
    restartedReceipt.transactionHash !== flow.receipt.transactionHash ||
    repeatedSettlement.transaction !== flow.settlement.transaction ||
    repeatedSettlement.extra.lumenbazaar.receiptId !== flow.receipt.id
  ) {
    throw new Error("Receipt or settlement identity changed after the service restart.");
  }

  return {
    authorizationHash: sha256(serializePaymentPayload(paymentPayload)),
    checkedAt: new Date().toISOString(),
    deployment,
    paidResponse: {
      bodyHash: sha256(JSON.stringify(flow.call.data ?? {})),
      statusCode: flow.call.statusCode ?? 200
    },
    receipt: restartedReceipt,
    restartConfirmedByOperator: true,
    settlement: {
      correlationId: flow.settlement.extra.lumenbazaar.correlationId,
      ledger: flow.settlement.extra.lumenbazaar.ledger,
      receiptId: flow.settlement.extra.lumenbazaar.receiptId,
      transactionHash: flow.settlement.transaction
    }
  };
}

export function createOfficialTestnetSigner(privateKey: string) {
  const scheme = new ExactStellarScheme(createEd25519Signer(privateKey, "stellar:testnet"));
  return async (requirements: PaymentRequirements, resource: { url: string }) => {
    const signed = await scheme.createPaymentPayload(2, requirements);
    return {
      x402Version: 2,
      resource,
      accepted: requirements,
      payload: signed.payload
    } as PaymentPayload;
  };
}

function assertSameRequirements(actual: PaymentRequirements, expected: PaymentRequirements) {
  for (const key of ["scheme", "network", "asset", "amount", "payTo"] as const) {
    if (actual[key] !== expected[key]) {
      throw new Error(`Signed payload changed challenge field ${key}.`);
    }
  }
}

function assertFinalReceipt(receipt: ReceiptResult) {
  if (
    receipt.status !== "finalized" ||
    receipt.id.length === 0 ||
    receipt.transactionHash.length === 0 ||
    !Number.isInteger(receipt.ledger)
  ) {
    throw new Error("Receipt is not finalized with transaction and ledger evidence.");
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function main() {
  const privateKey = process.env.CLIENT_PRIVATE_KEY;
  if (privateKey === undefined || privateKey.length === 0) {
    throw new Error("CLIENT_PRIVATE_KEY is required and must be supplied through secret storage.");
  }
  const manifestPath = argument("--manifest") ?? "docs/deployment/testnet-endpoints.json";
  const outputPath = argument("--output") ?? "deployment-evidence/testnet-exact-flow.json";
  const manifest = JSON.parse(
    await readFile(resolve(manifestPath), "utf8")
  ) as TestnetEndpointManifest;
  const deployment = await probeTestnetDeployment(manifest);
  const evidence = await runExactTestnetGate(manifest, deployment, {
    sign: createOfficialTestnetSigner(privateKey),
    restartGate: waitForRestart
  });
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence, null, 2));
}

async function waitForRestart() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prompt.question(
      "Restart the pinned API and worker services, wait for readiness, then press Enter to verify durable evidence: "
    );
  } finally {
    prompt.close();
  }
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (entrypoint === import.meta.url) {
  await main();
}
