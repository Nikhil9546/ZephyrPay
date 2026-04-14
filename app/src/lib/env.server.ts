import "server-only";
import { z } from "zod";

/**
 * Server-only environment variables. Never import this file from a client
 * component — Next.js's `server-only` package makes the build fail loudly if
 * anything in a client bundle accidentally pulls it in.
 */

const serverSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY required"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  ATTESTOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "ATTESTOR_PRIVATE_KEY must be 0x + 64 hex"),
  SCORER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "SCORER_PRIVATE_KEY must be 0x + 64 hex"),
  UPSTASH_REDIS_REST_URL: z.string().url().optional().or(z.literal("")),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().or(z.literal("")),
});

export const serverEnv = serverSchema.parse({
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  ATTESTOR_PRIVATE_KEY: process.env.ATTESTOR_PRIVATE_KEY,
  SCORER_PRIVATE_KEY: process.env.SCORER_PRIVATE_KEY,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
});
