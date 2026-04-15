#!/usr/bin/env tsx
/**
 * End-to-end smoke test against a running anvil + relayer.
 *
 * Sequence:
 *   1. Admin attests Maya (PoH+business)
 *   2. Admin applies a scorer-signed credit score
 *   3. Maya borrows HKDm
 *   4. POST signed webhook to relayer  →  relayer routes onSaleReceived
 *   5. Assert Maya's outstanding debt went down
 *
 * Prereqs (set by caller):
 *   RPC_URL            http://localhost:8545
 *   ADMIN_PK           deployer pk (has attestor+scorer keys in env too)
 *   ATTESTOR_PK        backend attestor
 *   SCORER_PK          backend scorer
 *   MAYA_PK            borrower
 *   HKDM, POH, CREDIT  deployed addresses
 *   WEBHOOK_SECRET     relayer shared secret
 *   RELAYER_URL        e.g. http://localhost:8787
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  toBytes,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createHmac, randomBytes } from "node:crypto";

const required = [
  "RPC_URL",
  "ADMIN_PK",
  "ATTESTOR_PK",
  "SCORER_PK",
  "MAYA_PK",
  "HKDM",
  "POH",
  "CREDIT",
  "WEBHOOK_SECRET",
  "RELAYER_URL",
] as const;
for (const k of required) {
  if (!process.env[k]) throw new Error(`missing env: ${k}`);
}
const env = Object.fromEntries(required.map((k) => [k, process.env[k]!])) as Record<
  (typeof required)[number],
  string
>;

// Chain id from env (fallback to anvil) — the EIP-712 domain separator
// includes this; a mismatch recovers to a random address and trips
// `AttestorNotAuthorized`.
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "31337");

const chain = {
  id: CHAIN_ID,
  name: `chain-${CHAIN_ID}`,
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL] } },
} as const;

const admin = privateKeyToAccount(env.ADMIN_PK as Hex);
const attestor = privateKeyToAccount(env.ATTESTOR_PK as Hex);
const scorer = privateKeyToAccount(env.SCORER_PK as Hex);
const maya = privateKeyToAccount(env.MAYA_PK as Hex);

const pc = createPublicClient({ chain, transport: http(env.RPC_URL) });
const adminWc = createWalletClient({ account: admin, chain, transport: http(env.RPC_URL) });
const mayaWc = createWalletClient({ account: maya, chain, transport: http(env.RPC_URL) });

const pohAbi = parseAbi([
  "function recordAttestation(address subject, uint8 kind, uint64 issuedAt, uint64 expiresAt, bytes32 nonce, bytes signature)",
  "function isFullyVerified(address) view returns (bool)",
]);
const creditAbi = parseAbi([
  "function applyScore(address borrower, uint8 tier, uint256 maxLine, uint16 aprBps, uint64 issuedAt, uint64 expiresAt, bytes32 nonce, bytes signature)",
  "function borrow(uint256 amount, uint32 duration)",
  "function outstandingDebt(address) view returns (uint256)",
]);

const pohDomain = {
  name: "ZephyrPay PoHRegistry",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: env.POH as Address,
} as const;
const creditDomain = {
  name: "ZephyrPay CreditLine",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: env.CREDIT as Address,
} as const;

const attestationTypes = {
  Attestation: [
    { name: "subject", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
const scoreTypes = {
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

async function main() {
  // Back-date by 2 minutes to absorb wall-clock vs block-timestamp skew on
  // slow/low-activity testnets (HashKey testnet block time is ~2s).
  const now = BigInt(Math.floor(Date.now() / 1000)) - 120n;
  const poh = env.POH as Address;
  const credit = env.CREDIT as Address;

  // ---- 1. attestor signs → admin submits attestation ----
  {
    const attNonce = ("0x" + randomBytes(32).toString("hex")) as Hex;
    const attSig = await attestor.signTypedData({
      domain: pohDomain,
      types: attestationTypes,
      primaryType: "Attestation",
      message: {
        subject: maya.address,
        kind: 3,
        issuedAt: now,
        expiresAt: now + 180n * 86_400n,
        nonce: attNonce,
      },
    });
    const hash = await adminWc.writeContract({
      address: poh,
      abi: pohAbi,
      functionName: "recordAttestation",
      args: [maya.address, 3, now, now + 180n * 86_400n, attNonce, attSig],
    });
    const r = await pc.waitForTransactionReceipt({ hash });
    console.log(`[1/4] attestation tx ${hash} status=${r.status}`);
    const verified = await pc.readContract({
      address: poh,
      abi: pohAbi,
      functionName: "isFullyVerified",
      args: [maya.address],
    });
    if (!verified) throw new Error("attestation did not take effect");
  }

  // ---- 2. scorer signs → admin submits score ----
  {
    const scoreNonce = ("0x" + randomBytes(32).toString("hex")) as Hex;
    const scoreSig = await scorer.signTypedData({
      domain: creditDomain,
      types: scoreTypes,
      primaryType: "Score",
      message: {
        borrower: maya.address,
        tier: 2,
        maxLine: 5_000n * 10n ** 6n,
        aprBps: 850,
        issuedAt: now,
        expiresAt: now + 900n,
        nonce: scoreNonce,
      },
    });
    const hash = await adminWc.writeContract({
      address: credit,
      abi: creditAbi,
      functionName: "applyScore",
      args: [
        maya.address,
        2,
        5_000n * 10n ** 6n,
        850,
        now,
        now + 900n,
        scoreNonce,
        scoreSig,
      ],
    });
    const r = await pc.waitForTransactionReceipt({ hash });
    console.log(`[2/4] score tx       ${hash} status=${r.status}`);
  }

  // ---- 3. maya borrows 1000 HKDm for 30 days ----
  {
    const hash = await mayaWc.writeContract({
      address: credit,
      abi: creditAbi,
      functionName: "borrow",
      args: [1_000n * 10n ** 6n, 30 * 86_400],
    });
    const r = await pc.waitForTransactionReceipt({ hash });
    console.log(`[3/4] borrow tx      ${hash} status=${r.status}`);
    const debt = await pc.readContract({
      address: credit,
      abi: creditAbi,
      functionName: "outstandingDebt",
      args: [maya.address],
    });
    console.log(`       maya debt after borrow: ${debt} (${Number(debt) / 1e6} HKD)`);
  }

  // maya must approve CreditLine so the relayer's onSaleReceived can
  // transferFrom interest + burnFrom principal
  {
    const hkdmAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
    const hash = await mayaWc.writeContract({
      address: env.HKDM as Address,
      abi: hkdmAbi,
      functionName: "approve",
      args: [credit, 2n ** 256n - 1n],
    });
    await pc.waitForTransactionReceipt({ hash });
    console.log(`       approve tx ${hash}`);
  }

  // ---- 4. send signed webhook to relayer → wait → check debt went down ----
  {
    const payload = {
      source: "shopify",
      sourceId: `shopify-order-${Date.now()}`,
      borrower: maya.address,
      amountCents: 50_000, // HK$500
      occurredAt: Math.floor(Date.now() / 1000),
    };
    const raw = JSON.stringify(payload);
    const sig = createHmac("sha256", env.WEBHOOK_SECRET).update(raw).digest("hex");

    const resp = await fetch(`${env.RELAYER_URL}/webhooks/sale`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-zephyrpay-signature": `sha256=${sig}`,
      },
      body: raw,
    });
    console.log(`[4/4] webhook ${resp.status} ${await resp.text()}`);
    if (!resp.ok && resp.status !== 202) throw new Error(`webhook rejected: ${resp.status}`);

    // Poll for settlement on-chain
    const debtBefore = await pc.readContract({
      address: credit,
      abi: creditAbi,
      functionName: "outstandingDebt",
      args: [maya.address],
    });

    let debtAfter = debtBefore;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      debtAfter = await pc.readContract({
        address: credit,
        abi: creditAbi,
        functionName: "outstandingDebt",
        args: [maya.address],
      });
      if (debtAfter < debtBefore) break;
    }

    console.log(`       debt before webhook: ${debtBefore} (${Number(debtBefore) / 1e6} HKD)`);
    console.log(`       debt after  webhook: ${debtAfter}  (${Number(debtAfter) / 1e6} HKD)`);

    if (debtAfter >= debtBefore) {
      throw new Error("relayer did not settle the sale on-chain within 10 seconds");
    }
    console.log(`✅ full e2e flow working: webhook → relayer → onSaleReceived → debt reduced by ${debtBefore - debtAfter}`);
  }

  // silence unused-import warning
  void stringToHex;
  void toBytes;
  void keccak256;
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
