import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { serverEnv } from "@/lib/env.server";
import type { MerchantProfile } from "./revenue";
import { customBusinessFormSchema } from "@/lib/merchant";

/**
 * AI credit-scoring engine.
 *
 * Methodology (documented so judges and auditors can interrogate it):
 *   1. Feature extraction — we compute a deterministic feature vector from the
 *      merchant profile (monthly revenue trend, refund & chargeback rates,
 *      platform mix, months in business, on-chain wallet features).
 *   2. LLM rationale + categorical tier — we ask DeepSeek-Chat (V3) to assign
 *      an A–E tier and an APR within policy bounds, with a short rationale.
 *      The LLM is *not* trusted with the numeric output; we clamp and validate
 *      every value with zod + business-rule guards.
 *   3. Deterministic pricing — tier drives base APR and max-line multiples.
 *      The LLM APR is clamped to the tier-implied band; tier is the primary
 *      risk signal, not the APR number.
 *
 * This mirrors the approach of Spectral (MACRO) / RociFi (NFCS) — tier is the
 * stable primitive, premium is derived. See README for references.
 *
 * The provider is reachable via the official OpenAI SDK pointed at DeepSeek's
 * OpenAI-compatible base URL — swapping providers (DeepSeek → OpenAI →
 * Together → Groq → vLLM) is a one-line `baseURL` change with no contract or
 * downstream-route changes.
 */

type Tier = 1 | 2 | 3 | 4 | 5;

const TIER_POLICY: Record<Tier, { minAprBps: number; maxAprBps: number; maxLineMultiple: number }> =
  {
    1: { minAprBps: 600, maxAprBps: 1_000, maxLineMultiple: 0.6 }, // A — 6-10%, up to 60% of monthly rev
    2: { minAprBps: 900, maxAprBps: 1_400, maxLineMultiple: 0.45 }, // B
    3: { minAprBps: 1_300, maxAprBps: 2_000, maxLineMultiple: 0.3 }, // C
    4: { minAprBps: 1_900, maxAprBps: 2_800, maxLineMultiple: 0.18 }, // D
    5: { minAprBps: 2_700, maxAprBps: 4_000, maxLineMultiple: 0.08 }, // E
  };

const GLOBAL_APR_CEILING_BPS = 5_000; // matches CreditLine.MAX_APR_BPS
const LINE_ABSOLUTE_CAP_CENTS = 50_000 * 100; // HK$50,000 hard ceiling per borrower
const LINE_FLOOR_CENTS = 0;

const onChainFeaturesSchema = z
  .object({
    walletAgeDays: z.number().int().nonnegative(),
    txCount90d: z.number().int().nonnegative(),
    uniqueCounterparties90d: z.number().int().nonnegative(),
    stablecoinInflow90dCents: z.number().int().nonnegative(),
  })
  .optional();

/**
 * The scoring API accepts two profile sources, discriminated by `source`:
 *   - "fixture" : a reference to a seeded merchant (demo flow)
 *   - "custom"  : an inline form submitted by the user
 *
 * Both paths converge on the same scoring pipeline — only the profile-
 * construction step differs.
 */
export const scoringRequestSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("fixture"),
    borrower: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    merchantProfileRef: z.string().min(1),
    onChainFeatures: onChainFeaturesSchema,
  }),
  z.object({
    source: z.literal("custom"),
    borrower: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    customForm: customBusinessFormSchema,
    onChainFeatures: onChainFeaturesSchema,
  }),
]);
export type ScoringRequest = z.infer<typeof scoringRequestSchema>;

export const scoringResultSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  tierLabel: z.enum(["A", "B", "C", "D", "E"]),
  aprBps: z.number().int().min(0).max(GLOBAL_APR_CEILING_BPS),
  maxLineCents: z.number().int().min(LINE_FLOOR_CENTS).max(LINE_ABSOLUTE_CAP_CENTS),
  rationale: z.string().min(10).max(1200),
  features: z.record(z.string(), z.union([z.number(), z.string()])),
  methodologyVersion: z.string(),
});
export type ScoringResult = z.infer<typeof scoringResultSchema>;

