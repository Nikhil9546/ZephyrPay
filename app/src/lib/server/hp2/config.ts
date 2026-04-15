import "server-only";
import { z } from "zod";
import { HP2Client } from "./client";

/**
 * HP2 configuration is optional — the rest of ZephyrPay (verify, score, borrow)
 * works without it. If any HP2_* env var is missing we return `null` and the
 * /api/payments/* routes return 503 with a clear message.
 *
 * Once HashKey publishes the production API URL and the merchant registration
 * completes, set these vars and live payment flows activate automatically:
 *
 *   HP2_BASE_URL                = https://merchant-qa.hashkeymerchant.com
 *   HP2_APP_KEY                 = (from merchant dashboard)
 *   HP2_APP_SECRET              = (from merchant dashboard)
 *   HP2_MERCHANT_NAME           = "ZephyrPay" (or tenant-specific)
 *   HP2_MERCHANT_PRIVATE_KEY    = (PEM, multi-line; escape newlines as \n)
 *   HP2_PAY_TO                  = merchant receiving address for USDC
 *   HP2_WEBHOOK_APP_SECRET      = same as HP2_APP_SECRET (unless set separately)
 */

const hp2Schema = z.object({
  HP2_BASE_URL: z.string().url(),
  HP2_APP_KEY: z.string().min(1),
  HP2_APP_SECRET: z.string().min(1),
  HP2_MERCHANT_NAME: z.string().min(1),
  HP2_MERCHANT_PRIVATE_KEY: z.string().includes("-----BEGIN"),
  HP2_PAY_TO: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export type HP2EnvConfig = z.infer<typeof hp2Schema>;

let _client: HP2Client | null | undefined;

export function loadHP2Config(): HP2EnvConfig | null {
  const candidate = {
    HP2_BASE_URL: process.env.HP2_BASE_URL ?? "",
    HP2_APP_KEY: process.env.HP2_APP_KEY ?? "",
    HP2_APP_SECRET: process.env.HP2_APP_SECRET ?? "",
    HP2_MERCHANT_NAME: process.env.HP2_MERCHANT_NAME ?? "",
    HP2_MERCHANT_PRIVATE_KEY: (process.env.HP2_MERCHANT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    HP2_PAY_TO: process.env.HP2_PAY_TO ?? "",
  };
  const parsed = hp2Schema.safeParse(candidate);
  if (!parsed.success) return null;
  return parsed.data;
}

export function getHP2Client(): HP2Client | null {
  if (_client !== undefined) return _client;
  const cfg = loadHP2Config();
  if (!cfg) {
    _client = null;
    return null;
  }
  _client = HP2Client.fromEnv(cfg);
  return _client;
}

export function getHP2PayTo(): string | null {
  const cfg = loadHP2Config();
  return cfg?.HP2_PAY_TO ?? null;
}

export function hp2WebhookSecret(): string | null {
  const explicit = process.env.HP2_WEBHOOK_APP_SECRET;
  if (explicit && explicit.length > 0) return explicit;
  return loadHP2Config()?.HP2_APP_SECRET ?? null;
}
