import { z } from "zod";

const schema = z.object({
  RELAYER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "RELAYER_PRIVATE_KEY must be 0x + 64 hex"),
  CREDIT_LINE_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  HKDM_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  WEBHOOK_SECRET: z.string().min(16, "WEBHOOK_SECRET must be ≥16 chars"),
  PORT: z.coerce.number().int().default(8787),
  MIN_SALE_AMOUNT_CENTS: z.coerce.number().int().nonnegative().default(100),
  MAX_PENDING_PER_MERCHANT: z.coerce.number().int().positive().default(50),
});

export const env = schema.parse({
  RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY,
  CREDIT_LINE_ADDRESS: process.env.CREDIT_LINE_ADDRESS,
  HKDM_ADDRESS: process.env.HKDM_ADDRESS,
  RPC_URL: process.env.RPC_URL,
  CHAIN_ID: process.env.CHAIN_ID,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  PORT: process.env.PORT,
  MIN_SALE_AMOUNT_CENTS: process.env.MIN_SALE_AMOUNT_CENTS,
  MAX_PENDING_PER_MERCHANT: process.env.MAX_PENDING_PER_MERCHANT,
});