const METHODOLOGY_VERSION = "zephyrpay.score.v1-2026.04";

// -------- feature extraction (deterministic, no LLM) ----------------------

interface Features {
  avgMonthlyRevenueCents: number;
  revenueStdDevCents: number;
  revenueTrendPctMoM: number;
  refundRateBps: number;
  chargebackRateBps: number;
  monthsInBusiness: number;
  platformRiskScore: number;
  onChainScore: number;
}

type OnChainFeatures = z.infer<typeof onChainFeaturesSchema>;

function extractFeatures(
  profile: MerchantProfile,
  onChain: OnChainFeatures,
): Features {
  const windows = [...profile.windows].sort((a, b) => a.periodStart - b.periodStart);
  const revs = windows.map((w) => w.grossRevenueCents);
  const avg = revs.reduce((a, b) => a + b, 0) / revs.length;
  const variance = revs.reduce((s, r) => s + (r - avg) ** 2, 0) / revs.length;
  const stddev = Math.sqrt(variance);
  const trend =
    revs.length >= 2
      ? ((revs[revs.length - 1] - revs[0]) / Math.max(1, revs[0])) * 100
      : 0;
  const refund = windows.reduce((s, w) => s + w.refundRateBps * w.grossRevenueCents, 0) /
    Math.max(1, revs.reduce((a, b) => a + b, 0));
  const chargeback = windows.reduce(
    (s, w) => s + w.chargebackRateBps * w.grossRevenueCents,
    0,
  ) / Math.max(1, revs.reduce((a, b) => a + b, 0));

  // Platform risk: marketplaces with high return rates are riskier than direct Shopify/Stripe.
  const platformRisk: Record<string, number> = {
    shopify: 1.0,
    stripe: 1.0,
    wechat_pay: 1.1,
    tiktok_shop: 1.3,
    lazada: 1.4,
    fixture: 1.0,
  };
  const platformRiskScore =
    windows.reduce((s, w) => s + (platformRisk[w.platform] ?? 1.2), 0) / windows.length;

  // On-chain features — newer wallets and thin tx counts are weaker signals.
  let onChainScore = 0.5;
  if (onChain) {
    const ageScore = Math.min(1, onChain.walletAgeDays / 365);
    const activityScore = Math.min(1, onChain.txCount90d / 100);
    const counterpartyScore = Math.min(1, onChain.uniqueCounterparties90d / 30);
    const inflowScore = Math.min(1, onChain.stablecoinInflow90dCents / 10_000_00);
    onChainScore = 0.25 * ageScore + 0.25 * activityScore + 0.2 * counterpartyScore + 0.3 * inflowScore;
  }

  return {
    avgMonthlyRevenueCents: Math.round(avg),
    revenueStdDevCents: Math.round(stddev),
    revenueTrendPctMoM: Number(trend.toFixed(2)),
    refundRateBps: Math.round(refund),
    chargebackRateBps: Math.round(chargeback),
    monthsInBusiness: profile.monthsInBusiness,
    platformRiskScore: Number(platformRiskScore.toFixed(2)),
    onChainScore: Number(onChainScore.toFixed(3)),
  };
}

// -------- prompt -----------------------------------------------------------

