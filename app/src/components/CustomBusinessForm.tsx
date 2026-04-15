"use client";

import { useMemo, useState } from "react";
import type { Hex } from "viem";
import {
  COUNTRY_OPTIONS,
  INDUSTRY_DEFAULTS,
  INDUSTRY_OPTIONS,
  PLATFORM_OPTIONS,
  customBusinessFormSchema,
  type CustomBusinessForm as FormData,
  type Industry,
} from "@/lib/merchant";
import { formatHkdCents } from "@/lib/format";

interface Props {
  borrower: `0x${string}` | undefined;
  /** Called after a successful score-and-sign. Consumer is responsible for the
   *  on-chain `applyScore(...)` write, same as the demo-merchant path. */
  onScored: (payload: ScorePayload) => Promise<void> | void;
  submitting: boolean;
}

export interface ScorePayload {
  score: {
    tier: 1 | 2 | 3 | 4 | 5;
    tierLabel: "A" | "B" | "C" | "D" | "E";
    aprBps: number;
    maxLineCents: number;
    rationale: string;
    features: Record<string, number | string>;
  };
  attestation: {
    borrower: `0x${string}`;
    tier: 1 | 2 | 3 | 4 | 5;
    maxLine: string;
    aprBps: number;
    issuedAt: string;
    expiresAt: string;
    nonce: Hex;
    signature: Hex;
  };
}

const INDUSTRY_LABELS: Record<Industry, string> = {
  "apparel-ecommerce": "Apparel / Fashion",
  "consumer-electronics": "Consumer Electronics",
  "food-and-beverage": "Food & Beverage",
  "beauty-and-cosmetics": "Beauty & Cosmetics",
  "home-and-furniture": "Home & Furniture",
  "consumer-goods-marketplace": "Consumer Goods (Marketplace)",
  "professional-services": "Professional Services / Freelance",
  "digital-products": "Digital Products / SaaS",
  "education-and-coaching": "Education & Coaching",
  other: "Other",
};

const DEFAULT_INDUSTRY: Industry = "apparel-ecommerce";

function defaultForm(industry: Industry): FormData {
  const preset = INDUSTRY_DEFAULTS[industry];
  return {
    businessName: "",
    countryCode: "HK",
    industry,
    platform: preset.platform ?? "shopify",
    monthsInBusiness: 12,
    avgMonthlyRevenueHKD: preset.avgMonthlyRevenueHKD ?? 50_000,
    avgMonthlyOrders: preset.avgMonthlyOrders ?? 200,
    refundRatePercent: preset.refundRatePercent ?? 2,
    chargebackRatePercent: preset.chargebackRatePercent ?? 0.2,
    monthlyGrowthPercent: 0,
  };
}

