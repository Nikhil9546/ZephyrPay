import "server-only";
import { Group } from "@semaphore-protocol/group";
import { verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";

/**
 * Real zk-SNARK proof of humanity using Semaphore v4 (Groth16).
 *
 * The flow:
 *   1. Client generates a secp-friendly identity (private commitment + nullifier).
 *   2. Client POSTs the public commitment to /api/zk/enroll — server adds it to
 *      an anonymity-set Merkle tree ("the group").
 *   3. At verification time, client generates a Groth16 proof that:
 *        a. They know a private identity whose commitment is in the group, and
 *        b. The proof binds to a specific scope (their wallet address) and a
 *           message (a fresh challenge nonce).
 *      The proof reveals a unique `nullifier` per (identity, scope) — so the
 *      same identity can only be used once for a given wallet, preventing reuse.
 *   4. Server verifies the proof with Semaphore's Groth16 verifier (real
 *      zk-SNARK check) and only then signs the EIP-712 PoH attestation.
 *
 * This is a genuine zero-knowledge proof: the server learns nothing about the
 * identity beyond "a member of the enrolled group signed this scoped message."
 * No revelation of which commitment, no linkage across scopes.
 */

// ---- Group state ---------------------------------------------------------
// In-memory group; persist across HMR via globalThis. Swap for a durable
// Merkle-tree store (Redis / SQL) when moving to multi-instance deployments.

declare global {
  // eslint-disable-next-line no-var
  var __zp_zk_group: Group | undefined;
  // eslint-disable-next-line no-var
  var __zp_zk_nullifiers: Set<string> | undefined;
}

function getGroup(): Group {
  if (!globalThis.__zp_zk_group) {
    globalThis.__zp_zk_group = new Group();
  }
  return globalThis.__zp_zk_group;
}

function getUsedNullifiers(): Set<string> {
  if (!globalThis.__zp_zk_nullifiers) {
    globalThis.__zp_zk_nullifiers = new Set();
  }
  return globalThis.__zp_zk_nullifiers;
}

export function enrollCommitment(commitment: bigint): { groupSize: number; index: number } {
  const group = getGroup();
  // Dedupe: if this commitment is already in the group, return its existing index.
  const existingIdx = group.indexOf(commitment);
  if (existingIdx >= 0) {
    return { groupSize: group.size, index: existingIdx };
  }
  group.addMember(commitment);
  return { groupSize: group.size, index: group.size - 1 };
}

export function groupRoot(): bigint {
  return getGroup().root;
}

export function groupSize(): number {
  return getGroup().size;
}

// ---- Proof verification --------------------------------------------------

export interface VerifiedProof {
  merkleRoot: bigint;
  nullifier: bigint;
  message: bigint;
  scope: bigint;
}

/**
 * Verify a Semaphore Groth16 proof. Succeeds iff:
 *   - the Merkle root in the proof matches the current group root
 *   - the zk-SNARK verifies against Semaphore's published verification key
 *   - the nullifier hasn't been used yet (single-use per identity × scope)
 *
 * Throws on any failure — callers should treat any throw as "proof rejected".
 */
export async function verifySemaphoreProof(proof: SemaphoreProof): Promise<VerifiedProof> {
  const currentRoot = groupRoot();
  if (BigInt(proof.merkleTreeRoot) !== currentRoot) {
    throw new Error(
      `stale merkle root: proof carries ${proof.merkleTreeRoot}, group is ${currentRoot}`,
    );
  }

  // Real Groth16 verification against Semaphore's built-in verification key.
  const ok = await verifyProof(proof);
  if (!ok) throw new Error("zk-SNARK proof failed verification");

  const nullifierKey = proof.nullifier.toString();
  const used = getUsedNullifiers();
  if (used.has(nullifierKey)) throw new Error("nullifier already used");
  used.add(nullifierKey);

  return {
    merkleRoot: BigInt(proof.merkleTreeRoot),
    nullifier: BigInt(proof.nullifier),
    message: BigInt(proof.message),
    scope: BigInt(proof.scope),
  };
}
