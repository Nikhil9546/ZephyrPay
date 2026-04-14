import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { isAddress, keccak256, toBytes } from "viem";
import type { Address } from "viem";
import { env } from "./env.js";
import type { SaleQueue } from "./queue.js";

/**
 * Generic sale webhook. Any upstream merchant gateway (Shopify, Stripe,
 * TikTok Shop) posts to `/webhooks/sale` with an HMAC-SHA256 over the raw
 * body in the `x-zephyrpay-signature` header. The relayer verifies the
 * signature, parses into a canonical SaleEvent, and queues.
 *
 * A dedicated per-provider webhook adapter can be added later to translate
 * Shopify/Stripe/etc. payloads into this schema before hitting this endpoint;
 * for v1 the merchant gateway is responsible for producing this shape.
 */

const saleSchema = z.object({
  source: z.enum(["shopify", "stripe", "tiktok_shop", "lazada", "wechat_pay", "manual"]),
  sourceId: z.string().min(1).max(128),
  borrower: z.string().refine(isAddress, "borrower must be 0x-address"),
  amountCents: z.number().int().positive(),
  occurredAt: z.number().int().positive(),
});

function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", env.WEBHOOK_SECRET).update(rawBody).digest("hex");
  const given = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  if (expected.length !== given.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
  } catch {
    return false;
  }
}

export const registerWebhooks = (queue: SaleQueue): FastifyPluginAsync =>
  async (app) => {
    // Fastify needs access to the raw body for HMAC verification.
    app.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => {
        try {
          done(null, { raw: body as string, json: JSON.parse(body as string) });
        } catch (e) {
          done(e as Error, undefined);
        }
      },
    );

    app.post("/webhooks/sale", async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = req.body as { raw: string; json: unknown };
      const sig = req.headers["x-zephyrpay-signature"] as string | undefined;
      if (!verifySignature(parsed.raw, sig)) {
        return reply.code(401).send({ error: "invalid signature" });
      }

      const result = saleSchema.safeParse(parsed.json);
      if (!result.success) {
        return reply.code(400).send({ error: "invalid payload", issues: result.error.flatten() });
      }

      if (result.data.amountCents < env.MIN_SALE_AMOUNT_CENTS) {
        return reply.code(200).send({ enqueued: false, reason: "below min amount" });
      }

      // HKDm uses 6 decimals; cents → base units is × 10,000.
      const amount = BigInt(result.data.amountCents) * 10_000n;
      const payloadHash = keccak256(toBytes(parsed.raw));

      const { ok, reason } = queue.enqueue({
        source: result.data.source,
        sourceId: result.data.sourceId,
        borrower: result.data.borrower as Address,
        amount,
        occurredAt: result.data.occurredAt,
        payloadHash,
      });
      if (!ok) return reply.code(202).send({ enqueued: false, reason });
      return reply.code(202).send({ enqueued: true });
    });

    app.get("/health", async (_req, reply) => {
      return reply.send({
        status: "ok",
        queueSize: queue.size(),
      });
    });
  };
