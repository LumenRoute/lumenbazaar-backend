import { createHash } from "node:crypto";

import {
  Account,
  Address,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  Soroban,
  Transaction,
  TransactionBuilder,
  type xdr
} from "@stellar/stellar-sdk";

import { LumenError, type AppConfig, type NetworkId } from "@lumenbazaar/shared";

import { assertStellarPublicKey } from "./addresses.js";
import { type FacilitatorSignerProvider } from "./facilitatorSigner.js";

export type UptoContractCreateSessionInput = {
  assetContractId: string;
  buyer: string;
  contractId: string;
  expiresAtLedger: number;
  maxAmountStroops: bigint;
  network: NetworkId;
  resourceHash: string;
  seller: string;
};

export type UptoContractCreateSessionResult = {
  contractSessionId: string;
  ledger: number | null;
  transactionHash: string | null;
};

export type UptoContractSettleSessionInput = {
  actualAmountStroops: bigint;
  contractId: string;
  contractSessionId: string;
  network: NetworkId;
  usageHash: string;
  buyer?: string;
  seller?: string;
};

export type UptoContractSettleSessionResult = {
  ledger: number;
  transactionHash: string;
};

export type UptoSessionContractBindings = {
  createSession: (
    input: UptoContractCreateSessionInput
  ) => Promise<UptoContractCreateSessionResult>;
  settleSession: (
    input: UptoContractSettleSessionInput
  ) => Promise<UptoContractSettleSessionResult>;
  getSessionState?: (
    contractId: string,
    contractSessionId: string
  ) => Promise<
    | {
        status: "open" | "settled" | "expired";
        ledger?: number;
        transactionHash?: string;
      }
    | undefined
  >;
};

export type GeneratedUptoSessionClient = {
  create_session: (
    buyer: string,
    seller: string,
    asset: string,
    maxAmount: bigint,
    expiresAtLedger: number,
    resourceHash: string
  ) =>
    | Promise<
        | string
        | {
            contractSessionId?: string;
            sessionId?: string;
            ledger?: number;
            transactionHash?: string;
          }
      >
    | string
    | { contractSessionId?: string; sessionId?: string; ledger?: number; transactionHash?: string };
  settle: (
    sessionId: string,
    actualAmount: bigint,
    usageHash: string
  ) =>
    | Promise<{ ledger?: number; transactionHash?: string } | void>
    | { ledger?: number; transactionHash?: string }
    | void;
};

export type GeneratedUptoSessionClientFactory = (
  network: NetworkId,
  contractId: string
) => GeneratedUptoSessionClient;

export type SorobanRpcClientLike = {
  getAccount?: (
    address: string
  ) => Promise<Account | { sequenceNumber(): string; accountId(): string }>;
  simulateTransaction?: (tx: Transaction) => Promise<unknown>;
  prepareTransaction?: (tx: Transaction) => Promise<Transaction>;
  sendTransaction?: (tx: Transaction) => Promise<unknown>;
  getTransaction?: (hash: string) => Promise<unknown>;
};

export type UptoFinalityResult =
  | { status: "confirmed"; ledger: number }
  | { status: "failed" }
  | { status: "pending" };

export type StellarSdkUptoBindingsOptions = {
  config: AppConfig;
  signerProvider: FacilitatorSignerProvider;
  rpcClient?: SorobanRpcClientLike;
  resolveFinality?: (input: {
    network: NetworkId;
    rpcUrl: string;
    transactionHash: string;
  }) => Promise<UptoFinalityResult>;
};

export function mapSorobanError(error: unknown): LumenError {
  if (error instanceof LumenError) {
    return error;
  }
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : JSON.stringify(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("invalid signature") ||
    lower.includes("bad_auth") ||
    lower.includes("auth") ||
    lower.includes("signature") ||
    lower.includes("unauthorized") ||
    lower.includes("signer")
  ) {
    return new LumenError(
      "INVALID_SIGNATURE",
      "Payment session authorization signature is invalid."
    );
  }
  if (
    lower.includes("expired") ||
    lower.includes("expiration") ||
    lower.includes("timebound") ||
    lower.includes("bad_seq")
  ) {
    return new LumenError("AUTH_EXPIRED", "Payment session authorization has expired.");
  }
  if (
    lower.includes("amount") ||
    lower.includes("cap") ||
    lower.includes("balance") ||
    lower.includes("underfunded") ||
    lower.includes("insufficient")
  ) {
    return new LumenError(
      "AMOUNT_MISMATCH",
      "Settlement amount exceeds session limit or account balance."
    );
  }
  if (lower.includes("asset") || lower.includes("trustline") || lower.includes("token")) {
    return new LumenError("ASSET_MISMATCH", "Payment session asset is unsupported or mismatched.");
  }
  if (
    lower.includes("duplicate") ||
    lower.includes("already exists") ||
    lower.includes("replay") ||
    lower.includes("already settled")
  ) {
    return new LumenError("REPLAY_DETECTED", "Payment session invocation was already processed.");
  }

  return new LumenError("SETTLEMENT_FAILED", `Soroban contract invocation failed: ${message}`);
}

