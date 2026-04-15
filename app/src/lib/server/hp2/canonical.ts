import "server-only";
import { createHash } from "node:crypto";

/**
 * Canonical JSON serialization per the HP2 Cart Mandate spec (Section 9.2):
 *
 *   1. Recursively sort object keys in ascending alphabetical order
 *   2. Compact format — no whitespace, no line breaks
 *   3. Unchanged arrays (preserve order; order carries semantic meaning,
 *      e.g. display_items)
 *
 * The result is a deterministic byte sequence so that the SHA-256 hash in the
 * merchant_authorization JWT's `cart_hash` claim can be re-computed by HP2's
 * verifier and match exactly what the merchant signed.
 *
 * Scope note: HP2 examples only use strings and whole-number amounts
 * ("10.00" as a string, not 10.0 as a float). We therefore don't have to
 * wrestle with the full RFC 8785 number canonicalization rules — JSON.stringify's
 * default handling of our inputs is sufficient. If HP2 ever accepts floats,
 * swap in a full RFC 8785 implementation here.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number cannot be canonicalized");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map((k) => {
      const v = (value as Record<string, unknown>)[k];
      return `${JSON.stringify(k)}:${canonicalize(v)}`;
    });
    return `{${parts.join(",")}}`;
  }
  throw new Error(`unsupported canonicalize type: ${typeof value}`);
}

/**
 * SHA-256 of the canonical JSON, returned as lowercase hex (64 chars).
 * Used for the JWT `cart_hash` claim.
 */
export function canonicalHashHex(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
