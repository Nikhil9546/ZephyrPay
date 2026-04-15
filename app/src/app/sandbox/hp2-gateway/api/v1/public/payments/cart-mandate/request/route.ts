import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getCartByPaymentRequestId } from "@/lib/server/hp2/sandbox-state";
import { sandboxToPaymentRecord } from "@/lib/server/hp2/sandbox-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sandbox mirror of `GET /api/v1/public/payments/cart-mandate/request?payment_request_id=…`
 * (Single-Pay §6.4). This is the endpoint the UI polls while waiting for
 * a sandbox customer to click the "Pay" button.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("payment_request_id");
  if (!id) {
    return NextResponse.json({ code: 10001, msg: "missing payment_request_id", data: null }, { status: 400 });
  }
  const cart = getCartByPaymentRequestId(id);
  if (!cart) {
    return NextResponse.json({ code: 10003, msg: "resource not found", data: null }, { status: 404 });
  }
  return NextResponse.json({ code: 0, msg: "success", data: sandboxToPaymentRecord(cart) });
}