export function createStellarSdkUptoSessionBindings(
  options: StellarSdkUptoBindingsOptions
): UptoSessionContractBindings {
  return {
    async createSession(input) {
      assertStellarPublicKey(input.buyer, "buyer");
      assertStellarPublicKey(input.seller, "seller");

      const networkConfig = options.config.networks[input.network];
      if (networkConfig === undefined) {
        throw new LumenError("UNSUPPORTED_NETWORK", `Network ${input.network} is not supported.`);
      }

      const signer = await options.signerProvider.getSigner();
      const server =
        options.rpcClient ??
        new rpc.Server(networkConfig.rpcUrl, {
          allowHttp: networkConfig.rpcUrl.startsWith("http://")
        });

      let tx: Transaction;
      try {
        const operation = Operation.invokeContractFunction({
          contract: input.contractId,
          function: "create_session",
          args: [
            new Address(input.buyer).toScVal(),
            new Address(input.seller).toScVal(),
            new Address(input.assetContractId).toScVal(),
            nativeToScVal(input.maxAmountStroops, { type: "i128" }),
            nativeToScVal(input.expiresAtLedger, { type: "u32" }),
            nativeToScVal(Buffer.from(input.resourceHash, "hex"), { type: "bytes" })
          ]
        });

        let sourceAccount: Account;
        try {
          const rpcWithAccount = server as { getAccount?: (addr: string) => Promise<Account> };
          if (typeof rpcWithAccount.getAccount === "function") {
            sourceAccount = await rpcWithAccount.getAccount(signer.address);
          } else {
            sourceAccount = new Account(signer.address, "100");
          }
        } catch {
          sourceAccount = new Account(signer.address, "100");
        }

        tx = new TransactionBuilder(sourceAccount, {
          fee: (options.config.settlement?.inclusionFeeStroops ?? 100).toString(),
          networkPassphrase: networkConfig.passphrase
        })
          .addOperation(operation)
          .setTimeout(30)
          .build();
      } catch (err) {
        throw mapSorobanError(err);
      }

      let preparedTx: Transaction;
      let contractSessionId: string | undefined;

      try {
        let simResponse: unknown;
        const rpcWithSim = server as {
          simulateTransaction?: (t: Transaction) => Promise<unknown>;
        };
        if (typeof rpcWithSim.simulateTransaction === "function") {
          simResponse = await rpcWithSim.simulateTransaction(tx);
        } else {
          simResponse = { result: {} };
        }

        if (rpc.Api.isSimulationError(simResponse as rpc.Api.SimulateTransactionResponse)) {
          throw mapSorobanError((simResponse as rpc.Api.SimulateTransactionErrorResponse).error);
        }

        const simWithResult = simResponse as {
          result?: { retval?: xdr.ScVal | string | bigint | number | Uint8Array };
        };
        if (simWithResult.result?.retval) {
          try {
            if (typeof simWithResult.result.retval === "string") {
              contractSessionId = simWithResult.result.retval;
            } else {
              const nativeVal = scValToNative(simWithResult.result.retval as xdr.ScVal);
              if (typeof nativeVal === "string" && nativeVal.length > 0) {
                contractSessionId = nativeVal;
              } else if (typeof nativeVal === "bigint" || typeof nativeVal === "number") {
                contractSessionId = nativeVal.toString();
              } else if (Buffer.isBuffer(nativeVal) || nativeVal instanceof Uint8Array) {
                contractSessionId = Buffer.from(nativeVal).toString("hex");
              }
            }
          } catch {
            // Fallback to digest below
          }
        }

        const sorobanSdk = Soroban as unknown as {
          assembleTransaction?: (t: Transaction, sim: unknown) => { build: () => Transaction };
        };
        if (options.rpcClient?.prepareTransaction) {
          preparedTx = await options.rpcClient.prepareTransaction(tx);
        } else if (typeof sorobanSdk.assembleTransaction === "function") {
          preparedTx = sorobanSdk.assembleTransaction(tx, simResponse).build();
        } else {
          preparedTx = tx;
        }
      } catch (err) {
        throw mapSorobanError(err);
      }

      let signedTx: Transaction;
      try {
        const signResult = await signer.signTransaction(preparedTx.toXDR(), {
          networkPassphrase: networkConfig.passphrase
        });
        signedTx = new Transaction(signResult.signedTxXdr, networkConfig.passphrase);
      } catch (err) {
        throw mapSorobanError(err);
      }

      let sendResponse:
        | { status?: string; hash?: string; errorResultXdr?: string; error?: string }
        | undefined;
      try {
        const rpcWithSend = server as {
          sendTransaction?: (t: Transaction) => Promise<unknown>;
        };
        if (typeof rpcWithSend.sendTransaction === "function") {
          sendResponse = (await rpcWithSend.sendTransaction(signedTx)) as typeof sendResponse;
        } else {
          sendResponse = { status: "PENDING", hash: Buffer.from(signedTx.hash()).toString("hex") };
        }
      } catch (err) {
        throw mapSorobanError(err);
      }

      if (sendResponse?.status === "DUPLICATE") {
        throw new LumenError("REPLAY_DETECTED", "Transaction was already submitted.");
      }
      if (sendResponse?.status === "ERROR") {
        throw mapSorobanError(
          sendResponse.errorResultXdr || sendResponse.error || "Submission failed"
        );
      }

      const txHash: string = sendResponse?.hash ?? Buffer.from(signedTx.hash()).toString("hex");

      const finalityResolver = options.resolveFinality ?? resolveRpcFinality;
      const finality = await finalityResolver({
        network: input.network,
        rpcUrl: networkConfig.rpcUrl,
        transactionHash: txHash
      });

      if (finality.status === "failed") {
        throw new LumenError(
          "SETTLEMENT_FAILED",
          "Soroban session creation transaction failed on ledger."
        );
      }
      if (finality.status === "pending") {
        throw new LumenError(
          "SETTLEMENT_FAILED",
          "Soroban session creation transaction timed out waiting for finality.",
          { details: { status: "timed_out", transactionHash: txHash } }
        );
      }

      const finalSessionId =
        contractSessionId ??
        digest([
          input.network,
          input.contractId,
          input.buyer,
          input.seller,
          input.assetContractId,
          input.maxAmountStroops.toString(),
          input.expiresAtLedger.toString(),
          input.resourceHash
        ]);

      return {
        contractSessionId: finalSessionId,
        ledger: finality.ledger,
        transactionHash: txHash
      };
    },

    async settleSession(input) {
      if (input.seller) {
        assertStellarPublicKey(input.seller, "seller");
      } else {
        throw new LumenError("UNAUTHORIZED", "Settlement requires seller authorization.");
      }

      const networkConfig = options.config.networks[input.network];
      if (networkConfig === undefined) {
        throw new LumenError("UNSUPPORTED_NETWORK", `Network ${input.network} is not supported.`);
      }

      const signer = await options.signerProvider.getSigner();
      const server =
        options.rpcClient ??
        new rpc.Server(networkConfig.rpcUrl, {
          allowHttp: networkConfig.rpcUrl.startsWith("http://")
        });

      let tx: Transaction;
      try {
        const operation = Operation.invokeContractFunction({
          contract: input.contractId,
          function: "settle",
          args: [
            nativeToScVal(input.contractSessionId, { type: "string" }),
            nativeToScVal(input.actualAmountStroops, { type: "i128" }),
            nativeToScVal(Buffer.from(input.usageHash, "hex"), { type: "bytes" })
          ]
        });

        let sourceAccount: Account;
        try {
          const rpcWithAccount = server as { getAccount?: (addr: string) => Promise<Account> };
          if (typeof rpcWithAccount.getAccount === "function") {
            sourceAccount = await rpcWithAccount.getAccount(signer.address);
          } else {
            sourceAccount = new Account(signer.address, "100");
          }
        } catch {
          sourceAccount = new Account(signer.address, "100");
        }

        tx = new TransactionBuilder(sourceAccount, {
          fee: (options.config.settlement?.inclusionFeeStroops ?? 100).toString(),
          networkPassphrase: networkConfig.passphrase
        })
          .addOperation(operation)
          .setTimeout(30)
          .build();
      } catch (err) {
        throw mapSorobanError(err);
      }

      let preparedTx: Transaction;

      try {
        let simResponse: unknown;
        const rpcWithSim = server as {
          simulateTransaction?: (t: Transaction) => Promise<unknown>;
        };
        if (typeof rpcWithSim.simulateTransaction === "function") {
          simResponse = await rpcWithSim.simulateTransaction(tx);
        } else {
          simResponse = { result: {} };
        }

        if (rpc.Api.isSimulationError(simResponse as rpc.Api.SimulateTransactionResponse)) {
          throw mapSorobanError((simResponse as rpc.Api.SimulateTransactionErrorResponse).error);
        }

        const sorobanSdk = Soroban as unknown as {
          assembleTransaction?: (t: Transaction, sim: unknown) => { build: () => Transaction };
        };
        if (options.rpcClient?.prepareTransaction) {
          preparedTx = await options.rpcClient.prepareTransaction(tx);
        } else if (typeof sorobanSdk.assembleTransaction === "function") {
          preparedTx = sorobanSdk.assembleTransaction(tx, simResponse).build();
        } else {
          preparedTx = tx;
        }
      } catch (err) {
        throw mapSorobanError(err);
      }

      let signedTx: Transaction;
      try {
        const signResult = await signer.signTransaction(preparedTx.toXDR(), {
          networkPassphrase: networkConfig.passphrase
        });
        signedTx = new Transaction(signResult.signedTxXdr, networkConfig.passphrase);
      } catch (err) {
        throw mapSorobanError(err);
      }

      let sendResponse:
        | { status?: string; hash?: string; errorResultXdr?: string; error?: string }
        | undefined;
      try {
        const rpcWithSend = server as {
          sendTransaction?: (t: Transaction) => Promise<unknown>;
        };
        if (typeof rpcWithSend.sendTransaction === "function") {
          sendResponse = (await rpcWithSend.sendTransaction(signedTx)) as typeof sendResponse;
        } else {
          sendResponse = { status: "PENDING", hash: Buffer.from(signedTx.hash()).toString("hex") };
        }
      } catch (err) {
        throw mapSorobanError(err);
      }

      if (sendResponse?.status === "DUPLICATE") {
        throw new LumenError("REPLAY_DETECTED", "Transaction was already submitted.");
      }
      if (sendResponse?.status === "ERROR") {
        throw mapSorobanError(
          sendResponse.errorResultXdr || sendResponse.error || "Submission failed"
        );
      }

      const txHash: string = sendResponse?.hash ?? Buffer.from(signedTx.hash()).toString("hex");

      const finalityResolver = options.resolveFinality ?? resolveRpcFinality;
      const finality = await finalityResolver({
        network: input.network,
        rpcUrl: networkConfig.rpcUrl,
        transactionHash: txHash
      });

      if (finality.status === "failed") {
        throw new LumenError(
          "SETTLEMENT_FAILED",
          "Soroban settlement transaction failed on ledger."
        );
      }
      if (finality.status === "pending") {
        throw new LumenError(
          "SETTLEMENT_FAILED",
          "Soroban settlement transaction timed out waiting for finality.",
          { details: { status: "timed_out", transactionHash: txHash } }
        );
      }

      return {
        ledger: finality.ledger,
        transactionHash: txHash
      };
    }
  };
}

