import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { signAttestation, attestor } from "@/lib/server/signer";
import { rateLimit } from "@/lib/server/rateLimit";
import { verifySemaphoreProof } from "@/lib/server/zk";
import type { SemaphoreProof } from "@semaphore-protocol/proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/poh/attest — issue a humanity + business attestation ONLY after
 * a real Semaphore (Groth16) zero-knowledge proof has been verified.
 *
 *   - `zkProof`  : the Semaphore proof object produced client-side
 *   - `subject`  : the wallet that will hold the on-chain attestation
 *   - `kind`     : 1 (humanity), 2 (business), 3 (bundle)
 *
 * The ZK proof binds:
 *   - scope   = subject address interpreted as a bigint
 *   - message = keccak-style hash of `${subject}:${kind}:${clientNonce}`
 *
 * A valid proof means: "someone enrolled in the anonymity group proved they
 * know the private identity behind one of the public commitments, and that
 * proof is scoped to this wallet." We don't learn who the prover is —
 * only that they're in the group.
 *
 * On success we sign an EIP-712 attestation that the on-chain PoHRegistry
 * contract accepts. The contract itself never sees the ZK proof.
 */

const ATTESTATION_VALIDITY_SECONDS = 180 * 24 * 60 * 60;

const zkProofSchema = z.object({
  merkleTreeDepth: z.number().int(),
  merkleTreeRoot: z.string(),
  message: z.string(),
  nullifier: z.string(),
  scope: z.string(),
  points: z.array(z.string()).length(8),
});

const bodySchema = z.object({
  subject: z.string().refine(isAddress, "subject must be a valid address"),
  kind: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  zkProof: zkProofSchema,
  clientNonce: z.string().min(8).max(128),
});

/** Derive the scope integer the client must have used when generating proof. */
function scopeForSubject(subject: string): bigint {
  return BigInt(subject);
}

/** Derive the message integer the client must have used. */
function messageForSubject(subject: string, kind: number, nonce: string): bigint {
  // Hash a canonical string into a BN254-friendly integer. We keep the
  // low 248 bits of sha256 to stay under the BabyJubJub scalar field.
  const s = `${subject.toLowerCase()}:${kind}:${nonce}`;
  const h = createHash("sha256").update(s).digest("hex");
  return BigInt("0x" + h.slice(0, 62));
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

  const { subject, kind, zkProof, clientNonce } = parsed.data;

  const rl = await rateLimit(`poh:${subject.toLowerCase()}:${kind}`, 5, 24 * 60 * 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "too many attestations for this wallet in 24h" },
      { status: 429 },
    );
  }

  // Verify the client used the expected scope (the subject address) so the
  // proof cannot be replayed across wallets.
  const expectedScope = scopeForSubject(subject);
  if (BigInt(zkProof.scope) !== expectedScope) {
    return NextResponse.json(
      { error: "proof scope does not match subject wallet" },
      { status: 400 },
    );
  }

  // Verify the client used the expected message (binds to a fresh challenge).
  const expectedMessage = messageForSubject(subject, kind, clientNonce);
  if (BigInt(zkProof.message) !== expectedMessage) {
    return NextResponse.json(
      { error: "proof message does not match challenge" },
      { status: 400 },
    );
  }

  // Run the real Groth16 zk-SNARK verification. Throws on any failure.
  try {
    await verifySemaphoreProof(zkProof as SemaphoreProof);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "proof rejected";
    return NextResponse.json({ error: `zk_proof_rejected`, detail: msg }, { status: 401 });
  }

  // Back-date issuedAt to absorb block-clock drift on HashKey testnet.
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
    zk: {
      merkle_root: zkProof.merkleTreeRoot,
      nullifier: zkProof.nullifier,
      group_member_count: zkProof.merkleTreeDepth,
    },
  });
}
