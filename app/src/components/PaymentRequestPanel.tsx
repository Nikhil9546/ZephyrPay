"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";

interface Props {
  borrower: Address | undefined;
  outstandingDebt: bigint;
  onRepaid: () => void;
}

interface CreatedLink {
  payment_url: string;
  payment_request_id: string;
  cart_mandate_id: string;
  amount_usd: string;
  expires_at: string;
  auto_repay_from_credit_line: boolean;
}

type PaymentStatus =
  | "payment-required"
  | "payment-submitted"
  | "payment-verified"
  | "payment-processing"
  | "payment-successful"
  | "payment-failed";

type PollState =
  | { kind: "idle" }
  | { kind: "polling"; status: PaymentStatus }
  | { kind: "complete"; status: PaymentStatus; txSignature?: string }
  | { kind: "error"; message: string };

export function PaymentRequestPanel({ borrower, outstandingDebt, onRepaid }: Props) {
  const [amount, setAmount] = useState<string>("50.00");
  const [description, setDescription] = useState<string>("Sale settlement");
  const [autoRepay, setAutoRepay] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);
  const [link, setLink] = useState<CreatedLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poll, setPoll] = useState<PollState>({ kind: "idle" });

  const disabled = creating || !borrower || !amount;

  async function createLink() {
    setError(null);
    setLink(null);
    setPoll({ kind: "idle" });
    if (!borrower) return;
    setCreating(true);
    try {
      const res = await fetch("/api/payments/hp2/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrower,
          amountUSD: amount,
          description,
          autoRepayFromCreditLine: autoRepay,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? body.error ?? `HP2 create failed (${res.status})`);
      }
      const data = (await res.json()) as CreatedLink;
      setLink(data);
      setPoll({ kind: "polling", status: "payment-required" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
    } finally {
      setCreating(false);
    }
  }

  // Poll for status while a link is open.
  useEffect(() => {
    if (poll.kind !== "polling" || !link) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/payments/hp2/status?payment_request_id=${encodeURIComponent(link.payment_request_id)}`,
        );
        if (!res.ok) return; // stay in polling state
        const body = await res.json();
        const status = body.record?.status as PaymentStatus | undefined;
        if (!status) return;
        if (cancelled) return;
        if (status === "payment-successful" || status === "payment-failed") {
          setPoll({ kind: "complete", status, txSignature: body.record?.tx_signature });
          if (status === "payment-successful") onRepaid();
          return;
        }
        setPoll({ kind: "polling", status });
      } catch {
        // swallow — we just keep polling
      }
    };
    const id = setInterval(tick, 3_000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [poll.kind, link, onRepaid]);

  const qrSrc = useMemo(() => {
    if (!link) return null;
    // Free, no-dep QR via a public img service — fine for testnet demo.
    const encoded = encodeURIComponent(link.payment_url);
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encoded}`;
  }, [link]);

  return (
    <div className="card space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-muted">Step 4</div>
          <span className="text-[11px] uppercase tracking-wider bg-accent/10 text-accent px-1.5 py-0.5 rounded">
            HashKey HP2
          </span>
        </div>
        <h2 className="text-xl font-semibold">
          Accept a customer payment via HashKey Payment
        </h2>
        <p className="mt-1 text-sm text-muted max-w-2xl">
          Generate a HashKey HP2 (Payment Protocol v2) checkout link. Customers
          pay in USDC on HashKey Chain testnet. When payment confirms, the
          proceeds are auto-routed into <code>CreditLine.onSaleReceived()</code>
          &nbsp;— paying down your outstanding loan without any manual step.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
        <label className="block">
          <span className="text-xs text-muted font-medium">Amount (USD)</span>
          <input
            type="text"
            inputMode="decimal"
            className="input mt-1"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted font-medium">Description</span>
          <input
            type="text"
            className="input mt-1"
            value={description}
            maxLength={80}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 md:self-end md:pb-2">
          <input
            type="checkbox"
            className="accent-accent"
            checked={autoRepay}
            onChange={(e) => setAutoRepay(e.target.checked)}
            disabled={outstandingDebt === 0n}
          />
          <span className="text-sm text-ink">
            Auto-repay my loan
            {outstandingDebt === 0n && (
              <span className="block text-[11px] text-muted">No outstanding debt to repay.</span>
            )}
          </span>
        </label>
      </div>

      <button onClick={createLink} disabled={disabled} className="btn-accent">
        {creating ? "Creating HP2 checkout…" : "Create payment link"}
      </button>

      {error && <div className="text-sm text-danger">Failed: {error}</div>}

      {link && (
        <div className="rounded-lg border border-border bg-paper p-4 space-y-3">
          <div className="flex flex-wrap items-start gap-6">
            {qrSrc && (
              // Third-party QR service — next/image isn't worth the config
              // overhead for a single testnet URL. eslint-disable-next-line
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrSrc}
                alt="HP2 payment link QR"
                className="rounded border border-border"
                width={160}
                height={160}
              />
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <div className="text-xs text-muted uppercase tracking-wide">Payment URL</div>
                <a
                  href={link.payment_url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-sm text-ink underline underline-offset-2 hover:text-accent"
                >
                  {link.payment_url}
                </a>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Kv label="Amount" value={`$${link.amount_usd} USDC`} />
                <Kv label="Auto-repay" value={link.auto_repay_from_credit_line ? "ON" : "OFF"} />
                <Kv label="Cart mandate" value={link.cart_mandate_id} mono />
                <Kv label="Expires" value={new Date(link.expires_at).toLocaleString()} />
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-3 flex items-center justify-between">
            <PollBadge poll={poll} />
            {poll.kind === "complete" && poll.txSignature && (
              <a
                className="text-xs font-mono text-ink underline"
                href={`https://testnet-explorer.hsk.xyz/tx/${poll.txSignature}`}
                target="_blank"
                rel="noreferrer"
              >
                on-chain tx ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kv({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</div>
    </div>
  );
}

function PollBadge({ poll }: { poll: PollState }) {
  if (poll.kind === "idle") return <span className="text-sm text-muted">Waiting for payment…</span>;
  if (poll.kind === "error") return <span className="text-sm text-danger">Poll error: {poll.message}</span>;
  if (poll.kind === "polling") {
    return (
      <span className="text-sm">
        <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse mr-2 align-middle" />
        Status: <code>{poll.status}</code>
      </span>
    );
  }
  const ok = poll.status === "payment-successful";
  return (
    <span className={`text-sm font-medium ${ok ? "text-accent" : "text-danger"}`}>
      {ok ? "✓ Paid — loan auto-repaid on-chain" : "✗ Payment failed"}
    </span>
  );
}
