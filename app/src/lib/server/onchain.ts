import "server-only";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashkeyTestnet, hashkeyMainnet } from "@/lib/chain";
import { addresses } from "@/lib/addresses";
import { clientEnv } from "@/lib/env";
import { creditLineAbi } from "@/lib/abi";

/**
 * Server-side on-chain writer for relayer-role operations.
 *
 * Used by the HP2 webhook handler to route an off-chain (HP2) payment into
 * an on-chain CreditLine.onSaleReceived(borrower, amount) call, auto-repaying
 * the merchant's outstanding debt.
 *
 * The signing key must hold SETTLEMENT_ROLE on the deployed CreditLine. If
 * SETTLEMENT_RELAYER_PRIVATE_KEY is not set we disable this path and the
 * webhook returns 503 without attempting the write.
 */

const chain =
  clientEnv.NEXT_PUBLIC_CHAIN_ID === hashkeyMainnet.id ? hashkeyMainnet : hashkeyTestnet;

function getRelayerKey(): Hex | null {
  const v = process.env.SETTLEMENT_RELAYER_PRIVATE_KEY;
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) return null;
  return v as Hex;
}

export function isSettlementConfigured(): boolean {
  return getRelayerKey() !== null;
}

const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });

let _walletClient: ReturnType<typeof createWalletClient> | null = null;
function getWalletClient() {
  if (_walletClient) return _walletClient;
  const pk = getRelayerKey();
  if (!pk) return null;
  _walletClient = createWalletClient({
    account: privateKeyToAccount(pk),
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });
  return _walletClient;
}

/**
 * Convert USDC-denominated amount (6 decimals, as HP2 emits) into HKDm base
 * units (also 6 decimals). Today this is 1:1 by design — HKDm is a
 * transitional HKD stand-in pegged 1:1 against USD for demo purposes. When
 * HKDAP ships, this is where the HKD/USD FX rate is applied.
 */
export function usdcAmountToHkdmUnits(usdcAmount: string): bigint {
  return BigInt(usdcAmount);
}

export async function settleOnChain(
  borrower: Address,
  amountUnits: bigint,
): Promise<{ txHash: Hash; blockNumber: bigint } | { skipped: "no_outstanding_debt" }> {
  const wallet = getWalletClient();
  if (!wallet) throw new Error("SETTLEMENT_RELAYER_PRIVATE_KEY not set — cannot settle on-chain");

  // Pre-flight: check there's debt to repay. The on-chain contract reverts
  // with NoOutstandingDebt if we call onSaleReceived against a borrower who
  // owes nothing — we'd rather skip cleanly than broadcast a revert.
  const outstanding = await publicClient.readContract({
    address: addresses.creditLine,
    abi: creditLineAbi,
    functionName: "outstandingDebt",
    args: [borrower],
  });
  if (outstanding === 0n) {
    return { skipped: "no_outstanding_debt" };
  }

  const applyAmount = amountUnits > outstanding ? outstanding : amountUnits;

  const { request } = await publicClient.simulateContract({
    address: addresses.creditLine,
    abi: creditLineAbi,
    functionName: "onSaleReceived",
    args: [borrower, applyAmount],
    account: wallet.account!,
  });
  const txHash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`settlement tx reverted: ${txHash}`);
  return { txHash, blockNumber: receipt.blockNumber };
}
