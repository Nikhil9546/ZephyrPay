"use client";

import { useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { useMerchants } from "@/hooks/useZephyrPay";
import { addresses } from "@/lib/addresses";
import { creditLineAbi } from "@/lib/abi";
import type { MerchantProfile } from "@/lib/server/revenue";
import { formatAprBps, formatHkdCents } from "@/lib/format";
import { toast } from "sonner";

interface Props {
  fullyVerified: boolean;
  hasScore: boolean;
  onScored: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "scoring"; merchantId: string }
  | { kind: "submitting" }
  | { kind: "confirming"; hash: Hex }
  | { kind: "done"; hash: Hex }
  | { kind: "error"; message: string };

export function ScorePanel({ fullyVerified, hasScore, onScored }: Props) {
  const { address } = useAccount();
  const { data, isLoading } = useMerchants();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<null | {
    tier: number;
    tierLabel: string;
    aprBps: number;
    maxLineCents: number;
    rationale: string;
  }>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (!fullyVerified) {
    return (
      <div className="card opacity-60">
        <div className="text-sm text-muted">Step 2 — complete verification first.</div>
      </div>
    );
  }

  async function scoreAndApply(merchant: MerchantProfile) {
    if (!address || !walletClient || !publicClient) return;
    setSelected(merchant.merchantId);
    setStatus({ kind: "scoring", merchantId: merchant.merchantId });
    setResult(null);
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrower: address,
          merchantProfileRef: merchant.merchantId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `score failed (${res.status})`);
      }
      const payload = (await res.json()) as {
        score: {
          tier: number;
          tierLabel: string;
          aprBps: number;
          maxLineCents: number;
          rationale: string;
        };
        attestation: {
          borrower: Hex;
          tier: number;
          maxLine: string;
          aprBps: number;
          issuedAt: string;
          expiresAt: string;
          nonce: Hex;
          signature: Hex;
        };
      };
      setResult(payload.score);

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      if (msg.includes("User rejected") || msg.includes("User denied")) {
        toast.info("User cancelled the request");
        setStatus({ kind: "idle" });
      } else {
        toast.error("Transaction failed. Please try again.");
        setStatus({ kind: "idle" });
      }
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <div className="text-sm font-medium text-muted">Step 2</div>
        <h2 className="text-xl font-semibold">Connect a revenue stream, get an AI score</h2>
        <p className="mt-1 text-sm text-muted max-w-2xl">
          Pick a merchant profile — we compute features, ask Claude Sonnet 4.6 for a tier
          within our policy bands, clamp APR/line to business rules, then sign an EIP-712
          score attestation that you commit to the <code>CreditLine</code> contract.
        </p>
      </div>

      {isLoading && <div className="text-sm text-muted">Loading merchant profiles…</div>}

      <div className="grid gap-3 md:grid-cols-3">
        {data?.merchants?.map((m) => {
          const isActive = selected === m.merchantId;
          const latest = m.windows[m.windows.length - 1];
          return (
            <button
              key={m.merchantId}
              onClick={() => scoreAndApply(m)}
              disabled={status.kind === "scoring" || status.kind === "submitting"}
              className={`text-left rounded-lg border p-4 transition hover:border-ink ${
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

      {status.kind === "scoring" && (
        <div className="text-sm text-muted">Scoring {status.merchantId}… (≈5s)</div>
      )}
      {status.kind === "submitting" && (
        <div className="text-sm text-muted">Submitting signed score on-chain…</div>
      )}
      {status.kind === "confirming" && (
        <div className="text-xs font-mono text-muted">tx: {status.hash}</div>
      )}
      {result && hasScore && (status.kind === "done" || status.kind === "idle") && (
        <div className="rounded-lg border border-border bg-paper p-4">
          <div className="flex items-center gap-6">
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
