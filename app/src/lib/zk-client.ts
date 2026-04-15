"use client";

import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, type SemaphoreProof } from "@semaphore-protocol/proof";

/**
 * Client-side helpers around Semaphore v4 (Groth16 zk-SNARK).
 *
 * A ZephyrPay "identity" is a Semaphore Identity — a secret key pair plus
 * a deterministic public commitment. We persist the serialized identity in
 * localStorage so the user keeps the same ZK identity across page loads;
 * otherwise each visit would create a fresh commitment and pollute the group.
 */

const STORAGE_KEY = "zephyrpay.zk.identity";

export function loadOrCreateIdentity(): Identity {
  if (typeof window === "undefined") {
    throw new Error("loadOrCreateIdentity must run in the browser");
  }
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return new Identity(saved);
    } catch {
      // corrupt — regenerate below
    }
  }
  const ident = new Identity();
  window.localStorage.setItem(STORAGE_KEY, ident.export());
  return ident;
}

export async function enrollIdentity(identity: Identity): Promise<{ size: number; root: string }> {
  const res = await fetch("/api/zk/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commitment: identity.commitment.toString() }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? body.error ?? `enroll failed (${res.status})`);
  }
  const json = (await res.json()) as { group_size: number; merkle_root: string };
  return { size: json.group_size, root: json.merkle_root };
}

export async function fetchGroup(): Promise<Group> {
  const res = await fetch("/api/zk/members");
  if (!res.ok) throw new Error(`members fetch failed (${res.status})`);
  const body = (await res.json()) as { members: string[] };
  const group = new Group();
  for (const m of body.members) group.addMember(BigInt(m));
  return group;
}

export interface ProofInputs {
  identity: Identity;
  subject: `0x${string}`; // wallet address — becomes the proof scope
  kind: 1 | 2 | 3;
  clientNonce: string; // fresh, binds the proof to this session
}

/**
 * Scope is the subject wallet interpreted as a bigint. The server enforces
 * this match, so the same identity can only attest for the specific wallet
 * the user controls (prevents proof reuse across wallets).
 */
export function scopeFor(subject: string): bigint {
  return BigInt(subject);
}

/**
 * Message is sha256(`${subject}:${kind}:${clientNonce}`), truncated to fit
 * the BabyJubJub scalar field. Must match the server's derivation in
 * /api/poh/attest. Uses Web Crypto so it runs identically in browser and
 * edge runtimes.
 */
export async function messageFor(subject: string, kind: number, nonce: string): Promise<bigint> {
  const s = `${subject.toLowerCase()}:${kind}:${nonce}`;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const hex = Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return BigInt("0x" + hex.slice(0, 62));
}

export async function buildProof(inputs: ProofInputs): Promise<SemaphoreProof> {
  const group = await fetchGroup();
  const scope = scopeFor(inputs.subject);
  const message = await messageFor(inputs.subject, inputs.kind, inputs.clientNonce);
  return generateProof(inputs.identity, group, message, scope);
}
