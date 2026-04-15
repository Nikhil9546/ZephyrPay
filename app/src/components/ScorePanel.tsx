"use client";

import { useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { useMerchants } from "@/hooks/useZephyrPay";
import { addresses } from "@/lib/addresses";
import { creditLineAbi } from "@/lib/abi";
import type { MerchantProfile } from "@/lib/server/revenue";
import { formatAprBps, formatHkdCents } from "@/lib/format";
import { CustomBusinessForm, type ScorePayload } from "./CustomBusinessForm";

interface Props {
  fullyVerified: boolean;
  hasScore: boolean;
  onScored: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "scoring"; label: string }
  | { kind: "submitting" }
  | { kind: "confirming"; hash: Hex }
  | { kind: "done"; hash: Hex }
  | { kind: "error"; message: string };

type Mode = "demo" | "custom";

interface ScoreResult {
  tier: number;
  tierLabel: string;
  aprBps: number;
  maxLineCents: number;
  rationale: string;
}

export function ScorePanel({ fullyVerified, hasScore, onScored }: Props) {
  const { address } = useAccount();
  const { data, isLoading } = useMerchants();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [mode, setMode] = useState<Mode>("demo");
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (!fullyVerified) {
    return (
      <div className="card opacity-60">
        <div className="text-sm text-muted">Step 2 — complete verification first.</div>
      </div>
    );
  }

  /**
   * Shared on-chain submission path. Both the demo-merchant scorer and the
   * custom-form scorer converge here: the server has already produced an
   * EIP-712 signed Score attestation; this function commits it to the
   * CreditLine contract.
   */
  async function submitScoreAttestation(payload: ScorePayload, label: string) {
    if (!address || !walletClient || !publicClient) return;
    setResult(payload.score);
    try {
      setStatus({ kind: "submitting" });
      const hash = await walletClient.writeContract({
        address: addresses.creditLine,
        abi: creditLineAbi,
        functionName: "applyScore",
        args: [
          payload.attestation.borrower,
          payload.attestation.tier,
          BigInt(payload.attestation.maxLine),
          payload.attestation.aprBps,
          BigInt(payload.attestation.issuedAt),
          BigInt(payload.attestation.expiresAt),
          payload.attestation.nonce,
          payload.attestation.signature,
        ],
      });
      setStatus({ kind: "confirming", hash });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: "done", hash });
      onScored();
      void label;
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "unknown" });
    }
  }

  async function scoreDemoMerchant(merchant: MerchantProfile) {
    if (!address) return;
    setSelected(merchant.merchantId);
    setStatus({ kind: "scoring", label: merchant.businessName });
    setResult(null);
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "fixture",
          borrower: address,
          merchantProfileRef: merchant.merchantId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `score failed (${res.status})`);
      }
      const payload = (await res.json()) as ScorePayload;
      await submitScoreAttestation(payload, merchant.businessName);
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "unknown" });
    }
  }

  const busy =
    status.kind === "scoring" ||
    status.kind === "submitting" ||
    status.kind === "confirming";

  return (
    <div className="card space-y-5">
      <div>
        <div className="text-sm font-medium text-muted">Step 2</div>
        <h2 className="text-xl font-semibold">
          Score a business — demo merchant or your own
        </h2>
        <p className="mt-1 text-sm text-muted max-w-2xl">
          We extract features from the business, ask DeepSeek for a tier within our
          policy bands, clamp APR and max-line to hard limits, then sign an
          EIP-712 score attestation that you commit to the{" "}
          <code>CreditLine</code> contract.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-border bg-paper p-1">
        <ToggleBtn active={mode === "demo"} onClick={() => setMode("demo")}>
          Demo merchant
        </ToggleBtn>
        <ToggleBtn active={mode === "custom"} onClick={() => setMode("custom")}>
          Score my business
        </ToggleBtn>
      </div>

      {mode === "demo" ? (
        <>
          {isLoading && <div className="text-sm text-muted">Loading merchant profiles…</div>}

          <div className="grid gap-3 md:grid-cols-3">
            {data?.merchants?.map((m) => {
              const isActive = selected === m.merchantId;
              const latest = m.windows[m.windows.length - 1];
              return (
                <button
                  key={m.merchantId}
                  onClick={() => scoreDemoMerchant(m)}
                  disabled={busy}
                  className={`text-left rounded-lg border p-4 transition hover:border-ink disabled:opacity-60 disabled:cursor-not-allowed ${
                    isActive ? "border-ink bg-ink/[0.02]" : "border-border"
                  }`}
                >
                  <div className="text-xs font-mono text-muted">{m.merchantId}</div>
                  <div className="mt-1 font-semibold">{m.businessName}</div>
                  <div className="text-sm text-muted">{m.industry}</div>
                  <div className="mt-3 text-xs text-muted">
                    Last 30d rev · {formatHkdCents(latest.grossRevenueCents)} · {latest.transactionCount} orders
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <CustomBusinessForm
          borrower={address}
          submitting={busy}
          onScored={async (payload) => {
            await submitScoreAttestation(payload, "custom business");
          }}
        />
      )}

      {/* Shared status + result ------------------------------------------- */}

      {status.kind === "scoring" && (
        <div className="text-sm text-muted">Scoring {status.label}… (≈1-3s with DeepSeek)</div>
      )}
      {status.kind === "submitting" && (
        <div className="text-sm text-muted">Submitting signed score on-chain…</div>
      )}
      {status.kind === "confirming" && (
        <div className="text-xs font-mono text-muted">tx: {status.hash}</div>
      )}
      {status.kind === "error" && (
        <div className="text-sm text-danger">Failed: {status.message}</div>
      )}

      {result && hasScore && (status.kind === "done" || status.kind === "idle") && (
        <div className="rounded-lg border border-border bg-paper p-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs text-muted">Tier</div>
              <div className="text-3xl font-bold">{result.tierLabel}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Max line</div>
              <div className="text-xl font-semibold">{formatHkdCents(result.maxLineCents)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">APR</div>
              <div className="text-xl font-semibold">{formatAprBps(result.aprBps)}</div>
            </div>
          </div>
          <div className="mt-3 text-sm text-ink/80">{result.rationale}</div>
        </div>
      )}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm transition ${
        active ? "bg-ink text-paper font-medium" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
