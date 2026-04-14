"use client";

import { useMemo, useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { formatUnits, maxUint256, parseUnits } from "viem";
import { addresses } from "@/lib/addresses";
import { creditLineAbi, hkdmAbi } from "@/lib/abi";
import { formatAprBps, formatHkdm } from "@/lib/format";

const HKDM_DECIMALS = 6;

interface Props {
  available: bigint;
  aprBps: number;
  maxLine: bigint;
  outstandingDebt: bigint;
  hkdmBalance: bigint;
  allowance: bigint;
  onChanged: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "pending"; label: string }
  | { kind: "confirming"; hash: Hex; label: string }
  | { kind: "done"; hash: Hex; label: string }
  | { kind: "error"; message: string };

const DURATIONS: { label: string; seconds: number }[] = [
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
  { label: "14 days", seconds: 14 * 24 * 60 * 60 },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
];

export function BorrowPanel({
  available,
  aprBps,
  maxLine,
  outstandingDebt,
  hkdmBalance,
  allowance,
  onChanged,
}: Props) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [amountStr, setAmountStr] = useState("");
  const [durationSec, setDurationSec] = useState(DURATIONS[2].seconds);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const amount = useMemo(() => {
    try {
      if (!amountStr) return 0n;
      return parseUnits(amountStr, HKDM_DECIMALS);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  const exceeds = amount > available;
  const disabled = amount === 0n || exceeds || status.kind === "pending" || status.kind === "confirming";

  async function borrow() {
    if (!address || !walletClient || !publicClient) return;
    try {
      setStatus({ kind: "pending", label: "Borrow" });
      const hash = await walletClient.writeContract({
        address: addresses.creditLine,
        abi: creditLineAbi,
        functionName: "borrow",
        args: [amount, durationSec],
      });
      setStatus({ kind: "confirming", hash, label: "Borrow" });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: "done", hash, label: "Borrow" });
      setAmountStr("");
      onChanged();
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "unknown" });
    }
  }

  async function approve() {
    if (!address || !walletClient || !publicClient) return;
    try {
      setStatus({ kind: "pending", label: "Approve" });
      const hash = await walletClient.writeContract({
        address: addresses.hkdm,
        abi: hkdmAbi,
        functionName: "approve",
        args: [addresses.creditLine, maxUint256],
      });
      setStatus({ kind: "confirming", hash, label: "Approve" });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: "done", hash, label: "Approve" });
      onChanged();
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "unknown" });
    }
  }

  async function repay() {
    if (!address || !walletClient || !publicClient) return;
    try {
      setStatus({ kind: "pending", label: "Repay" });
      const hash = await walletClient.writeContract({
        address: addresses.creditLine,
        abi: creditLineAbi,
        functionName: "repay",
        args: [amount > 0n ? amount : outstandingDebt],
      });
      setStatus({ kind: "confirming", hash, label: "Repay" });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: "done", hash, label: "Repay" });
      setAmountStr("");
      onChanged();
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "unknown" });
    }
  }

  const needsApproval = allowance < (amount > 0n ? amount : outstandingDebt);

  return (
    <div className="card space-y-5">
      <div>
        <div className="text-sm font-medium text-muted">Step 3</div>
        <h2 className="text-xl font-semibold">Draw against your line or repay early</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Available credit" value={formatHkdm(available)} />
        <Stat label="Outstanding debt" value={formatHkdm(outstandingDebt)} />
        <Stat label="HKDm balance" value={formatHkdm(hkdmBalance)} />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <label className="text-xs text-muted">Amount (HKD)</label>
          <input
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
            className="mt-1 w-full rounded-lg border border-border bg-paper px-3 py-2 font-mono text-lg focus:border-ink focus:outline-none"
          />
          {exceeds && (
            <div className="mt-1 text-xs text-danger">
              Exceeds available line ({formatHkdm(available)}).
            </div>
          )}
          <div className="mt-1 text-xs text-muted">
            Max line {formatHkdm(maxLine)} · APR {formatAprBps(aprBps)} (simple interest)
          </div>
        </div>
        <div>
          <label className="text-xs text-muted">Duration</label>
          <div className="mt-1 flex gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.seconds}
                onClick={() => setDurationSec(d.seconds)}
                className={`rounded-md border px-3 py-2 text-sm ${
                  durationSec === d.seconds ? "border-ink bg-ink/5" : "border-border"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button onClick={borrow} disabled={disabled} className="btn-accent">
          {status.kind === "pending" && status.label === "Borrow" ? "Waiting…" : "Borrow HKDm"}
        </button>
        <button
          onClick={repay}
          disabled={outstandingDebt === 0n || status.kind === "pending"}
          className="btn-ghost"
        >
          {status.kind === "pending" && status.label === "Repay"
            ? "Waiting…"
            : amount > 0n
              ? `Repay ${formatHkdm(amount)}`
              : `Repay all (${formatHkdm(outstandingDebt)})`}
        </button>
        {outstandingDebt > 0n && needsApproval && (
          <button onClick={approve} disabled={status.kind === "pending"} className="btn-ghost">
            {status.kind === "pending" && status.label === "Approve"
              ? "Approving…"
              : "Approve HKDm"}
          </button>
        )}
      </div>

      {status.kind === "confirming" && (
        <div className="text-xs font-mono text-muted">
          confirming tx: {status.hash.slice(0, 10)}…{status.hash.slice(-8)}
        </div>
      )}
      {status.kind === "error" && (
        <div className="text-sm text-danger">Failed: {status.message}</div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

// silence unused import warning for formatUnits (used indirectly when we want to re-derive values)
void formatUnits;
