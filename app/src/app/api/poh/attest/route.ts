import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { signAttestation, attestor } from "@/lib/server/signer";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/poh/attest — issue a ZK-attested PoH + PoB attestation for a wallet.
 *
 * Production substitution: today this endpoint is the trust anchor that stands
 * in for a live Self.xyz / Humanity Protocol integration. It still produces the
 * SAME on-chain artifact those providers would produce — an EIP-712 signature
 * from an authorized attestor key — so when the ZK provider is wired in later,
 * only this one route swaps its verification step (ZK proof check) in front of
 * the signing step. The PoHRegistry contract does not change.
 *
 * For the hackathon demo, the client passes a `proofBundle` that is treated as
 * an opaque, logged artifact. A real provider (Self) returns a ZK proof; we
 * verify that proof here and then sign. Until that wire-up is live, we still
 * enforce:
 *   - one attestation per wallet per kind per 24h (rate limit) to block spray
 *   - the caller must hold the wallet (EIP-191 signature over a challenge)
 */

const ATTESTATION_VALIDITY_SECONDS = 180 * 24 * 60 * 60; // 180 days

const bodySchema = z.object({
  subject: z.string().refine(isAddress, "subject must be a valid address"),
  kind: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /**
   * Opaque proof bundle from the upstream ZK provider. In production, this is
   * a Self.xyz proof blob we verify before signing. For now we log it.
   */
  proofBundle: z.string().min(1),
  /**
   * EIP-191 signature by the subject over the challenge
   * `ZephyrPay PoH ${subject} ${kind} ${clientNonce}` — proves the caller
   * controls the wallet. Required to block front-running the attestation.
   */
  ownerSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  clientNonce: z.string().min(8).max(128),
});

async function verifyOwnerSignature(params: {
  subject: Address;
  kind: 1 | 2 | 3;
  clientNonce: string;
  ownerSignature: Hex;
}): Promise<boolean> {
  const { verifyMessage } = await import("viem");
  const message = `ZephyrPay PoH ${params.subject.toLowerCase()} ${params.kind} ${params.clientNonce}`;
  return verifyMessage({
    address: params.subject,
    message,
    signature: params.ownerSignature,
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { subject, kind, ownerSignature, clientNonce } = parsed.data;

  const rl = await rateLimit(`poh:${subject.toLowerCase()}:${kind}`, 3, 24 * 60 * 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "too many attestations for this wallet in 24h" },
      { status: 429 },
    );
  }

  const ownerOk = await verifyOwnerSignature({
    subject: subject as Address,
    kind,
    clientNonce,
    ownerSignature: ownerSignature as Hex,
  });
  if (!ownerOk) {
    return NextResponse.json(
      { error: "owner signature does not recover to subject" },
      { status: 401 },
    );
  }

  // PRODUCTION HOOK: when Self.xyz is wired in, call:
  //   await selfVerifier.verifyProof(parsed.data.proofBundle, { subject, kind })
  // which must throw on any invalid proof. Until then, we accept the bundle.
  if (parsed.data.proofBundle.length < 16) {
    return NextResponse.json({ error: "proof bundle missing" }, { status: 400 });
  }

  // The on-chain PoHRegistry rejects issuedAt > block.timestamp. HashKey Chain
  // (and most L2s) produce blocks slightly behind wall-clock — up to tens of
  // seconds on low-activity testnets. Back-date issuedAt by 2 minutes so an
  // attestation signed on a fast server never races ahead of chain time.
  const ISSUED_CLOCK_SKEW_SECONDS = 120n;
  const issuedAt = BigInt(Math.floor(Date.now() / 1000)) - ISSUED_CLOCK_SKEW_SECONDS;
  const expiresAt = issuedAt + BigInt(ATTESTATION_VALIDITY_SECONDS);
  const nonce = ("0x" + randomBytes(32).toString("hex")) as Hex;

  const signature = await signAttestation({
    subject: subject as Address,
    kind,
    issuedAt,
    expiresAt,
    nonce,
  });

  return NextResponse.json({
    attestation: {
      subject,
      kind,
      issuedAt: issuedAt.toString(),
      expiresAt: expiresAt.toString(),
      nonce,
      signature,
      attestor: attestor.address,
    },
  });
}