export function createGeneratedUptoSessionBindings(
  clientFactory: GeneratedUptoSessionClientFactory
): UptoSessionContractBindings {
  return {
    async createSession(input) {
      assertStellarPublicKey(input.buyer, "buyer");
      assertStellarPublicKey(input.seller, "seller");

      const client = clientFactory(input.network, input.contractId);
      const result = await client.create_session(
        input.buyer,
        input.seller,
        input.assetContractId,
        input.maxAmountStroops,
        input.expiresAtLedger,
        input.resourceHash
      );

      const contractSessionId =
        typeof result === "string" ? result : (result?.contractSessionId ?? result?.sessionId);

      if (!contractSessionId) {
        throw new LumenError(
          "SETTLEMENT_FAILED",
          "Generated upto-session client did not return a session ID."
        );
      }

      const ledger =
        typeof result === "object" && result !== null && typeof result.ledger === "number"
          ? result.ledger
          : null;
      const transactionHash =
        typeof result === "object" && result !== null && typeof result.transactionHash === "string"
          ? result.transactionHash
          : null;

      return {
        contractSessionId,
        ledger,
        transactionHash
      };
    },
    async settleSession(input) {
      if (input.seller) {
        assertStellarPublicKey(input.seller, "seller");
      } else {
        throw new LumenError("UNAUTHORIZED", "Settlement requires seller authorization.");
      }

      const client = clientFactory(input.network, input.contractId);
      const result = await client.settle(
        input.contractSessionId,
        input.actualAmountStroops,
        input.usageHash
      );

      if (
        result === undefined ||
        result.ledger === undefined ||
        result.transactionHash === undefined
      ) {
        throw new Error(
          "Generated upto-session client did not return transaction hash and ledger evidence."
        );
      }

      return {
        ledger: result.ledger,
        transactionHash: result.transactionHash
      };
    }
  };
}

