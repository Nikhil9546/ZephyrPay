import { publicClient, readOutstandingDebt, sendOnSaleReceived } from "./chain.js";
import type { SaleQueue, QueuedWork } from "./queue.js";

export interface WorkerLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const defaultLogger: WorkerLogger = {
  info: (msg, meta) => console.log(`[worker] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[worker] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[worker] ${msg}`, meta ?? ""),
};

export interface WorkerConfig {
  pollIntervalMs: number;
  maxAttempts: number;
}

/**
 * Drains the SaleQueue and routes each item into CreditLine.onSaleReceived.
 *
 * Properties:
 *   - Idempotent: the queue's `seen` set dedupes by `(source, sourceId)`; the
 *     on-chain call itself is not strictly idempotent, so we rely on the queue.
 *   - No-op when debt is 0: contract reverts with `NoOutstandingDebt`; we
 *     detect that pre-call via `outstandingDebt()` and skip to avoid a bad tx.
 *   - Bounded retries: each work item retries with exponential backoff up to
 *     `maxAttempts`; after that it's dropped and logged as a dead letter.
 */
export class Worker {
  private stopped = false;

  constructor(
    private readonly queue: SaleQueue,
    private readonly cfg: WorkerConfig,
    private readonly log: WorkerLogger = defaultLogger,
  ) {}

  async run(): Promise<void> {
    this.log.info("worker started", { pollMs: this.cfg.pollIntervalMs });
    while (!this.stopped) {
      const work = this.queue.nextDue();
      if (!work) {
        await sleep(this.cfg.pollIntervalMs);
        continue;
      }
      await this.processOne(work);
    }
    this.log.info("worker stopped");
  }

  stop(): void {
    this.stopped = true;
  }

  private async processOne(work: QueuedWork): Promise<void> {
    const borrower = work.borrower;
    try {
      const outstanding = await readOutstandingDebt(borrower);
      if (outstanding === 0n) {
        this.log.info("borrower has no outstanding debt; skipping", {
          borrower,
          sourceId: work.sourceId,
        });
        this.queue.markCompleted(work);
        return;
      }

      const applyAmount = work.amount > outstanding ? outstanding : work.amount;
      const hash = await sendOnSaleReceived(borrower, applyAmount);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== "success") {
        throw new Error(`tx reverted: ${hash}`);
      }

      this.log.info("sale routed", {
        borrower,
        sourceId: work.sourceId,
        applied: applyAmount.toString(),
        txHash: hash,
        blockNumber: receipt.blockNumber.toString(),
      });
      this.queue.markCompleted(work);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (work.attempts + 1 >= this.cfg.maxAttempts) {
        this.log.error("dead letter — giving up", {
          borrower,
          sourceId: work.sourceId,
          attempts: work.attempts + 1,
          error: message,
        });
        this.queue.markCompleted(work);
        return;
      }
      this.log.warn("sale route failed; will retry", {
        borrower,
        sourceId: work.sourceId,
        attempts: work.attempts + 1,
        error: message,
      });
      this.queue.requeue(work);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
