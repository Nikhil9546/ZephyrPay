import "server-only";

/**
 * In-memory map of `cart_mandate_id → { borrower, amount, autoRepay }`.
 *
 * The webhook handler needs to know which ZephyrPay borrower a given HP2
 * payment belongs to. The cart_mandate_id alone only encodes an 8-hex-char
 * prefix of the borrower address (for fast debugging), which is not
 * sufficient for production. This in-memory map is populated at creation
 * time and looked up at webhook time.
 *
 * Production substitution: Redis or Postgres, keyed by cart_mandate_id.
 * A swap is trivial because the surface is just `remember` / `lookup`.
 */

type Record = {
  borrower: `0x${string}`;
  amountUsd: string;
  autoRepayFromCreditLine: boolean;
  createdAt: number;
};

const TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (2h cart_expiry + 2h buffer)

// Persist on globalThis so the map survives Next.js dev-mode HMR reloads
// (each route handler can otherwise get its own module instance). In
// production this is a no-op (no HMR) and identical to a plain Map.
declare global {
  // eslint-disable-next-line no-var
  var __zp_hp2_store: Map<string, Record> | undefined;
}
const store: Map<string, Record> =
  globalThis.__zp_hp2_store ?? (globalThis.__zp_hp2_store = new Map());

function prune() {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}

export function rememberCartMandate(cartMandateId: string, record: Omit<Record, "createdAt">): void {
  prune();
  store.set(cartMandateId, { ...record, createdAt: Date.now() });
}

export function lookupCartMandate(cartMandateId: string): Record | undefined {
  prune();
  return store.get(cartMandateId);
}

export function storeSize(): number {
  return store.size;
}
