import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getCartByCartMandateId, type SandboxCart } from "@/lib/server/hp2/sandbox-state";
import { sandboxToPaymentRecord } from "@/lib/server/hp2/sandbox-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sandbox mirror of `GET /api/v1/public/payments/cart-mandate?cart_mandate_id=…`
 * (Single-Pay §6.3).
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("cart_mandate_id");
  if (!id) {
    return NextResponse.json({ code: 10001, msg: "missing cart_mandate_id", data: null }, { status: 400 });
  }
  const cart: SandboxCart | undefined = getCartByCartMandateId(id);
  if (!cart) {
    return NextResponse.json({ code: 10003, msg: "resource not found", data: null }, { status: 404 });
  }
  return NextResponse.json({ code: 0, msg: "success", data: [sandboxToPaymentRecord(cart)] });
}
