import "server-only";
import { createHash, randomUUID, type KeyObject } from "node:crypto";
import { canonicalHashHex } from "./canonical";
import {
  buildApiSigningMessage,
  hmacSha256Hex,
  loadMerchantPrivateKey,
  newStamp,
  signJwtES256K,
} from "./signer";
import type {
  CartContents,
  CartMandateRequestBody,
  CreateCartMandateResponseData,
  HP2ChainConfig,
  HP2Envelope,
  PaymentMethodData,
  PaymentRecord,
} from "./types";

/**
 * Client for the HashKey HP2 (Payment Protocol v2) Single-Pay API.
 *
 * Implements every primitive defined in HashKeyMerchantPaymentSingle-PayIntegrationGuide
 * v1.1.0:
 *
 *   - HMAC-SHA256 request signing (§3.2)
 *   - ES256K JWT merchant_authorization (§9)
 *   - Canonical JSON → cart_hash claim
 *   - CreateCartMandate (POST /api/v1/public/cart-mandate)
 *   - GetCartMandatePayments (GET /api/v1/public/payments/cart-mandate)
 *   - GetPaymentByRequestId  (GET /api/v1/public/payments/cart-mandate/request)
 *   - GetPaymentByFlowId     (GET /api/v1/public/pay-mandate/{flow_id})
 *   - GetChainConfig         (GET /api/v1/payment/chain-config, no auth)
 *
 * A parallel `verifyWebhookSignature` helper lives in ./signer.ts for the
 * inbound webhook handler.
 *
 * Environments (§10):
 *   - QA:   https://merchant-qa.hashkeymerchant.com
 *   - Prod: set via HP2_BASE_URL env var once HashKey publishes it.
 */

export interface HP2ClientConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  merchantName: string;
  merchantPrivateKey: KeyObject;
}

export interface CartMandateBuilderInput {
  cartMandateId: string; // ID1 — merchant-generated unique order ID
  paymentRequestId: string; // ID2 — 1-to-1 with cartMandateId in Single-Pay
  merchantName: string;
  expiresAt: Date;
  method: PaymentMethodData["data"];
  displayItems: Array<{ label: string; currency: string; value: string }>;
  total: { label: string; currency: string; value: string };
  userCartConfirmationRequired?: boolean;
  redirectUrl?: string;
}

export class HP2Client {
  constructor(private readonly cfg: HP2ClientConfig) {}

  static fromEnv(env: {
    HP2_BASE_URL: string;
    HP2_APP_KEY: string;
    HP2_APP_SECRET: string;
    HP2_MERCHANT_NAME: string;
    HP2_MERCHANT_PRIVATE_KEY: string; // PEM
  }): HP2Client {
    return new HP2Client({
      baseUrl: env.HP2_BASE_URL.replace(/\/$/, ""),
      appKey: env.HP2_APP_KEY,
      appSecret: env.HP2_APP_SECRET,
      merchantName: env.HP2_MERCHANT_NAME,
      merchantPrivateKey: loadMerchantPrivateKey(env.HP2_MERCHANT_PRIVATE_KEY),
    });
  }

  // ---------------------------------------------------------------------
  //                          Cart Mandate builder
  // ---------------------------------------------------------------------

  /**
   * Construct the full signed request body for `POST /api/v1/public/cart-mandate`.
   *
   * Steps (§9.2):
   *   1. Build the `cart_mandate.contents` object.
   *   2. Compute `cart_hash = hex(sha256(canonicalize(contents)))`.
   *   3. Sign an ES256K JWT with claims {iss, sub, aud, iat, exp, jti, cart_hash}.
   *   4. Package { contents, merchant_authorization = jwt }.
   */
  buildSignedCartMandate(input: CartMandateBuilderInput): CartMandateRequestBody {
    const contents: CartContents = {
      id: input.cartMandateId,
      user_cart_confirmation_required: input.userCartConfirmationRequired ?? true,
      payment_request: {
        method_data: [
          {
            supported_methods: "https://www.x402.org/",
            data: input.method,
          },
        ],
        details: {
          id: input.paymentRequestId,
          display_items: input.displayItems.map((it) => ({
            label: it.label,
            amount: { currency: it.currency, value: it.value },
          })),
          total: {
            label: input.total.label,
            amount: { currency: input.total.currency, value: input.total.value },
          },
        },
      },
      cart_expiry: input.expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      merchant_name: input.merchantName,
    };

    const cartHash = canonicalHashHex(contents);
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 60 * 60; // 1 hour, per §9.2
    const jwt = signJwtES256K(this.cfg.merchantPrivateKey, {}, {
      iss: input.merchantName,
      sub: input.merchantName,
      aud: "HashkeyMerchant",
      iat,
      exp,
      jti: `JWT-${iat}-${randomUUID()}`,
      cart_hash: cartHash,
    });

    return {
      cart_mandate: { contents, merchant_authorization: jwt },
      ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
    };
  }

