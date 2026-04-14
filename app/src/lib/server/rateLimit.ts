import "server-only";
import { serverEnv } from "@/lib/env.server";

/**
 * Minimal in-memory fixed-window rate limiter with optional Upstash backing.
 * Keyed by caller (IP or wallet). Never exposes raw counts to the client.
 */

type Bucket = { count: number; resetAt: number };
const memory = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number };

async function upstashIncr(key: string, windowSec: number): Promise<number | null> {
  const url = serverEnv.UPSTASH_REDIS_REST_URL;
  const token = serverEnv.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const endpoint = `${url}/pipeline`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, String(windowSec), "NX"],
    ]),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Array<{ result: number | string }>;
  const incr = Number(body?.[0]?.result ?? 0);
  return Number.isFinite(incr) ? incr : null;
}

export async function rateLimit(
  key: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const remote = await upstashIncr(`zp:rl:${key}`, windowSec);
  if (remote !== null) {
    return {
      allowed: remote <= max,
      remaining: Math.max(0, max - remote),
      resetAt: Date.now() + windowSec * 1000,
    };
  }
  const now = Date.now();
  const existing = memory.get(key);
  if (!existing || existing.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: max - 1, resetAt: now + windowSec * 1000 };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= max,
    remaining: Math.max(0, max - existing.count),
    resetAt: existing.resetAt,
  };
}
