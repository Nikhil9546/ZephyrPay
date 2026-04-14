import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.js";
import { creditLineAbi } from "./abi.js";

export const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex);

export const publicClient: PublicClient = createPublicClient({
  transport: http(env.RPC_URL),
  chain: {
    id: env.CHAIN_ID,
    name: "custom",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env.RPC_URL] } },
  },
});

export const walletClient: WalletClient = createWalletClient({
  account,
  transport: http(env.RPC_URL),
  chain: {
    id: env.CHAIN_ID,
    name: "custom",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env.RPC_URL] } },
  },
});

/**
 * Verify the configured relayer address holds SETTLEMENT_ROLE before starting.
 * Fails loudly — no point processing a queue if every tx will revert.
 */
export async function assertSettlementRole(): Promise<void> {
  const role = await publicClient.readContract({
    address: env.CREDIT_LINE_ADDRESS as Address,
    abi: creditLineAbi,
    functionName: "SETTLEMENT_ROLE",
  });
  const hasRole = await publicClient.readContract({
    address: env.CREDIT_LINE_ADDRESS as Address,
    abi: creditLineAbi,
    functionName: "hasRole",
    args: [role, account.address],
  });
  if (!hasRole) {
    throw new Error(
      `relayer ${account.address} does not hold SETTLEMENT_ROLE on ${env.CREDIT_LINE_ADDRESS}. ` +
        "Grant it via CreditLine.grantRole(SETTLEMENT_ROLE, relayerAddress) before starting.",
    );
  }
}

export async function readOutstandingDebt(borrower: Address): Promise<bigint> {
  return publicClient.readContract({
    address: env.CREDIT_LINE_ADDRESS as Address,
    abi: creditLineAbi,
    functionName: "outstandingDebt",
    args: [borrower],
  });
}

export async function sendOnSaleReceived(
  borrower: Address,
  amount: bigint,
): Promise<Hex> {
  const { request } = await publicClient.simulateContract({
    address: env.CREDIT_LINE_ADDRESS as Address,
    abi: creditLineAbi,
    functionName: "onSaleReceived",
    args: [borrower, amount],
    account,
  });
  return walletClient.writeContract(request);
}
