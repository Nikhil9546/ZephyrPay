import "server-only";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { serverEnv } from "@/lib/env.server";
import { clientEnv } from "@/lib/env";
import { addresses } from "@/lib/addresses";

/**
 * Canonical EIP-712 domain for the PoHRegistry contract.
 * Must mirror `EIP712("ZephyrPay PoHRegistry", "1")` in the Solidity constructor.
 */
export function pohDomain() {
  return {
    name: "ZephyrPay PoHRegistry",
    version: "1",
    chainId: clientEnv.NEXT_PUBLIC_CHAIN_ID,
    verifyingContract: addresses.poh,
  } as const;
}

/**
 * Canonical EIP-712 domain for the CreditLine contract.
 * Must mirror `EIP712("ZephyrPay CreditLine", "1")`.
 */
export function creditLineDomain() {
  return {
    name: "ZephyrPay CreditLine",
    version: "1",
    chainId: clientEnv.NEXT_PUBLIC_CHAIN_ID,
    verifyingContract: addresses.creditLine,
  } as const;
}

export const attestationTypes = {
  Attestation: [
    { name: "subject", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const scoreTypes = {
  Score: [
    { name: "borrower", type: "address" },
    { name: "tier", type: "uint8" },
    { name: "maxLine", type: "uint256" },
    { name: "aprBps", type: "uint16" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** The off-chain attestor key. In production this lives in a KMS; never ship it. */
export const attestor = privateKeyToAccount(serverEnv.ATTESTOR_PRIVATE_KEY as Hex);
export const scorer = privateKeyToAccount(serverEnv.SCORER_PRIVATE_KEY as Hex);

export async function signAttestation(params: {
  subject: Address;
  kind: 1 | 2 | 3;
  issuedAt: bigint;
  expiresAt: bigint;
  nonce: Hex;
}): Promise<Hex> {
  return attestor.signTypedData({
    domain: pohDomain(),
    types: attestationTypes,
    primaryType: "Attestation",
    message: params,
  });
}

export async function signScore(params: {
  borrower: Address;
  tier: 1 | 2 | 3 | 4 | 5;
  maxLine: bigint;
  aprBps: number;
  issuedAt: bigint;
  expiresAt: bigint;
  nonce: Hex;
}): Promise<Hex> {
  return scorer.signTypedData({
    domain: creditLineDomain(),
    types: scoreTypes,
    primaryType: "Score",
    message: params,
  });
}
