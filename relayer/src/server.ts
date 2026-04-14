import Fastify from "fastify";
import { env } from "./env.js";
import { SaleQueue } from "./queue.js";
import { Worker } from "./worker.js";
import { registerWebhooks } from "./webhooks.js";
import { assertSettlementRole, account } from "./chain.js";

async function main() {
  console.log(`[relayer] starting as ${account.address}`);
  await assertSettlementRole();
  console.log(`[relayer] SETTLEMENT_ROLE verified on ${env.CREDIT_LINE_ADDRESS}`);

  const queue = new SaleQueue(env.MAX_PENDING_PER_MERCHANT);
  const worker = new Worker(queue, { pollIntervalMs: 1_500, maxAttempts: 6 });

  const app = Fastify({
    logger: { level: "info" },
    disableRequestLogging: false,
  });

  await app.register(registerWebhooks(queue));

  // Start worker alongside HTTP server.
  const workerPromise = worker.run();

  const shutdown = async () => {
    console.log("[relayer] shutting down");
    worker.stop();
    await app.close();
    await workerPromise;
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`[relayer] listening on :${env.PORT}`);
}

main().catch((err) => {
  console.error("[relayer] fatal", err);
  process.exit(1);
});
