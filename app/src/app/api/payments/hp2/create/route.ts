import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getHP2Client, getHP2PayTo } from "@/lib/server/hp2/config";
import { HP2_HASHKEY_TESTNET_USDC } from "@/lib/server/hp2/client";
import { rememberCartMandate } from "@/lib/server/hp2/store";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  borrower: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Amount in USD (decimal string, e.g. "15.00"). HP2 is USD-denominated. */
  amountUSD: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/),
  description: z.string().min(1).max(80).default("ZephyrPay settlement"),
  /** Optional — if true, a successful payment auto-repays the borrower's loan. */
  autoRepayFromCreditLine: z.boolean().default(true),
  /** Optional — where HP2 should redirect the user after payment. */
  redirectUrl: z.string().url().optional(),
});

/**
 * POST /api/payments/hp2/create
 *
 * Creates an HP2 (HashKey Payment) Cart Mandate for the given amount and
 * returns the `payment_url` to show the payer. The response also contains
 * our internal IDs so the frontend can poll/display status.
 *
 * Metadata we encode in the IDs:
 *   - cart_mandate_id = `zp_{borrower_prefix}_{uuid}_{autoRepayFlag}`
 *     → the webhook handler parses this to determine whether to route the
 *       proceeds into CreditLine.onSaleReceived(borrower, amount).
 *   - payment_request_id = same as cart_mandate_id in Single-Pay.
 *
 * If HP2 is not configured, returns 503 with a descriptive error rather than
 * crashing — keeps the rest of the app functional during pre-registration.
 */
export async function POST(req: NextRequest) {
  const client = getHP2Client();
  const payTo = getHP2PayTo();
  if (!client || !payTo) {
    return NextResponse.json(
      {
        error: "hp2_not_configured",
        detail:
          "HP2 merchant credentials are not yet provisioned. Set HP2_BASE_URL, HP2_APP_KEY, HP2_APP_SECRET, HP2_MERCHANT_NAME, HP2_MERCHANT_PRIVATE_KEY, HP2_PAY_TO and redeploy.",
      },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 10 payment-link creations per minute per (IP, borrower).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rl = await rateLimit(`hp2:create:${ip}:${parsed.data.borrower.toLowerCase()}`, 10, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  const borrowerPrefix = parsed.data.borrower.slice(2, 10).toLowerCase();
  const flag = parsed.data.autoRepayFromCreditLine ? "auto" : "noauto";
  const unique = randomUUID().slice(0, 12);
  // Keep under 64 chars for safety; HP2 allows merchant-customized IDs.
  const cartMandateId = `zp-${borrowerPrefix}-${flag}-${unique}`;
  const paymentRequestId = cartMandateId;

  try {
    const res = await client.createCartMandate({
      cartMandateId,
      paymentRequestId,
      merchantName: process.env.HP2_MERCHANT_NAME ?? "ZephyrPay",
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2h per §4.3
      method: { ...HP2_HASHKEY_TESTNET_USDC, pay_to: payTo },
      displayItems: [{ label: parsed.data.description, currency: "USD", value: parsed.data.amountUSD }],
      total: { label: "Total", currency: "USD", value: parsed.data.amountUSD },
      userCartConfirmationRequired: true,
      redirectUrl: parsed.data.redirectUrl,
    });

    // Remember the context for the webhook. Without this the webhook handler
    // can't correlate an HP2 payment back to a ZephyrPay borrower.
    rememberCartMandate(cartMandateId, {
      borrower: parsed.data.borrower as `0x${string}`,
      amountUsd: parsed.data.amountUSD,
      autoRepayFromCreditLine: parsed.data.autoRepayFromCreditLine,
    });

    return NextResponse.json({
      payment_url: res.payment_url,
      payment_request_id: res.payment_request_id,
      cart_mandate_id: cartMandateId,
      borrower: parsed.data.borrower,
      amount_usd: parsed.data.amountUSD,
      auto_repay_from_credit_line: parsed.data.autoRepayFromCreditLine,
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown HP2 error";
    return NextResponse.json({ error: "hp2_create_failed", detail: msg }, { status: 502 });
  }
}