export function CustomBusinessForm({ borrower, onScored, submitting }: Props) {
  const [form, setForm] = useState<FormData>(defaultForm(DEFAULT_INDUSTRY));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isScoring, setIsScoring] = useState(false);

  const set = <K extends keyof FormData>(k: K, v: FormData[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    setFieldErrors((p) => {
      if (!p[k as string]) return p;
      const copy = { ...p };
      delete copy[k as string];
      return copy;
    });
  };

  // When industry changes, fill preset fields (only if user hasn't edited them).
  const changeIndustry = (industry: Industry) => {
    const preset = INDUSTRY_DEFAULTS[industry];
    setForm((p) => ({
      ...p,
      industry,
      avgMonthlyRevenueHKD: preset.avgMonthlyRevenueHKD ?? p.avgMonthlyRevenueHKD,
      avgMonthlyOrders: preset.avgMonthlyOrders ?? p.avgMonthlyOrders,
      refundRatePercent: preset.refundRatePercent ?? p.refundRatePercent,
      chargebackRatePercent: preset.chargebackRatePercent ?? p.chargebackRatePercent,
      platform: preset.platform ?? p.platform,
    }));
  };

  // Live preview of extracted monthly windows so users see what the AI sees.
  const preview = useMemo(() => {
    const g = form.monthlyGrowthPercent / 100;
    return [2, 1, 0].map((monthsBack) => {
      const factor = Math.pow(1 + g, -monthsBack);
      const rev = Math.round(form.avgMonthlyRevenueHKD * factor);
      const orders = Math.max(1, Math.round(form.avgMonthlyOrders * factor));
      return { rev, orders, monthsBack };
    });
  }, [form.avgMonthlyRevenueHKD, form.avgMonthlyOrders, form.monthlyGrowthPercent]);

  async function submit() {
    setApiError(null);
    setFieldErrors({});

    const parsed = customBusinessFormSchema.safeParse(form);
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      const errs: Record<string, string> = {};
      for (const [k, v] of Object.entries(flat)) {
        if (v && v[0]) errs[k] = v[0];
      }
      setFieldErrors(errs);
      return;
    }

    if (!borrower) {
      setApiError("Connect a wallet first.");
      return;
    }

    setIsScoring(true);
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "custom",
          borrower,
          customForm: parsed.data,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `score failed (${res.status})`);
      }
      const payload = (await res.json()) as ScorePayload;
      await onScored(payload);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setIsScoring(false);
    }
  }

  const disabled = isScoring || submitting || !borrower;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Business name" error={fieldErrors.businessName}>
          <input
            type="text"
            className="input"
            placeholder="e.g. Maya Leather Works"
            value={form.businessName}
            onChange={(e) => set("businessName", e.target.value)}
          />
        </Field>

        <Field label="Country" error={fieldErrors.countryCode}>
          <select
            className="input"
            value={form.countryCode}
            onChange={(e) => set("countryCode", e.target.value as FormData["countryCode"])}
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Industry" error={fieldErrors.industry}>
          <select
            className="input"
            value={form.industry}
            onChange={(e) => changeIndustry(e.target.value as Industry)}
          >
            {INDUSTRY_OPTIONS.map((i) => (
              <option key={i} value={i}>
                {INDUSTRY_LABELS[i]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Platform" error={fieldErrors.platform}>
          <select
            className="input"
            value={form.platform}
            onChange={(e) => set("platform", e.target.value as FormData["platform"])}
          >
            {PLATFORM_OPTIONS.filter((p) => p !== "fixture").map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Months in business" error={fieldErrors.monthsInBusiness}>
          <input
            type="number"
            min={1}
            className="input"
            value={form.monthsInBusiness}
            onChange={(e) => set("monthsInBusiness", Number(e.target.value))}
          />
        </Field>

        <Field
          label="Month-over-month growth %"
          hint="0 = flat · -5 = shrinking 5%/mo · +10 = growing 10%/mo"
          error={fieldErrors.monthlyGrowthPercent}
        >
          <input
            type="number"
            step="0.1"
            className="input"
            value={form.monthlyGrowthPercent}
            onChange={(e) => set("monthlyGrowthPercent", Number(e.target.value))}
          />
        </Field>
      </div>

      <hr className="border-border" />

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Avg monthly revenue (HK$)" error={fieldErrors.avgMonthlyRevenueHKD}>
          <input
            type="number"
            className="input"
            value={form.avgMonthlyRevenueHKD}
            onChange={(e) => set("avgMonthlyRevenueHKD", Number(e.target.value))}
          />
        </Field>

        <Field label="Avg monthly orders" error={fieldErrors.avgMonthlyOrders}>
          <input
            type="number"
            className="input"
            value={form.avgMonthlyOrders}
            onChange={(e) => set("avgMonthlyOrders", Number(e.target.value))}
          />
        </Field>

        <Field label="Refund rate (%)" error={fieldErrors.refundRatePercent}>
          <input
            type="number"
            step="0.1"
            className="input"
            value={form.refundRatePercent}
            onChange={(e) => set("refundRatePercent", Number(e.target.value))}
          />
        </Field>

        <Field label="Chargeback rate (%)" error={fieldErrors.chargebackRatePercent}>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.chargebackRatePercent}
            onChange={(e) => set("chargebackRatePercent", Number(e.target.value))}
          />
        </Field>
      </div>

      {/* Live preview: shows the 3 monthly windows the AI will see */}
      <div className="rounded-lg border border-border bg-paper p-4">
        <div className="text-xs text-muted uppercase tracking-wide font-semibold">
          The AI will see these three months
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          {preview.map((w, i) => (
            <div key={i} className="rounded-md border border-border bg-card p-3">
              <div className="text-xs text-muted">
                {w.monthsBack === 0 ? "Last 30 days" : `${w.monthsBack + 1} months ago`}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold">
                {formatHkdCents(w.rev * 100)}
              </div>
              <div className="text-xs text-muted">{w.orders} orders</div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={submit} disabled={disabled} className="btn-accent">
        {isScoring ? "Scoring with AI…" : "Score my business"}
      </button>

      {apiError && (
        <div className="text-sm text-danger">Failed: {apiError}</div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && !error && (
        <span className="text-[11px] text-muted mt-1 block">{hint}</span>
      )}
      {error && (
        <span className="text-[11px] text-danger mt-1 block">{error}</span>
      )}
    </label>
  );
}
