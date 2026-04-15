"use client";

import { useState } from "react";
import type { Hex } from "viem";

/**
 * Customer-facing "Pay" control rendered inside the sandbox checkout page.
 * On click it hits /api/sandbox/hp2/simulate-pay, which on the server side:
 *   - updates the sandbox cart status to payment-successful
 *   - builds a real HP2-shape webhook payload
 *   - HMAC-signs it with the shared app_secret
 *   - calls our /api/webhooks/hp2 handler internally (self-fetch)
 *
 * The webhook handler then runs its real verification + on-chain settlement.
 */
export function PaySimulator({ flowId }: { flowId: string }) {
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "paying" }
    | { kind: "done"; routed: boolean; txHash?: Hex; reason?: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function pay(outcome: "success" | "failure") {
    setStatus({ kind: "paying" });
    try {
      const res = await fetch("/api/sandbox/hp2/simulate-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId, outcome }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "simulate-pay failed");
      setStatus({
        kind: "done",
        routed: Boolean(body.routed),
        txHash: body.tx_hash as Hex | undefined,
        reason: body.reason,
      });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "unknown error",
      });
    }
  }

  if (status.kind === "done") {
    return (
      <div className="rounded-md border border-accent bg-accent/5 p-4">
        <div className="text-sm font-semibold text-accent">✓ Payment confirmed</div>
        <div className="mt-1 text-xs text-muted">
          HP2 webhook fired and verified. Webhook handler responded OK.
        </div>
        {status.routed && status.txHash && (
          <div className="mt-3 text-xs">
            <span className="text-muted">On-chain settlement:&nbsp;</span>
            <a
              className="font-mono text-ink underline"
              href={`https://testnet-explorer.hsk.xyz/tx/${status.txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {status.txHash.slice(0, 10)}…{status.txHash.slice(-8)} ↗
            </a>
          </div>
        )}
        {!status.routed && status.reason && (
          <div className="mt-2 text-xs text-muted">
            Not routed on-chain: <code>{status.reason}</code>
          </div>
        )}
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="rounded-md border border-danger bg-danger/5 p-4">
        <div className="text-sm font-semibold text-danger">Failed</div>
        <div className="mt-1 text-xs text-muted">{status.message}</div>
        <button
          className="btn-ghost mt-3 text-xs"
          onClick={() => setStatus({ kind: "idle" })}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <button
        onClick={() => pay("success")}
        disabled={status.kind === "paying"}
        className="btn-accent"
      >
        {status.kind === "paying" ? "Processing…" : "Pay with USDC"}
      </button>
      <button
        onClick={() => pay("failure")}
        disabled={status.kind === "paying"}
        className="btn-ghost"
      >
        Simulate failure
      </button>
    </div>
  );
}
