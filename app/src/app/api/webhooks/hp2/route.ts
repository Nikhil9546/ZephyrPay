import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyWebhookSignature } from "@/lib/server/hp2/signer";
import { hp2WebhookSecret } from "@/lib/server/hp2/config";
import { lookupCartMandate } from "@/lib/server/hp2/store";
import { isSettlementConfigured, settleOnChain, usdcAmountToHkdmUnits } from "@/lib/server/onchain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/hp2
 *
 * Receives payment result notifications from the HP2 gateway (§7 of the
 * Single-Pay guide). The handler MUST:
 *
 *   1. Return an HTTP 2xx within 10 seconds or HP2 retries (1m, 5m, 15m,
 *      1h, 6h, 24h — up to 6 retries).
 *   2. Verify the `X-Signature: t=<ts>,v1=<hmac>` header using HMAC-SHA256
 *      over `timestamp + "." + rawBody`.
 *   3. Be idempotent — the same `request_id` can arrive multiple times.
 *
 * If the payment is `payment-successful` AND our local store says this
 * cart_mandate_id was created with `autoRepayFromCreditLine=true`, we
 * route the proceeds into `CreditLine.onSaleReceived(borrower, amount)`
 * on HashKey Chain — automatically paying down the merchant's loan the
 * moment the customer's USDC payment confirms on-chain.
 */

const eventSchema = z.object({
  event_type: z.literal("payment"),
  payment_request_id: z.string(),
  request_id: z.string(),
  cart_mandate_id: z.string(),
  payer_address: z.string(),
  amount: z.string(),
  token: z.string(),
  token_address: z.string(),
  network: z.string(),
  status: z.enum(["payment-successful", "payment-failed"]),
  created_at: z.string(),
  tx_signature: z.string().optional(),
  completed_at: z.string().optional(),
  status_reason: z.string().optional(),
});

// Dedupe cache (in-memory) for request_id idempotency. Replace with Redis
// in production so multiple app instances share the same dedupe set.
const seenRequestIds = new Map<string, number>();
const DEDUP_TTL_MS = 48 * 60 * 60 * 1000;
function alreadyProcessed(requestId: string): boolean {
  const now = Date.now();
  for (const [k, v] of seenRequestIds.entries()) {
    if (now - v > DEDUP_TTL_MS) seenRequestIds.delete(k);
  }
  if (seenRequestIds.has(requestId)) return true;
  seenRequestIds.set(requestId, now);
  return false;
}

export async function POST(req: NextRequest) {
  const secret = hp2WebhookSecret();
  if (!secret) {
    // Important: return 2xx so HP2 doesn't retry forever if this env is
    // genuinely deconfigured. Log for operators.
    console.warn("[hp2-webhook] received callback but HP2 is not configured");
    return NextResponse.json({ ok: true, skipped: "hp2_not_configured" });
  }

  const rawBody = await req.text();
  const header = req.headers.get("x-signature");
  if (!verifyWebhookSignature({ rawBody, header, appSecret: secret })) {
    // HP2 will retry on non-2xx; for bad signatures we DO want to signal
    // the failure so a misconfigured sender fixes it.
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = eventSchema.parse(JSON.parse(rawBody));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "parse failed";
    return NextResponse.json({ error: "invalid_payload", detail: msg }, { status: 400 });
  }

  // Idempotency — short-circuit if we've already processed this request_id.
  if (alreadyProcessed(parsed.request_id)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  // Local context lookup: which ZephyrPay borrower does this cart belong to,
  // and were they flagged for auto-repay?
  const ctx = lookupCartMandate(parsed.cart_mandate_id);
  if (!ctx) {
    console.warn(`[hp2-webhook] unknown cart_mandate_id: ${parsed.cart_mandate_id}`);
    return NextResponse.json({ ok: true, skipped: "unknown_cart_mandate" });
  }

  if (parsed.status === "payment-failed") {
    console.info(`[hp2-webhook] payment failed for ${parsed.cart_mandate_id}: ${parsed.status_reason}`);
    return NextResponse.json({ ok: true, status: "failed" });
  }

  // --- Success path ---
  if (!ctx.autoRepayFromCreditLine) {
    return NextResponse.json({
      ok: true,
      status: "success",
      routed: false,
      reason: "auto_repay_disabled",
    });
  }

  if (!isSettlementConfigured()) {
    console.warn("[hp2-webhook] settlement relayer key not configured; cannot route on-chain");
    return NextResponse.json({ ok: true, status: "success", routed: false, reason: "settlement_not_configured" });
  }

  try {
    const result = await settleOnChain(ctx.borrower, usdcAmountToHkdmUnits(parsed.amount));
    if ("skipped" in result) {
      return NextResponse.json({
        ok: true,
        status: "success",
        routed: false,
        reason: result.skipped,
      });
    }
    return NextResponse.json({
      ok: true,
      status: "success",
      routed: true,
      tx_hash: result.txHash,
      block_number: result.blockNumber.toString(),
    });
  } catch (e) {
    // If we 500 here HP2 retries — which is what we want for transient
    // on-chain failures. Log for operators.
    const msg = e instanceof Error ? e.message : "settlement failed";
    console.error(`[hp2-webhook] settlement failed: ${msg}`);
    return NextResponse.json({ error: "settlement_failed", detail: msg }, { status: 500 });
  }
}
