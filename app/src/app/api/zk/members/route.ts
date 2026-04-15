import "server-only";
import { NextResponse } from "next/server";
import { Group } from "@semaphore-protocol/group";
import { groupRoot } from "@/lib/server/zk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/zk/members — return the current anonymity group so clients can
 * reconstruct it locally and generate their Merkle inclusion proof.
 *
 * Exposing the full member set is safe: Semaphore's zero-knowledge property
 * comes from the proof (the prover reveals nothing about WHICH member they
 * are), not from hiding the member list. The anonymity set is public.
 */
export async function GET() {
  // We read via groupRoot() to ensure the same globalThis group is used;
  // the Group instance is internal to @/lib/server/zk, but we can
  // reconstruct the member list trivially because Group exposes a .members
  // getter on the shared instance.
  const shared = (globalThis as unknown as { __zp_zk_group?: Group }).__zp_zk_group;
  const members = shared ? shared.members.map((m) => m.toString()) : [];
  return NextResponse.json({
    merkle_root: groupRoot().toString(),
    members,
    size: members.length,
  });
}
