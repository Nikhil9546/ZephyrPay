import { z } from "zod";

/**
 * Client-safe merchant schemas.
 *
 * These are shared between the custom-input form, the API route, and the
 * server-side scoring pipeline. No `server-only` import so the form component
 * can validate on the client before POSTing.
 */

export const PLATFORM_OPTIONS = [
  "shopify",
  "stripe",
  "wechat_pay",
  "tiktok_shop",
  "lazada",
  "fixture",
] as const;
export type Platform = (typeof PLATFORM_OPTIONS)[number];

export const INDUSTRY_OPTIONS = [
  "apparel-ecommerce",
  "consumer-electronics",
  "food-and-beverage",
  "beauty-and-cosmetics",
  "home-and-furniture",
  "consumer-goods-marketplace",
  "professional-services",
  "digital-products",
  "education-and-coaching",
  "other",
] as const;
export type Industry = (typeof INDUSTRY_OPTIONS)[number];

export const COUNTRY_OPTIONS = [
  "HK",
  "SG",
  "MY",
  "TH",
  "VN",
  "ID",
  "PH",
  "TW",
  "JP",
  "KR",
] as const;
export type Country = (typeof COUNTRY_OPTIONS)[number];

/**
 * Simple form fields the merchant fills in. The API expands this into the
 * richer 3-window `MerchantProfile` expected by the scoring pipeline.
 */
export const customBusinessFormSchema = z.object({
  businessName: z.string().trim().min(2, "Business name ≥2 chars").max(80),
  countryCode: z.enum(COUNTRY_OPTIONS),
  industry: z.enum(INDUSTRY_OPTIONS),
  platform: z.enum(PLATFORM_OPTIONS).exclude(["fixture"]),
  monthsInBusiness: z.coerce
    .number()
    .int()
    .min(1, "Business must be ≥1 month old")
    .max(600),
  avgMonthlyRevenueHKD: z.coerce
    .number()
    .min(100, "At least HK$100/month")
    .max(50_000_000, "Above HK$50M/month — not the target tier"),
  avgMonthlyOrders: z.coerce.number().int().min(1).max(1_000_000),
  refundRatePercent: z.coerce.number().min(0).max(100),
  chargebackRatePercent: z.coerce.number().min(0).max(100),
  /** Optional: +X% MoM growth (or -X% decline). Used to synthesize 3 windows. */
  monthlyGrowthPercent: z.coerce.number().min(-50).max(200).default(0),
});
export type CustomBusinessForm = z.infer<typeof customBusinessFormSchema>;

/**
 * Default presets for each industry so the form starts with plausible numbers
 * instead of blank fields. The user is expected to overwrite them.
 */
export const INDUSTRY_DEFAULTS: Record<
  Industry,
  Partial<
    Pick<
      CustomBusinessForm,
      | "avgMonthlyRevenueHKD"
      | "avgMonthlyOrders"
      | "refundRatePercent"
      | "chargebackRatePercent"
      | "platform"
    >
  >
> = {
  "apparel-ecommerce": {
    avgMonthlyRevenueHKD: 80_000,
    avgMonthlyOrders: 300,
    refundRatePercent: 2.0,
    chargebackRatePercent: 0.2,
    platform: "shopify",
  },
  "consumer-electronics": {
    avgMonthlyRevenueHKD: 150_000,
    avgMonthlyOrders: 180,
    refundRatePercent: 4.0,
    chargebackRatePercent: 0.5,
    platform: "shopify",
  },
  "food-and-beverage": {
    avgMonthlyRevenueHKD: 60_000,
    avgMonthlyOrders: 900,
    refundRatePercent: 1.5,
    chargebackRatePercent: 0.1,
    platform: "wechat_pay",
  },
  "beauty-and-cosmetics": {
    avgMonthlyRevenueHKD: 55_000,
    avgMonthlyOrders: 420,
    refundRatePercent: 3.0,
    chargebackRatePercent: 0.3,
    platform: "shopify",
  },
  "home-and-furniture": {
    avgMonthlyRevenueHKD: 120_000,
    avgMonthlyOrders: 90,
    refundRatePercent: 3.5,
    chargebackRatePercent: 0.4,
    platform: "shopify",
  },
  "consumer-goods-marketplace": {
    avgMonthlyRevenueHKD: 35_000,
    avgMonthlyOrders: 500,
    refundRatePercent: 5.5,
    chargebackRatePercent: 1.0,
    platform: "lazada",
  },
  "professional-services": {
    avgMonthlyRevenueHKD: 40_000,
    avgMonthlyOrders: 18,
    refundRatePercent: 0.5,
    chargebackRatePercent: 0,
    platform: "stripe",
  },
  "digital-products": {
    avgMonthlyRevenueHKD: 30_000,
    avgMonthlyOrders: 250,
    refundRatePercent: 1.5,
    chargebackRatePercent: 0.5,
    platform: "stripe",
  },
  "education-and-coaching": {
    avgMonthlyRevenueHKD: 25_000,
    avgMonthlyOrders: 45,
    refundRatePercent: 1.0,
    chargebackRatePercent: 0.1,
    platform: "stripe",
  },
  other: {
    avgMonthlyRevenueHKD: 50_000,
    avgMonthlyOrders: 200,
    refundRatePercent: 2.0,
    chargebackRatePercent: 0.2,
    platform: "shopify",
  },
};
