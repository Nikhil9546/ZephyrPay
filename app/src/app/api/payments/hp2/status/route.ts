import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getHP2Client } from "@/lib/server/hp2/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  payment_request_id: z.string().min(1),
});

/**
 * GET /api/payments/hp2/status?payment_request_id=...
 *
 * Poll-friendly status endpoint. The frontend calls this every few seconds
 * while displaying a payment link so the UI can update from "waiting" →
 * "payment-successful" without waiting for the webhook to fire.
 */
export async function GET(req: NextRequest) {
  const client = getHP2Client();
  if (!client) {
    return NextResponse.json({ error: "hp2_not_configured" }, { status: 503 });
  }
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "missing payment_request_id" }, { status: 400 });
  }
  try {
    const record = await client.getPaymentByRequestId(parsed.data.payment_request_id);
    return NextResponse.json({ record });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown HP2 error";
    return NextResponse.json({ error: "hp2_status_failed", detail: msg }, { status: 502 });
  }
}
