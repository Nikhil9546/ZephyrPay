"use client";

import { useAccount } from "wagmi";
import { Navbar } from "@/components/Navbar";
import { VerifyPanel } from "@/components/VerifyPanel";
import { ScorePanel } from "@/components/ScorePanel";
import { BorrowPanel } from "@/components/BorrowPanel";
import { PaymentRequestPanel } from "@/components/PaymentRequestPanel";
import { TxHistory } from "@/components/TxHistory";
import { useAccountStatus } from "@/hooks/useZephyrPay";
import { formatHkdm, formatAprBps } from "@/lib/format";

export default function Home() {
  const { address, isConnected } = useAccount();
  const status = useAccountStatus(address);

  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <section>
          <h1 className="text-4xl font-bold tracking-tight">
            Working capital for your business.
          </h1>
          <p className="mt-3 max-w-3xl text-lg text-muted">
            Verify. Get scored by AI. Borrow. Accept payments that auto-repay.
          </p>
        </section>

        {!isConnected ? (
          <div className="card">
            <p className="text-sm text-muted">Connect a wallet to begin.</p>
          </div>
        ) : (
          <>
            <VerifyPanel fullyVerified={status.fullyVerified} onDone={status.refetch} />

            <ScorePanel
              fullyVerified={status.fullyVerified}
              hasScore={Boolean(status.score)}
              onScored={status.refetch}
            />

            {status.score && (
              <BorrowPanel
                available={status.availableCredit}
                aprBps={status.score.aprBps}
                maxLine={status.score.maxLine}
                outstandingDebt={status.outstandingDebt}
                hkdmBalance={status.hkdmBalance}
                allowance={status.allowanceToCreditLine}
                onChanged={status.refetch}
              />
            )}

            {status.score && (
              <PaymentRequestPanel
                borrower={address}
                outstandingDebt={status.outstandingDebt}
                onRepaid={status.refetch}
              />
            )}

            {status.score && (
              <div className="card">
                <div className="grid gap-6 md:grid-cols-4">
                  <Meta label="Tier" value={tierLabel(status.score.tier)} />
                  <Meta label="APR" value={formatAprBps(status.score.aprBps)} />
                  <Meta label="Max line" value={formatHkdm(status.score.maxLine)} />
                  <Meta
                    label="Outstanding"
                    value={formatHkdm(status.outstandingDebt)}
                  />
                </div>
              </div>
            )}

            <TxHistory account={address} />
          </>
        )}

        <footer className="pt-12 text-xs text-muted">
          ZephyrPay · HashKey Chain · Built for the On-Chain Horizon Hackathon (2026).
          HKDm is a transitional regulated-stablecoin stand-in; the external IERC20 surface
          is designed to remain stable when HKDAP / HSBC HKD go live on HashKey Chain.
        </footer>
      </main>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

function tierLabel(tier: number): string {
  return ["—", "A", "B", "C", "D", "E"][tier] ?? "—";
}
