import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import { scoreMerchant, scoringRequestSchema } from "@/lib/server/scoring";
import { fixtureAdapter } from "@/lib/server/revenue";
import { signScore, scorer } from "@/lib/server/signer";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCORE_VALIDITY_SECONDS = 15 * 60; // scorer attestation valid for 15 minutes

function clientKey(req: NextRequest, borrower: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  return `score:${ip}:${borrower.toLowerCase()}`;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = scoringRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Rate-limit: 10 scoring calls per minute per (ip, borrower) pair.
  const rl = await rateLimit(clientKey(req, parsed.data.borrower), 10, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      },
    );
  }

  let profile;
  try {
    profile = await fixtureAdapter.fetchProfile(parsed.data.merchantProfileRef);
  } catch (e) {
    return NextResponse.json(
      { error: "merchant profile not found", detail: (e as Error).message },
      { status: 404 },
    );
  }

  let result;
  try {
    result = await scoreMerchant(profile, parsed.data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown scoring error";
    return NextResponse.json({ error: "scoring failed", detail: message }, { status: 502 });
  }

  // Build the EIP-712 Score payload the CreditLine contract expects.
  // CreditLine rejects issuedAt > block.timestamp; back-date by 2 minutes so
  // a fast server never races ahead of HashKey Chain's block clock.
  const ISSUED_CLOCK_SKEW_SECONDS = 120n;
  const issuedAt = BigInt(Math.floor(Date.now() / 1000)) - ISSUED_CLOCK_SKEW_SECONDS;
  const expiresAt = issuedAt + BigInt(SCORE_VALIDITY_SECONDS);
  const nonce = ("0x" + randomBytes(32).toString("hex")) as Hex;
  // Convert HKD cents → HKDm base units (HKDm has 6 decimals; 1 HKD = 1e6 units)
  const maxLine = BigInt(result.maxLineCents) * 10_000n; // cents * 1e4 = HKD * 1e6
  const signature = await signScore({
    borrower: parsed.data.borrower as Address,
    tier: result.tier,
    maxLine,
    aprBps: result.aprBps,
    issuedAt,
    expiresAt,
    nonce,
  });

  return NextResponse.json({
    score: {
      tier: result.tier,
      tierLabel: result.tierLabel,
      aprBps: result.aprBps,
      maxLineCents: result.maxLineCents,
      maxLineRaw: maxLine.toString(),
      rationale: result.rationale,
      features: result.features,
      methodologyVersion: result.methodologyVersion,
    },
    attestation: {
      borrower: parsed.data.borrower,
      tier: result.tier,
      maxLine: maxLine.toString(),
      aprBps: result.aprBps,
      issuedAt: issuedAt.toString(),
      expiresAt: expiresAt.toString(),
      nonce,
      signature,
      scorer: scorer.address,
    },
  });
}
