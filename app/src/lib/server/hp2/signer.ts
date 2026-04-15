import "server-only";
import {
  createHmac,
  createPrivateKey,
  createSign,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";

/**
 * Cryptographic primitives used by the HashKey HP2 payment integration.
 *
 *   - HMAC-SHA256 for API request authentication (X-Signature header)
 *   - ES256K JWT for the `merchant_authorization` claim inside a Cart Mandate
 *   - Webhook signature verification (same HMAC-SHA256 but with a
 *     `t=<ts>,v1=<hex>` header format)
 *
 * All JWT signing uses the raw (r, s) JWS format per RFC 7515 §3.4 —
 * Node's `crypto.sign` returns DER-encoded ECDSA signatures, so we parse
 * and concatenate fixed-width r and s (32 bytes each for secp256k1).
 */

// ---------------------------------------------------------------------------
//                              HMAC (API auth)
// ---------------------------------------------------------------------------

/**
 * Build the signing string for HP2's `/api/v1/public/*` HMAC auth.
 * Spec (§3.2):
 *   message = METHOD\nPATH\nQUERY\nbodyHash\ntimestamp\nnonce
 */
export function buildApiSigningMessage(params: {
  method: string;
  path: string;
  query: string; // raw query string (without leading "?"), empty for none
  bodyHash: string; // hex(sha256(body)) or "" if no body
  timestamp: string; // unix seconds as decimal string
  nonce: string;
}): string {
  return [
    params.method.toUpperCase(),
    params.path,
    params.query,
    params.bodyHash,
    params.timestamp,
    params.nonce,
  ].join("\n");
}

export function hmacSha256Hex(key: string, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

/** Fresh unix-seconds timestamp + 24-byte hex nonce — unique per request. */
export function newStamp(): { timestamp: string; nonce: string } {
  return {
    timestamp: Math.floor(Date.now() / 1000).toString(),
    nonce: randomBytes(12).toString("hex"),
  };
}

// ---------------------------------------------------------------------------
//                        ES256K JWT (merchant_authorization)
// ---------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Parse a DER-encoded ECDSA signature into fixed-width r and s (32 bytes each
 * for secp256k1). Handles leading-zero and negative-sign-byte trimming that
 * the DER encoder inserts.
 */
function derToRawRS(der: Buffer, size: number): { r: Buffer; s: Buffer } {
  if (der[0] !== 0x30) throw new Error("invalid DER: not a sequence");
  let offset = 2;
  // If length >= 0x80 the spec uses the long form; for ECDSA sigs at 64 bytes
  // the total length always fits in a single byte, so no handling needed.
  if (der[offset] !== 0x02) throw new Error("invalid DER: expected INTEGER for r");
  const rLen = der[offset + 1];
  const rBytes = der.subarray(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  if (der[offset] !== 0x02) throw new Error("invalid DER: expected INTEGER for s");
  const sLen = der[offset + 1];
  const sBytes = der.subarray(offset + 2, offset + 2 + sLen);

  const pad = (b: Buffer): Buffer => {
    // Strip any leading 0x00 added to keep the INTEGER non-negative.
    let trimmed = b;
    while (trimmed.length > size && trimmed[0] === 0x00) trimmed = trimmed.subarray(1);
    if (trimmed.length > size) throw new Error("invalid DER: integer too large");
    if (trimmed.length === size) return trimmed;
    const padded = Buffer.alloc(size);
    trimmed.copy(padded, size - trimmed.length);
    return padded;
  };

  return { r: pad(rBytes), s: pad(sBytes) };
}

/** Load a PEM-encoded EC private key (PKCS8 or SEC1). Must be secp256k1. */
export function loadMerchantPrivateKey(pem: string): KeyObject {
  const key = createPrivateKey({ key: pem, format: "pem" });
  // Defensive check: some runtimes (older Node) report type "ec" but not curve.
  // We don't hard-reject here because OpenSSL-generated secp256k1 keys pass
  // asymmetricKeyType === "ec" without a curve field. If signing fails later
  // we surface a clear error then.
  if (key.asymmetricKeyType !== "ec") {
    throw new Error(`HP2 merchant key must be EC (secp256k1), got ${key.asymmetricKeyType}`);
  }
  return key;
}

/**
 * Sign an ES256K JWT (header.payload.signature). The signature is 64 raw bytes
 * — 32 bytes r + 32 bytes s — base64url-encoded, matching the JWS spec for
 * ES256K (RFC 8812).
 */
export function signJwtES256K(
  privateKey: KeyObject,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const h = { alg: "ES256K", typ: "JWT", ...header };
  const signingInput = `${base64url(JSON.stringify(h))}.${base64url(JSON.stringify(payload))}`;
  const der = createSign("sha256").update(signingInput, "utf8").sign(privateKey);
  const { r, s } = derToRawRS(der, 32);
  const sig = base64url(Buffer.concat([r, s]));
  return `${signingInput}.${sig}`;
}

// ---------------------------------------------------------------------------
//                        Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * HP2 webhook signature header format (§7.3):
 *   X-Signature: t=<unix_timestamp>,v1=<hmac_hex>
 *
 *   message = timestamp + "." + rawBody
 *   signature = hex(HMAC-SHA256(app_secret, message))
 *
 * Returns true iff:
 *   - the header parses
 *   - the timestamp is within ±5 minutes of now
 *   - the recomputed signature matches in constant time
 */
export function verifyWebhookSignature(params: {
  rawBody: string;
  header: string | null;
  appSecret: string;
  toleranceSeconds?: number;
}): boolean {
  const tolerance = params.toleranceSeconds ?? 300;
  if (!params.header) return false;

  let ts: number | null = null;
  let received: string | null = null;
  for (const part of params.header.split(",")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("t=")) ts = Number.parseInt(trimmed.slice(2), 10);
    else if (trimmed.startsWith("v1=")) received = trimmed.slice(3);
  }
  if (ts === null || received === null) return false;
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > tolerance) return false;

  const expected = hmacSha256Hex(params.appSecret, `${ts}.${params.rawBody}`);
  if (expected.length !== received.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
  } catch {
    return false;
  }
}