  // ---------------------------------------------------------------------
  //                             HTTP primitives
  // ---------------------------------------------------------------------

  private async authedRequest<T>(method: "GET" | "POST", path: string, query: string, body: string | null): Promise<T> {
    const { timestamp, nonce } = newStamp();
    const bodyHash = body ? createHash("sha256").update(body, "utf8").digest("hex") : "";
    const msg = buildApiSigningMessage({ method, path, query, bodyHash, timestamp, nonce });
    const signature = hmacSha256Hex(this.cfg.appSecret, msg);

    const url = `${this.cfg.baseUrl}${path}${query ? `?${query}` : ""}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-App-Key": this.cfg.appKey,
        "X-Signature": signature,
        "X-Timestamp": timestamp,
        "X-Nonce": nonce,
      },
      body: body ?? undefined,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HP2 ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    const parsed = (await res.json()) as HP2Envelope<T>;
    if (parsed.code !== 0) {
      throw new Error(`HP2 ${method} ${path} code=${parsed.code}: ${parsed.msg}`);
    }
    return parsed.data;
  }

  // ---------------------------------------------------------------------
  //                               Endpoints
  // ---------------------------------------------------------------------

  async createCartMandate(input: CartMandateBuilderInput): Promise<CreateCartMandateResponseData> {
    const body = JSON.stringify(this.buildSignedCartMandate(input));
    return this.authedRequest<CreateCartMandateResponseData>(
      "POST",
      "/api/v1/public/cart-mandate",
      "",
      body,
    );
  }

  async getPaymentsByCartMandate(cartMandateId: string): Promise<PaymentRecord[]> {
    const query = `cart_mandate_id=${encodeURIComponent(cartMandateId)}`;
    return this.authedRequest<PaymentRecord[]>(
      "GET",
      "/api/v1/public/payments/cart-mandate",
      query,
      null,
    );
  }

  async getPaymentByRequestId(paymentRequestId: string): Promise<PaymentRecord> {
    const query = `payment_request_id=${encodeURIComponent(paymentRequestId)}`;
    return this.authedRequest<PaymentRecord>(
      "GET",
      "/api/v1/public/payments/cart-mandate/request",
      query,
      null,
    );
  }

  async getPaymentByFlowId(flowId: string): Promise<PaymentRecord> {
    return this.authedRequest<PaymentRecord>(
      "GET",
      `/api/v1/public/pay-mandate/${encodeURIComponent(flowId)}`,
      "",
      null,
    );
  }

  /** Unauthenticated; returns supported networks and tokens. */
  async getChainConfig(): Promise<HP2ChainConfig> {
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/payment/chain-config`, {
      cache: "no-store",
    });
    const parsed = (await res.json()) as HP2Envelope<HP2ChainConfig>;
    if (parsed.code !== 0) {
      throw new Error(`HP2 getChainConfig code=${parsed.code}: ${parsed.msg}`);
    }
    return parsed.data;
  }
}

// -----------------------------------------------------------------------
//                   Known supported tokens (for UI defaults)
// -----------------------------------------------------------------------

/**
 * Snapshot of the HashKey Chain Testnet USDC config from §6.6 of the spec.
 * Kept in code so the UI can default to it without a chain-config round-trip.
 * The runtime should still call `getChainConfig()` to verify before creating
 * mandates in production.
 */
export const HP2_HASHKEY_TESTNET_USDC: PaymentMethodData["data"] = {
  x402Version: 2,
  network: "hashkey-testnet",
  chain_id: 133,
  contract_address: "0x6cc9658baaaacffd7df6caf40f51c4f4378b8cdc",
  pay_to: "",
  coin: "USDC",
};