export function createLocalUptoSessionContractBindings(): UptoSessionContractBindings {
  const settledSessions = new Map<string, { ledger: number; transactionHash: string }>();

  return {
    async createSession(input) {
      assertStellarPublicKey(input.buyer, "buyer");
      assertStellarPublicKey(input.seller, "seller");

      const contractSessionId = digest([
        input.network,
        input.contractId,
        input.buyer,
        input.seller,
        input.assetContractId,
        input.maxAmountStroops.toString(),
        input.expiresAtLedger.toString(),
        input.resourceHash
      ]);

      return {
        contractSessionId,
        ledger: 1,
        transactionHash: `upto_create_${contractSessionId.slice(0, 50)}`
      };
    },
    async settleSession(input) {
      if (input.seller) {
        assertStellarPublicKey(input.seller, "seller");
      }
      const txHash = contractTransactionHash(input.contractSessionId, input.usageHash);
      settledSessions.set(input.contractSessionId, { ledger: 1, transactionHash: txHash });
      return {
        ledger: 1,
        transactionHash: txHash
      };
    },
    async getSessionState(_contractId, contractSessionId) {
      const settled = settledSessions.get(contractSessionId);
      if (settled) {
        return {
          status: "settled",
          ledger: settled.ledger,
          transactionHash: settled.transactionHash
        };
      }
      return { status: "open" };
    }
  };
}

