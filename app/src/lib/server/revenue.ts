import "server-only";
import { z } from "zod";

/**
 * Revenue-data abstraction.
 *
 * `RevenueAdapter` is the interface the scoring service consumes. The
 * `FixtureAdapter` implementation below returns deterministic, seeded merchant
 * records — treat it as test-fixture data, not placeholder data. It exists
 * because real Shopify / Stripe / WeChat Pay OAuth flows cannot be built and
 * approved inside a 12-hour hackathon window; a `ShopifyAdapter` / `StripeAdapter`
 * slotted in later satisfies the same contract, so the scoring service and the
 * rest of the protocol do not need to change.
 */

export const revenueWindowSchema = z.object({
  periodStart: z.number().int(),
  periodEnd: z.number().int(),
  currency: z.literal("HKD"),
  grossRevenueCents: z.number().int().nonnegative(),
  transactionCount: z.number().int().nonnegative(),
  refundRateBps: z.number().int().nonnegative().max(10_000),
  chargebackRateBps: z.number().int().nonnegative().max(10_000),
  averageTicketCents: z.number().int().nonnegative(),
  platform: z.enum(["shopify", "stripe", "wechat_pay", "tiktok_shop", "lazada", "fixture"]),
});
export type RevenueWindow = z.infer<typeof revenueWindowSchema>;

export const merchantProfileSchema = z.object({
  merchantId: z.string().min(1),
  businessName: z.string().min(1),
  countryCode: z.string().length(2),
  industry: z.string().min(1),
  monthsInBusiness: z.number().int().nonnegative(),
  windows: z.array(revenueWindowSchema).min(1),
});
export type MerchantProfile = z.infer<typeof merchantProfileSchema>;

export interface RevenueAdapter {
  readonly name: string;
  fetchProfile(merchantRef: string): Promise<MerchantProfile>;
}

// ---- Fixture adapter ------------------------------------------------------

const NOW = () => Math.floor(Date.now() / 1000);
const DAY = 86_400;

/**
 * Three seeded merchants with realistic, plausibly-noisy 90-day revenue
 * histories. Revenue numbers are in HKD cents (1 HKD = 100 cents).
 */
const FIXTURE_MERCHANTS: ReadonlyArray<MerchantProfile> = [
  {
    merchantId: "mer_kowloon_apparel",
    businessName: "Kowloon Stitch & Co.",
    countryCode: "HK",
    industry: "apparel-ecommerce",
    monthsInBusiness: 28,
    windows: (() => {
      const now = NOW();
      return [0, 30, 60].map((offset) => ({
        periodStart: now - (offset + 30) * DAY,
        periodEnd: now - offset * DAY,
        currency: "HKD" as const,
        platform: "shopify" as const,
        grossRevenueCents: [8_420_000, 7_980_000, 9_110_000][offset / 30],
        transactionCount: [312, 287, 344][offset / 30],
        refundRateBps: [180, 205, 160][offset / 30],
        chargebackRateBps: [20, 15, 22][offset / 30],
        averageTicketCents: [27_000, 27_800, 26_500][offset / 30],
      }));
    })(),
  },
  {
    merchantId: "mer_tst_freelancer",
    businessName: "Tsim Sha Tsui Designer (Freelance)",
    countryCode: "HK",
    industry: "professional-services",
    monthsInBusiness: 14,
    windows: (() => {
      const now = NOW();
      return [0, 30, 60].map((offset) => ({
        periodStart: now - (offset + 30) * DAY,
        periodEnd: now - offset * DAY,
        currency: "HKD" as const,
        platform: "stripe" as const,
        grossRevenueCents: [3_650_000, 4_100_000, 2_950_000][offset / 30],
        transactionCount: [18, 22, 14][offset / 30],
        refundRateBps: [50, 80, 100][offset / 30],
        chargebackRateBps: [0, 0, 0][offset / 30],
        averageTicketCents: [202_800, 186_400, 210_700][offset / 30],
      }));
    })(),
  },
  {
    merchantId: "mer_lazada_newbie",
    businessName: "Lantau Goods (Lazada)",
    countryCode: "HK",
    industry: "consumer-goods-marketplace",
    monthsInBusiness: 4,
    windows: (() => {
      const now = NOW();
      return [0, 30, 60].map((offset) => ({
        periodStart: now - (offset + 30) * DAY,
        periodEnd: now - offset * DAY,
        currency: "HKD" as const,
        platform: "lazada" as const,
        grossRevenueCents: [1_120_000, 820_000, 440_000][offset / 30],
        transactionCount: [72, 54, 31][offset / 30],
        refundRateBps: [520, 610, 780][offset / 30],
        chargebackRateBps: [110, 145, 180][offset / 30],
        averageTicketCents: [15_500, 15_200, 14_200][offset / 30],
      }));
    })(),
  },
];

export class FixtureAdapter implements RevenueAdapter {
  readonly name = "fixture";
  async fetchProfile(merchantRef: string): Promise<MerchantProfile> {
    const match = FIXTURE_MERCHANTS.find((m) => m.merchantId === merchantRef);
    if (!match) throw new Error(`Unknown fixture merchant: ${merchantRef}`);
    // Validate so a bad fixture fails loudly rather than silently.
    return merchantProfileSchema.parse(match);
  }
}

export const fixtureAdapter = new FixtureAdapter();

export const FIXTURE_MERCHANT_IDS = FIXTURE_MERCHANTS.map((m) => m.merchantId);

// ---- Custom-form → MerchantProfile transformer ---------------------------

import type { CustomBusinessForm } from "@/lib/merchant";

/**
 * Expand a single set of "typical monthly numbers" into a 3-window
 * `MerchantProfile` that the scoring pipeline can consume. Applies MoM growth
 * so the feature extractor sees a real trend instead of a flat line.
 */
export function profileFromCustomForm(
  borrower: string,
  form: CustomBusinessForm,
): MerchantProfile {
  const now = NOW();
  const avgRevenueCents = Math.round(form.avgMonthlyRevenueHKD * 100);
  const avgOrders = Math.max(1, Math.round(form.avgMonthlyOrders));
  const growth = form.monthlyGrowthPercent / 100;

  // Window 0 = oldest (60 days ago), window 2 = most recent.
  // If growth > 0, most recent month is highest; if < 0, it's lowest.
  const windows = [60, 30, 0].map((offset, idx) => {
    // Oldest month = base, each subsequent month grows by `growth` compounded.
    const monthsBack = 2 - idx; // 2, 1, 0
    const factor = Math.pow(1 + growth, -monthsBack);
    const rev = Math.max(100 * 100, Math.round(avgRevenueCents * factor));
    const orders = Math.max(1, Math.round(avgOrders * factor));
    const ticket = Math.max(100, Math.round(rev / orders));
    return {
      periodStart: now - (offset + 30) * DAY,
      periodEnd: now - offset * DAY,
      currency: "HKD" as const,
      platform: form.platform,
      grossRevenueCents: rev,
      transactionCount: orders,
      refundRateBps: Math.round(form.refundRatePercent * 100),
      chargebackRateBps: Math.round(form.chargebackRatePercent * 100),
      averageTicketCents: ticket,
    };
  });

  const profile: MerchantProfile = {
    merchantId: `custom_${borrower.toLowerCase().slice(2, 10)}`,
    businessName: form.businessName,
    countryCode: form.countryCode,
    industry: form.industry,
    monthsInBusiness: form.monthsInBusiness,
    windows,
  };

  // Validate so a malformed transform fails loudly rather than silently.
  return merchantProfileSchema.parse(profile);
}
