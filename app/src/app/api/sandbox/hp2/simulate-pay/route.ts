import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hmacSha256Hex } from "@/lib/server/hp2/signer";
import {
  getCartByFlowId,
  iso,
  updateCartStatus,
} from "@/lib/server/hp2/sandbox-state";
import { hp2WebhookSecret } from "@/lib/server/hp2/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  flowId: z.string().uuid(),
  outcome: z.enum(["success", "failure"]).default("success"),
});

/**
 * POST /api/sandbox/hp2/simulate-pay
 *
 * Internal sandbox-only endpoint. When the sandbox checkout page's
 * "Pay" button is clicked, the server:
 *   1. Finds the cart by flow_id
 *   2. Updates its status to payment-successful (or payment-failed)
 *   3. Builds a real HP2-shape webhook payload
 *   4. Signs it with HMAC-SHA256(app_secret, "{ts}.{rawBody}")
 *   5. Fires the signed callback at /api/webhooks/hp2 (self-fetch)
 *
 * The webhook handler runs the REAL verification + REAL on-chain settlement.
 * The only sandboxed element is this endpoint itself — equivalent to what
 * the real HP2 gateway does internally when a customer's USDC transfer
 * confirms on-chain.
 */
export async function POST(req: NextRequest) {
  const secret = hp2WebhookSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "HP2_APP_SECRET not set — sandbox cannot sign webhook" },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const cart = getCartByFlowId(parsed.data.flowId);
  if (!cart) return NextResponse.json({ error: "flow not found" }, { status: 404 });

  // Simulate a plausible sandbox payer address (random for demo — in real HP2
  // it would be the user's actual wallet that submitted the EIP-3009 auth).
  const payerAddress = "0x" + randomBytes(20).toString("hex");

  const isSuccess = parsed.data.outcome === "success";
  // Generate a plausible-looking "tx signature" for the demo. This is NOT
  // an on-chain USDC tx — HP2 is USDC-based and our downstream settlement
  // happens in HKDm. The downstream on-chain tx hash returned by the
  // webhook response reflects the real HKDm settlement.
  const simulatedTxSignature = "0x" + randomBytes(32).toString("hex");

  updateCartStatus(cart.flowId, {
    status: isSuccess ? "payment-successful" : "payment-failed",
    payerAddress,
    txSignature: isSuccess ? simulatedTxSignature : undefined,
    completedAt: isSuccess ? iso() : undefined,
    statusReason: isSuccess ? undefined : "sandbox simulated failure",
  });

  const webhookBody = {
    event_type: "payment" as const,
    payment_request_id: cart.paymentRequestId,
    request_id: `sandbox_${randomBytes(6).toString("hex")}`,
    cart_mandate_id: cart.cartMandateId,
    payer_address: payerAddress,
    amount: cart.usdcMinorUnits,
    token: "USDC",
    token_address: cart.tokenAddress,
    network: cart.network,
    status: isSuccess ? "payment-successful" : "payment-failed",
    created_at: cart.createdAt,
    ...(isSuccess
      ? { tx_signature: simulatedTxSignature, completed_at: iso() }
      : { status_reason: "sandbox simulated failure" }),
  };
  const rawBody = JSON.stringify(webhookBody);

  // Sign per Single-Pay §7.3: X-Signature: t=<unix>,v1=<hmac_hex>
  const ts = Math.floor(Date.now() / 1000);
  const signature = hmacSha256Hex(secret, `${ts}.${rawBody}`);
  const xSignature = `t=${ts},v1=${signature}`;

  // Self-fetch our own webhook handler.
  const webhookUrl = `${req.nextUrl.origin}/api/webhooks/hp2`;
  const webhookRes = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": xSignature,
    },
    body: rawBody,
  });
  const webhookResBody = await webhookRes.json().catch(() => ({}));

  return NextResponse.json({
    ok: true,
    outcome: parsed.data.outcome,
    webhook_status: webhookRes.status,
    webhook_response: webhookResBody,
    // Convenience fields for the checkout UI so it can display the on-chain tx link
    routed: webhookResBody?.routed ?? false,
    tx_hash: webhookResBody?.tx_hash,
    reason: webhookResBody?.reason,
  });
}
