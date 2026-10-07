import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  type Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr
} from "@stellar/stellar-sdk";
import type * as StellarSdkModule from "@stellar/stellar-sdk";
import {
  type PaymentPayload,
  type PaymentRequirements,
  type VerifyResponse
} from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";

import { testAssetContractId } from "@lumenbazaar/testkit";

const alternateAsset = StrKey.encodeContract(Buffer.alloc(32, 1));
// Auth fixtures must use the verifier's SDK copy because x402 compares XDR union arms by identity.
const officialRequire = createRequire(import.meta.resolve("@x402/stellar/exact/facilitator"));
const officialSdkCjsEntry = officialRequire.resolve("@stellar/stellar-sdk");
const officialSdkEntry = resolve(
  dirname(dirname(dirname(officialSdkCjsEntry))),
  "lib/esm/index.js"
);
const officialStellarSdk = (await import(
  pathToFileURL(officialSdkEntry).href
)) as typeof StellarSdkModule;

describe("official @x402/stellar exact verifier fixtures", () => {
  const payer = Keypair.random();
  const recipient = Keypair.random();
  const alternateRecipient = Keypair.random();
  const facilitator = Keypair.random();
  const scheme = new ExactStellarScheme([
    createEd25519Signer(facilitator.secret(), "stellar:testnet")
  ]);
  const requirements = requirement(recipient.publicKey());

  it("rejects a non-invocation operation", async () => {
    const transaction = new TransactionBuilder(new Account(payer.publicKey(), "0"), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET
    })
      .addOperation(
        Operation.payment({
          destination: recipient.publicKey(),
          asset: Asset.native(),
          amount: "1"
        })
      )
      .setTimeout(60)
      .build()
      .toXDR();

    await expect(
      scheme.verify(payload(requirements, transaction), requirements)
    ).resolves.toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_wrong_operation"
    });
  });

  it("rejects a network mismatch before RPC simulation", async () => {
    const accepted = { ...requirements, network: "stellar:pubnet" } as PaymentRequirements;

    await expect(
      scheme.verify(
        payload(accepted, transferXdr({ payer, recipient: recipient.publicKey() })),
        requirements
      )
    ).resolves.toMatchObject({ isValid: false, invalidReason: "network_mismatch" });
  });

  it.each([
    {
      name: "asset contract",
      transaction: transferXdr({
        payer,
        recipient: recipient.publicKey(),
        asset: alternateAsset
      }),
      reason: "invalid_exact_stellar_payload_wrong_asset"
    },
    {
      name: "amount",
      transaction: transferXdr({ payer, recipient: recipient.publicKey(), amount: 499999n }),
      reason: "invalid_exact_stellar_payload_wrong_amount"
    },
    {
      name: "recipient",
      transaction: transferXdr({ payer, recipient: alternateRecipient.publicKey() }),
      reason: "invalid_exact_stellar_payload_wrong_recipient"
    },
    {
      name: "facilitator payer exclusion",
      transaction: transferXdr({
        payer,
        from: facilitator.publicKey(),
        recipient: recipient.publicKey()
      }),
      reason: "invalid_exact_stellar_payload_facilitator_is_payer"
    },
    {
      name: "facilitator transaction source exclusion",
      transaction: transferXdr({ payer: facilitator, recipient: recipient.publicKey() }),
      reason: "invalid_exact_stellar_payload_unsafe_tx_or_op_source"
    }
  ])("rejects a mutated $name invariant", async ({ transaction, reason }) => {
    await expect(
      scheme.verify(payload(requirements, transaction), requirements)
    ).resolves.toMatchObject({
      isValid: false,
      invalidReason: reason
    });
  });

  it("accepts a signed payer authorization entry in the official auth validator", async () => {
    const authorization = await signedAuthorization(payer, 102);
    const transaction = parsedTransfer({
      payer,
      recipient: recipient.publicKey(),
      auth: [authorization]
    });

    expect(validateOfficialAuth(scheme, transaction, payer.publicKey(), 100)).toBeUndefined();
  });

  it.each([
    {
      name: "missing payer signature",
      signer: alternateRecipient,
      expiration: 102,
      reason: "invalid_exact_stellar_payload_missing_payer_signature"
    },
    {
      name: "authorization expiry beyond the payment window",
      signer: payer,
      expiration: 200,
      reason: "invalid_exact_stellar_signature_expiration_too_far"
    },
    {
      name: "facilitator authorization exclusion",
      signer: facilitator,
      expiration: 102,
      reason: "invalid_exact_stellar_payload_facilitator_in_auth"
    }
  ])("rejects $name", async ({ signer, expiration, reason }) => {
    const authorization = await signedAuthorization(signer, expiration);
    const transaction = parsedTransfer({
      payer,
      recipient: recipient.publicKey(),
      auth: [authorization]
    });

    expect(validateOfficialAuth(scheme, transaction, payer.publicKey(), 100)).toMatchObject({
      isValid: false,
      invalidReason: reason
    });
  });
});

