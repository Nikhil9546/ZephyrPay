import { z } from "zod";

/**
 * Client-safe environment variables. Every field must be prefixed with
 * `NEXT_PUBLIC_` so Next.js inlines it into the browser bundle.
 *
 * Server-only secrets live in `env.server.ts`.
 */

const clientSchema = z.object({
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().positive(),
  NEXT_PUBLIC_HKDM_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  NEXT_PUBLIC_POH_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  NEXT_PUBLIC_CREDIT_LINE_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().min(1),
});

export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_HKDM_ADDRESS: process.env.NEXT_PUBLIC_HKDM_ADDRESS,
  NEXT_PUBLIC_POH_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_POH_REGISTRY_ADDRESS,
  NEXT_PUBLIC_CREDIT_LINE_ADDRESS: process.env.NEXT_PUBLIC_CREDIT_LINE_ADDRESS,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
});