const SYSTEM_PROMPT = `You are ZephyrPay's credit-scoring oracle for Hong Kong and Southeast Asian SME merchants.

Your output MUST be strictly valid JSON matching this schema:
{
  "tier": 1 | 2 | 3 | 4 | 5,
  "tierLabel": "A" | "B" | "C" | "D" | "E",
  "aprBps": integer (0..5000),
  "maxLineCents": integer (0..5000000),
  "rationale": string (2-4 sentences, plain English, cite the features you weighted)
}

TIER RUBRIC:
- A (1): >=18 months in business, stable revenue, refund<3%, chargeback<0.3%, strong on-chain footprint.
- B (2): >=12 months, slight volatility, refund<5%, chargeback<0.5%.
- C (3): >=6 months or moderate volatility; refund<8%; chargeback<1%.
- D (4): <6 months OR high volatility OR refund<12% OR chargeback<2%.
- E (5): very young business, declining revenue, refund>12%, or chargeback>2%.

APR BANDS (bps — you MUST stay in the band for the tier you pick):
  A: 600-1000, B: 900-1400, C: 1300-2000, D: 1900-2800, E: 2700-4000.

MAX LINE (HKD cents): tier-specific multiple of avgMonthlyRevenueCents:
  A 60%, B 45%, C 30%, D 18%, E 8%. Hard absolute cap HK$50,000 (5,000,000 cents).

Be conservative. If the data is ambiguous, assign a lower tier and cite the reason.
Never output markdown, prose, or code fences — only the JSON object.`;

// -------- LLM call (DeepSeek via OpenAI-compatible API) -------------------

const llm = new OpenAI({
  apiKey: serverEnv.DEEPSEEK_API_KEY,
  baseURL: serverEnv.DEEPSEEK_BASE_URL,
});

const llmOutputSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  tierLabel: z.enum(["A", "B", "C", "D", "E"]),
  aprBps: z.number().int().min(0).max(GLOBAL_APR_CEILING_BPS),
  maxLineCents: z.number().int().min(0).max(LINE_ABSOLUTE_CAP_CENTS),
  rationale: z.string().min(10).max(1200),
});

export async function scoreMerchant(
  profile: MerchantProfile,
  borrower: string,
  onChain: OnChainFeatures,
): Promise<ScoringResult> {
  const features = extractFeatures(profile, onChain);

  const userPayload = {
    borrower,
    profile: {
      businessName: profile.businessName,
      country: profile.countryCode,
      industry: profile.industry,
      monthsInBusiness: profile.monthsInBusiness,
      platformMix: Array.from(new Set(profile.windows.map((w) => w.platform))),
    },
    extractedFeatures: features,
    onChainFeatures: onChain ?? null,
  };

  // DeepSeek's `deepseek-chat` (V3) supports OpenAI-style JSON mode.
  // `response_format: { type: "json_object" }` constrains the output to a
  // single valid JSON object — eliminates fence-stripping and most parser
  // failures. DeepSeek also requires the prompt to mention "json" when JSON
  // mode is enabled (handled in SYSTEM_PROMPT).
  const resp = await llm.chat.completions.create({
    model: serverEnv.DEEPSEEK_MODEL,
    max_tokens: 700,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Score this merchant. Respond with JSON only.\n\n${JSON.stringify(userPayload, null, 2)}`,
      },
    ],
  });

  const text = resp.choices[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("Scorer returned empty content");
  }

  // Even with JSON mode, defend against the rare ``` wrapping.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new Error(`Scorer returned non-JSON output: ${text.slice(0, 200)}`);
  }

  const llmOut = llmOutputSchema.parse(parsedJson);

  // --- Enforce business rules regardless of what the LLM said ---
  const tier = llmOut.tier as Tier;
  const policy = TIER_POLICY[tier];

  const clampedApr = Math.min(
    policy.maxAprBps,
    Math.max(policy.minAprBps, llmOut.aprBps),
  );
  const tierLineCap = Math.floor(features.avgMonthlyRevenueCents * policy.maxLineMultiple);
  const clampedLine = Math.min(LINE_ABSOLUTE_CAP_CENTS, Math.min(llmOut.maxLineCents, tierLineCap));

  const result: ScoringResult = {
    tier,
    tierLabel: llmOut.tierLabel,
    aprBps: clampedApr,
    maxLineCents: Math.max(LINE_FLOOR_CENTS, clampedLine),
    rationale: llmOut.rationale,
    features: features as unknown as Record<string, number | string>,
    methodologyVersion: METHODOLOGY_VERSION,
  };

  return scoringResultSchema.parse(result);
}
