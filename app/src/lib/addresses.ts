import type { Address } from "viem";
import { clientEnv } from "./env";

export const addresses = {
  hkdm: clientEnv.NEXT_PUBLIC_HKDM_ADDRESS as Address,
  poh: clientEnv.NEXT_PUBLIC_POH_REGISTRY_ADDRESS as Address,
  creditLine: clientEnv.NEXT_PUBLIC_CREDIT_LINE_ADDRESS as Address,
} as const;
