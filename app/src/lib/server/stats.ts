import "server-only";
import { createPublicClient, http, type Address } from "viem";
import { hashkeyTestnet, hashkeyMainnet } from "@/lib/chain";
import { creditLineAbi, pohAbi, hkdmAbi } from "@/lib/abi";
import { addresses } from "@/lib/addresses";
import { clientEnv } from "@/lib/env";

/**
 * Live protocol statistics read directly from deployed contracts.
 *
 * Called by the landing page. We use Next.js's built-in fetch-level caching
 * (via the route's `revalidate`) rather than poll from the client — a
 * 60-second SSR cache is more than enough for a marketing page and keeps RPC
 * usage within free-tier limits.
 */

const chain =
  clientEnv.NEXT_PUBLIC_CHAIN_ID === hashkeyMainnet.id ? hashkeyMainnet : hashkeyTestnet;

const publicClient = createPublicClient({
  chain,
  transport: http(chain.rpcUrls.default.http[0]),
});

export interface ProtocolStats {
  chainId: number;
  chainName: string;
  explorerBase: string;
  contracts: {
    hkdm: Address;
    poh: Address;
    creditLine: Address;
  };
  totals: {
    hkdmSupply: bigint;          // cumulative HKDm ever minted (approx — totalSupply)
    uniqueBorrowers: number;
    uniqueVerified: number;
    totalBorrows: number;
    totalRepays: number;
    cumulativeOriginated: bigint; // sum of Borrowed(principal)
    cumulativeRepaidPrincipal: bigint;
    cumulativeInterestPaid: bigint;
  };
  fetchedAt: number;
}

const LOOKBACK_BLOCKS = 200_000n; // ~4 days on a 2s-block L2; plenty for a demo

export async function fetchProtocolStats(): Promise<ProtocolStats | null> {
  // If contract addresses are still placeholder zeros, don't query the chain.
  if (addresses.hkdm.toLowerCase() === "0x0000000000000000000000000000000000000001") {
    return null;
  }

  try {
    const currentBlock = await publicClient.getBlockNumber();
    const fromBlock = currentBlock > LOOKBACK_BLOCKS ? currentBlock - LOOKBACK_BLOCKS : 0n;

    const [borrowedLogs, repaidLogs, attestationLogs, hkdmSupply] = await Promise.all([
      publicClient.getContractEvents({
        address: addresses.creditLine,
        abi: creditLineAbi,
        eventName: "Borrowed",
        fromBlock,
        toBlock: currentBlock,
      }),
      publicClient.getContractEvents({
        address: addresses.creditLine,
        abi: creditLineAbi,
        eventName: "Repaid",
        fromBlock,
        toBlock: currentBlock,
      }),
      publicClient.getContractEvents({
        address: addresses.poh,
        abi: pohAbi,
        eventName: "AttestationRecorded",
        fromBlock,
        toBlock: currentBlock,
      }),
      publicClient
        .readContract({
          address: addresses.hkdm,
          abi: [
            ...hkdmAbi,
            {
              type: "function",
              name: "totalSupply",
              stateMutability: "view",
              inputs: [],
              outputs: [{ name: "", type: "uint256" }],
            },
          ] as const,
          functionName: "totalSupply",
        })
        .catch(() => 0n),
    ]);

    const borrowers = new Set<string>();
    let cumulativeOriginated = 0n;
    for (const log of borrowedLogs) {
      if (log.args.borrower) borrowers.add(log.args.borrower.toLowerCase());
      cumulativeOriginated += log.args.principal ?? 0n;
    }

    let cumulativeRepaidPrincipal = 0n;
    let cumulativeInterestPaid = 0n;
    for (const log of repaidLogs) {
      cumulativeRepaidPrincipal += log.args.principalRepaid ?? 0n;
      cumulativeInterestPaid += log.args.interestPaid ?? 0n;
    }

    const verified = new Set<string>();
    for (const log of attestationLogs) {
      if (log.args.subject) verified.add(log.args.subject.toLowerCase());
    }

    return {
      chainId: chain.id,
      chainName: chain.name,
      explorerBase: chain.blockExplorers.default.url,
      contracts: { ...addresses },
      totals: {
        hkdmSupply: hkdmSupply as bigint,
        uniqueBorrowers: borrowers.size,
        uniqueVerified: verified.size,
        totalBorrows: borrowedLogs.length,
        totalRepays: repaidLogs.length,
        cumulativeOriginated,
        cumulativeRepaidPrincipal,
        cumulativeInterestPaid,
      },
      fetchedAt: Math.floor(Date.now() / 1000),
    };
  } catch (err) {
    // Swallow: RPC hiccup shouldn't 500 the marketing page.
    console.warn("[stats] on-chain read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
