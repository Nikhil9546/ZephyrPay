import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildApiSigningMessage,
  hmacSha256Hex,
} from "@/lib/server/hp2/signer";
import { canonicalHashHex } from "@/lib/server/hp2/canonical";
import {
  iso,
  newFlowId,
  storeCart,
  type SandboxCart,
} from "@/lib/server/hp2/sandbox-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sandbox mirror of `POST /api/v1/public/cart-mandate` from HashKey HP2
 * Single-Pay (§6.1).
 *
 * Behaviour (identical to real HP2):
 *   1. Verify HMAC-SHA256 headers (X-App-Key + X-Signature + X-Timestamp + X-Nonce)
 *   2. Validate the `merchant_authorization` JWT's `cart_hash` matches the
 *      SHA-256 of the canonical JSON of `cart_mandate.contents`.
 *      (We stop short of verifying the ES256K signature — the real HP2
 *      gateway checks it against the merchant's registered public key;
 *      we don't have a merchant registry, so we trust the hash match as
 *      a sufficient "the payload wasn't tampered with" signal for the demo.)
 *   3. Generate a flow_id, store the cart, return `payment_url` pointing at
 *      our local sandbox checkout page.
 */

const reqSchema = z.object({
  cart_mandate: z.object({
    contents: z.object({
      id: z.string().min(1),
      user_cart_confirmation_required: z.boolean(),
      payment_request: z.object({
        method_data: z
          .array(
            z.object({
              supported_methods: z.string(),
              data: z.object({
                x402Version: z.number(),
                network: z.string(),
                chain_id: z.number(),
                contract_address: z.string(),
                pay_to: z.string(),
                coin: z.string(),
              }),
            }),
          )
          .min(1),
        details: z.object({
          id: z.string().min(1),
          display_items: z.array(
            z.object({
              label: z.string(),
              amount: z.object({ currency: z.string(), value: z.string() }),
            }),
          ),
          total: z.object({
            label: z.string(),
            amount: z.object({ currency: z.string(), value: z.string() }),
          }),
        }),
      }),
      cart_expiry: z.string(),
      merchant_name: z.string().min(1),
    }),
    merchant_authorization: z.string().min(1),
  }),
  redirect_url: z.string().url().optional(),
});

function envelope<T>(data: T) {
  return { code: 0, msg: "success", data };
}
function err(code: number, status: number, msg: string) {
  return NextResponse.json({ code, msg, data: null }, { status });
}

function verifyHmac(req: NextRequest, rawBody: string): string | null {
  const appKey = req.headers.get("x-app-key");
  const signature = req.headers.get("x-signature");
  const timestamp = req.headers.get("x-timestamp");
  const nonce = req.headers.get("x-nonce");
  if (!appKey || !signature || !timestamp || !nonce) return "missing HMAC headers";
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return "timestamp out of tolerance";
  }
  const expectedAppKey = process.env.HP2_APP_KEY ?? "";
  const appSecret = process.env.HP2_APP_SECRET ?? "";
  if (!expectedAppKey || !appSecret) return "sandbox HMAC secrets not configured";
  if (appKey !== expectedAppKey) return "unknown app_key";
  const bodyHash = rawBody ? createHash("sha256").update(rawBody).digest("hex") : "";
  // HP2Client signs the spec path (`/api/v1/public/cart-mandate`), not our
  // locally-hosted prefix (`/sandbox/hp2-gateway/...`). Strip the prefix
  // before recomputing the expected signature so the sandbox is wire-
  // compatible with the real gateway.
  const msg = buildApiSigningMessage({
    method: "POST",
    path: "/api/v1/public/cart-mandate",
    query: "",
    bodyHash,
    timestamp,
    nonce,
  });
  const expected = hmacSha256Hex(appSecret, msg);
  if (expected !== signature) return "bad signature";
  return null;
}

/**
 * Extract the `cart_hash` claim from a JWT without verifying the signature.
 * We only need to compare it against what we compute locally; real HP2
 * verifies the signature against the merchant's registered public key.
 */
function extractJwtCartHash(jwt: string): string | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { cart_hash?: unknown };
    return typeof payload.cart_hash === "string" ? payload.cart_hash : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmacError = verifyHmac(req, rawBody);
  if (hmacError) return err(10002, 401, `unauthorized: ${hmacError}`);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return err(10001, 400, "invalid JSON");
  }
  const parsed = reqSchema.safeParse(body);
  if (!parsed.success) return err(10001, 400, "invalid request parameters");

  const { contents, merchant_authorization } = parsed.data.cart_mandate;

  // cart_hash integrity check — the JWT's cart_hash claim must match what
  // we compute from the canonical JSON of contents.
  const expectedHash = canonicalHashHex(contents);
  const jwtHash = extractJwtCartHash(merchant_authorization);
  if (!jwtHash) return err(10001, 400, "merchant_authorization JWT missing cart_hash");
  if (jwtHash !== expectedHash) {
    return err(10002, 401, "cart_hash mismatch — contents were tampered with or canonicalized differently");
  }

  const firstMethod = contents.payment_request.method_data[0].data;
  // Amount in minor units: total.value × 10^decimals (USDC = 6dp)
  const [intPart, fracPart = ""] = contents.payment_request.details.total.amount.value.split(".");
  const minor = (BigInt(intPart) * 1_000_000n + BigInt((fracPart + "000000").slice(0, 6))).toString();

  const flowId = newFlowId();
  const cart: SandboxCart = {
    cartMandateId: contents.id,
    paymentRequestId: contents.payment_request.details.id,
    flowId,
    merchantName: contents.merchant_name,
    appKey: req.headers.get("x-app-key") ?? "",
    amountUsd: contents.payment_request.details.total.amount.value,
    usdcMinorUnits: minor,
    merchantPayTo: firstMethod.pay_to,
    tokenAddress: firstMethod.contract_address,
    chainId: firstMethod.chain_id,
    network: firstMethod.network,
    redirectUrl: parsed.data.redirect_url,
    expiresAt: contents.cart_expiry,
    createdAt: iso(),
    status: "payment-required",
  };
  storeCart(cart);

  const baseUrl = req.nextUrl.origin;
  const paymentUrl = `${baseUrl}/sandbox/hp2-gateway/flow/${flowId}`;

  return NextResponse.json(
    envelope({
      payment_request_id: cart.paymentRequestId,
      payment_url: paymentUrl,
      multi_pay: false,
    }),
  );
}
