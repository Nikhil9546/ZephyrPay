import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enrollCommitment, groupRoot, groupSize } from "@/lib/server/zk";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  /**
   * The public identity commitment (BabyJubJub point) produced client-side
   * from a fresh `@semaphore-protocol/identity` Identity instance. Sent as
   * a decimal string because bigint doesn't JSON-serialize natively.
   */
  commitment: z.string().regex(/^\d+$/, "commitment must be a decimal bigint string"),
});

/**
 * POST /api/zk/enroll — add a new identity commitment to the anonymity group.
 *
 * This is the analogue of "sign up" in a traditional auth system, but the
 * server never learns who the user is — only that they've produced a fresh
 * commitment. Later the user proves membership in this group via zk-SNARK
 * without revealing which commitment is theirs.
 */
export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rl = await rateLimit(`zk:enroll:${ip}`, 10, 60 * 60); // 10 enrolls / hour / IP
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  try {
    const { groupSize: size, index } = enrollCommitment(BigInt(parsed.data.commitment));
    return NextResponse.json({
      enrolled: true,
      group_index: index,
      group_size: size,
      merkle_root: groupRoot().toString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "enroll failed";
    return NextResponse.json({ error: "enroll_failed", detail: msg }, { status: 500 });
  }
}

/** GET — expose current group root so clients can build proofs against it. */
export async function GET() {
  return NextResponse.json({
    merkle_root: groupRoot().toString(),
    group_size: groupSize(),
  });
}
