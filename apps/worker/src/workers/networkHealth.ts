import { type Job } from "bullmq";

import { getPrismaClient } from "@lumenbazaar/shared";
import * as StellarSdk from "@stellar/stellar-sdk";

export type NetworkHealthJobData = {
  network: "stellar:testnet" | "stellar:pubnet";
};

/**
 * Network Health Worker
 * Checks the health of Stellar network RPC and Horizon services
 */
export async function handleNetworkHealth(job: Job<NetworkHealthJobData>) {
  const { network } = job.data;

  try {
    const db = getPrismaClient();

    // Determine network config based on network ID
    const horizonUrl =
      network === "stellar:testnet"
        ? "https://horizon-testnet.stellar.org"
        : "https://horizon.stellar.org";
    const rpcUrl =
      network === "stellar:testnet"
        ? "https://soroban-testnet.stellar.org"
        : "https://mainnet.sorobanrpc.com";

    let rpcHealthy = false;
    let horizonHealthy = false;
    let latestLedger: number | null = null;

    // Check Horizon health
    try {
      const horizonClient = new StellarSdk.Horizon.Server(horizonUrl, { allowHttp: false });
      const ledger = await horizonClient.ledgers().order("desc").limit(1).call();

      if (ledger && ledger.records && ledger.records.length > 0 && ledger.records[0]) {
        horizonHealthy = true;
        const firstLedger = ledger.records[0] as unknown as Record<string, unknown>;
        latestLedger = (firstLedger.sequence ?? 0) as number;
        job.log(`Horizon healthy - latest ledger: ${latestLedger}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      job.log(`Horizon check failed: ${errorMsg}`);
      horizonHealthy = false;
    }

    // Check RPC health (basic connectivity check)
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getLatestLedger",
          params: []
        })
      });

      if (response.ok) {
        rpcHealthy = true;
        job.log(`RPC healthy`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      job.log(`RPC check failed: ${errorMsg}`);
      rpcHealthy = false;
    }

    // Determine overall status
    const status = rpcHealthy && horizonHealthy ? "healthy" : "degraded";

    // Update or create NetworkStatus record
    await db.networkStatus.upsert({
      where: { network },
      create: {
        network,
        status,
        latestLedger,
        rpcHealthy,
        horizonHealthy,
        checkedAt: new Date(),
        metadata: {
          checkedAt: new Date().toISOString(),
          rpcUrl,
          horizonUrl
        }
      },
      update: {
        status,
        latestLedger: latestLedger ?? undefined,
        rpcHealthy,
        horizonHealthy,
        checkedAt: new Date(),
        metadata: {
          checkedAt: new Date().toISOString(),
          rpcUrl,
          horizonUrl,
          previousStatus: undefined
        }
      }
    });

    job.log(`Network status recorded: ${network} = ${status}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    job.log(`Network health check failed: ${errorMsg}`);
    throw err;
  }
}