function requirement(payTo: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: testAssetContractId,
    amount: "500000",
    payTo,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true }
  };
}

function payload(accepted: PaymentRequirements, transaction: string): PaymentPayload {
  return {
    x402Version: 2,
    accepted,
    payload: { transaction }
  };
}

function transferXdr({
  payer,
  recipient,
  asset = testAssetContractId,
  amount = 500000n,
  from = payer.publicKey(),
  auth
}: {
  payer: Keypair;
  recipient: string;
  asset?: string;
  amount?: bigint;
  from?: string;
  auth?: xdr.SorobanAuthorizationEntry[];
}) {
  return new TransactionBuilder(new Account(payer.publicKey(), "0"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: asset,
        function: "transfer",
        args: [
          nativeToScVal(from, { type: "address" }),
          nativeToScVal(recipient, { type: "address" }),
          nativeToScVal(amount, { type: "i128" })
        ],
        ...(auth === undefined ? {} : { auth })
      })
    )
    .setTimeout(60)
    .build()
    .toXDR();
}

async function signedAuthorization(signer: Keypair, validUntilLedgerSeq: number) {
  const transaction = parsedTransfer({
    payer: signer,
    recipient: Keypair.random().publicKey()
  });
  const operation = transaction.operations[0];
  if (operation?.type !== "invokeHostFunction") {
    throw new Error("Fixture must contain an invokeHostFunction operation.");
  }
  const officialFunction = operation.func as unknown as {
    invokeContract: () => xdr.InvokeContractArgs;
  };

  const authorization = await officialStellarSdk.authorizeInvocation({
    signer: officialStellarSdk.Keypair.fromSecret(signer.secret()),
    validUntilLedgerSeq,
    networkPassphrase: Networks.TESTNET,
    invocation: new officialStellarSdk.xdr.SorobanAuthorizedInvocation({
      function:
        officialStellarSdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          officialFunction.invokeContract()
        ),
      subInvocations: []
    })
  } as never);
  const legacyAuthorization = authorization as unknown as {
    toXDR: (format: "base64") => string;
  };

  return xdr.SorobanAuthorizationEntry.fromXDR(legacyAuthorization.toXDR("base64"), "base64");
}

function parsedTransfer(input: Parameters<typeof transferXdr>[0]) {
  return new officialStellarSdk.Transaction(transferXdr(input), Networks.TESTNET);
}

function validateOfficialAuth(
  scheme: ExactStellarScheme,
  transaction: Transaction,
  payer: string,
  maxLedger: number
): VerifyResponse | undefined {
  const operation = transaction.operations[0];
  if (operation?.type !== "invokeHostFunction") {
    throw new Error("Fixture must contain an invokeHostFunction operation.");
  }
  const internal = scheme as unknown as {
    validateAuthEntries: (...args: unknown[]) => VerifyResponse | undefined;
  };

  return internal.validateAuthEntries(
    operation,
    new Set(scheme.getSigners("stellar:testnet")),
    payer,
    maxLedger,
    transaction,
    undefined
  );
}