async function resolveRpcFinality(input: {
  network: NetworkId;
  rpcUrl: string;
  transactionHash: string;
}): Promise<UptoFinalityResult> {
  const maxAttempts = 15;
  const baseDelayMs = 200;
  const maxDelayMs = 2_000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(input.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: { hash: input.transactionHash }
        }),
        signal: AbortSignal.timeout(5_000)
      });

      if (!response.ok) {
        if (attempt < maxAttempts - 1) {
          await delay(Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs));
          continue;
        }
        throw new Error("Stellar RPC finality request failed after max retries.");
      }

      const payload = (await response.json()) as {
        error?: unknown;
        result?: { status?: string; ledger?: number };
      };

      if (payload.error !== undefined || payload.result === undefined) {
        if (attempt < maxAttempts - 1) {
          await delay(Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs));
          continue;
        }
        throw new Error("Stellar RPC finality response was invalid.");
      }

      if (payload.result.status === "SUCCESS" && Number.isInteger(payload.result.ledger)) {
        return { status: "confirmed", ledger: payload.result.ledger as number };
      }

      if (payload.result.status === "FAILED") {
        return { status: "failed" };
      }

      if (attempt < maxAttempts - 1) {
        await delay(Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs));
        continue;
      }

      return { status: "pending" };
    } catch (error) {
      if (attempt < maxAttempts - 1) {
        await delay(Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs));
        continue;
      }
      throw error;
    }
  }

  return { status: "pending" };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contractTransactionHash(contractSessionId: string, usageHash: string) {
  return `upto_${digest([contractSessionId, usageHash]).slice(0, 56)}`;
}

function digest(parts: string[]) {
  const hash = createHash("sha256");

  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }

  return hash.digest("hex");
}
