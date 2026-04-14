import type { Address, Hex } from "viem";

/**
 * In-memory FIFO queue with per-merchant back-pressure.
 *
 * Production substitution: Redis (BullMQ / Cloudflare Queues) — same interface.
 * Kept in-process here so the relayer stays a single binary for the first
 * pilot; swapping to a durable queue is a one-file change.
 */
export interface SaleEvent {
  /** Provider-supplied idempotency key, e.g. Shopify's `order_id`. */
  sourceId: string;
  /** Provider name (shopify / stripe / tiktok_shop / ...). */
  source: string;
  /** Borrower wallet address (known because we onboarded them). */
  borrower: Address;
  /** Payment amount in HKDm base units (6 decimals). */
  amount: bigint;
  /** Unix seconds when the sale occurred upstream. */
  occurredAt: number;
  /** Raw provider payload hash (for audit). */
  payloadHash: Hex;
}

export interface QueuedWork extends SaleEvent {
  enqueuedAt: number;
  attempts: number;
  nextAttemptAt: number;
}

export class SaleQueue {
  private readonly items: QueuedWork[] = [];
  private readonly seen = new Set<string>();
  private readonly perMerchant = new Map<string, number>();

  constructor(private readonly maxPerMerchant: number) {}

  /** Returns true if enqueued, false if a duplicate or over-capacity. */
  enqueue(event: SaleEvent): { ok: boolean; reason?: string } {
    const key = `${event.source}:${event.sourceId}`;
    if (this.seen.has(key)) return { ok: false, reason: "duplicate" };

    const merchantKey = event.borrower.toLowerCase();
    const pending = this.perMerchant.get(merchantKey) ?? 0;
    if (pending >= this.maxPerMerchant) {
      return { ok: false, reason: "merchant backlog full" };
    }

    this.seen.add(key);
    this.perMerchant.set(merchantKey, pending + 1);
    this.items.push({
      ...event,
      enqueuedAt: Math.floor(Date.now() / 1000),
      attempts: 0,
      nextAttemptAt: Math.floor(Date.now() / 1000),
    });
    return { ok: true };
  }

  /** Returns the oldest item whose backoff window has elapsed. */
  nextDue(): QueuedWork | undefined {
    const now = Math.floor(Date.now() / 1000);
    const idx = this.items.findIndex((w) => w.nextAttemptAt <= now);
    if (idx < 0) return undefined;
    const [item] = this.items.splice(idx, 1);
    return item;
  }

  markCompleted(item: QueuedWork): void {
    const merchantKey = item.borrower.toLowerCase();
    const pending = this.perMerchant.get(merchantKey) ?? 1;
    if (pending <= 1) this.perMerchant.delete(merchantKey);
    else this.perMerchant.set(merchantKey, pending - 1);
  }

  /** Requeue with exponential backoff (2^attempts seconds, capped at 10 min). */
  requeue(item: QueuedWork): void {
    const attempts = item.attempts + 1;
    const delay = Math.min(600, 2 ** attempts);
    item.attempts = attempts;
    item.nextAttemptAt = Math.floor(Date.now() / 1000) + delay;
    this.items.push(item);
  }

  size(): number {
    return this.items.length;
  }

  pendingForMerchant(borrower: Address): number {
    return this.perMerchant.get(borrower.toLowerCase()) ?? 0;
  }
}
