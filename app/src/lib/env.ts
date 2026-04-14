import { z } from "zod";

const serverSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY required"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  ATTESTOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "ATTESTOR_PRIVATE_KEY must be 0x + 64 hex"),
  SCORER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "SCORER_PRIVATE_KEY must be 0x + 64 hex"),
  UPSTASH_REDIS_REST_URL: z.string().url().optional().or(z.literal("")),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().or(z.literal("")),
});

const clientSchema = z.object({
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().positive(),
  NEXT_PUBLIC_HKDM_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  NEXT_PUBLIC_POH_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  NEXT_PUBLIC_CREDIT_LINE_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().min(1),
});

/**
 * Server-side env. Only accessed from server code (route handlers, server actions).
 * Throws loudly at boot if misconfigured.
 */
export const serverEnv = (() => {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv accessed from client bundle");
  }
  return serverSchema.parse({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    ATTESTOR_PRIVATE_KEY: process.env.ATTESTOR_PRIVATE_KEY,
    SCORER_PRIVATE_KEY: process.env.SCORER_PRIVATE_KEY,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
})();

/** Client-safe env. NEXT_PUBLIC_ prefix keeps it reachable in the browser bundle. */
export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_HKDM_ADDRESS: process.env.NEXT_PUBLIC_HKDM_ADDRESS,
  NEXT_PUBLIC_POH_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_POH_REGISTRY_ADDRESS,
  NEXT_PUBLIC_CREDIT_LINE_ADDRESS: process.env.NEXT_PUBLIC_CREDIT_LINE_ADDRESS,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
});
