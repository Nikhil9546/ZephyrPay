import Link from "next/link";
import { fetchProtocolStats } from "@/lib/server/stats";
import { formatHkdm } from "@/lib/format";

export const revalidate = 60; // re-fetch live stats every 60 seconds

const TAGLINE = "On-chain working capital for SMEs. 90 seconds, not 6 weeks.";

export default async function Landing() {
  const stats = await fetchProtocolStats();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <LandingNav />

      <Hero />

      <Problem />

      <HowItWorks />

      <WhyHashKey />

      <ArchitectureSection />

      <StatsSection stats={stats} />

      <CTASection />

      <Footer stats={stats} />
    </div>
  );
}

// ---------------------------------------------------------------------------
//                                  Sections
// ---------------------------------------------------------------------------

function LandingNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-paper/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-ink flex items-center justify-center text-paper font-mono text-sm font-bold">
            Z
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">ZephyrPay</div>
            <div className="text-xs text-muted leading-tight">
              HKD-stablecoin credit on HashKey Chain
            </div>
          </div>
        </Link>
        <nav className="flex items-center gap-3">
          <a
            href="#how"
            className="hidden md:inline text-sm text-muted hover:text-ink"
          >
            How it works
          </a>
          <a
            href="#architecture"
            className="hidden md:inline text-sm text-muted hover:text-ink"
          >
            Architecture
          </a>
          <a href="#stats" className="hidden md:inline text-sm text-muted hover:text-ink">
            Live stats
          </a>
          <Link href="/app" className="btn-accent">
            Launch app →
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-20 pb-16">
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted">
          <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
          Live on HashKey Chain testnet · chainId 133
        </div>
        <h1 className="mt-6 text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]">
          {TAGLINE}
        </h1>
        <p className="mt-6 text-xl text-muted max-w-2xl leading-relaxed">
          Asian SME merchants and freelancers wait 14–18 days to get paid and get
          declined by banks for small credit lines. ZephyrPay turns pending receivables
          into instant HKD-stablecoin liquidity — with an AI underwriter and a ZK
          identity layer designed for Hong Kong&apos;s new stablecoin regime.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link href="/app" className="btn-accent text-base">
            Try the live demo →
          </Link>
          <a
            href="#how"
            className="btn-ghost text-base"
          >
            See how it works
          </a>
        </div>
        <div className="mt-8 flex flex-wrap gap-6 text-sm text-muted">
          <Fact label="Onboarding" value="~90s" />
          <Fact label="Gas per borrow" value="~$0.00001" />
          <Fact label="Tests passing" value="48 / 48" />
          <Fact label="AI decision" value="1–3s" />
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="border-y border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 py-16 grid gap-10 md:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted font-semibold">
            The gap
          </div>
          <h2 className="mt-2 text-3xl font-bold leading-tight">
            Small merchants have big working-capital problems.
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Maya runs a Shopify store in Kowloon. She sells <b>HK$80,000</b> a
            month, but Shopify holds her payouts for 18 days. Her bank declined
            a HK$50k line of credit twice — &quot;insufficient trading history.&quot;
          </p>
          <p className="mt-3 text-muted leading-relaxed">
            So she pays her inventory supplier on a 28% APR personal credit
            card, or worse, misses restock windows and loses 20% of peak-season
            sales. This is the reality for an estimated{" "}
            <b>$2.4 trillion of unmet SME credit demand in Asia</b>.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-paper p-6">
          <div className="text-xs uppercase tracking-wider text-muted font-semibold">
            Today vs ZephyrPay
          </div>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2 font-medium">Step</th>
                <th className="py-2 font-medium">Bank LOC</th>
                <th className="py-2 font-medium text-accent">ZephyrPay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <Row s="Identity / KYB" a="2–6 weeks" b="One signature" />
              <Row s="Underwriting" a="4–6 weeks" b="~3 seconds" />
              <Row s="Disbursement" a="1–2 days" b="Seconds" />
              <Row s="Repayment" a="Manual direct debit" b="Auto from sales" />
              <Row s="Cost to apply" a="Hours of staff time" b="<$0.001 gas" />
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-6 py-20">
      <div className="max-w-2xl">
        <div className="text-xs uppercase tracking-wider text-muted font-semibold">
          How it works
        </div>
        <h2 className="mt-2 text-3xl font-bold leading-tight">
          Four steps. Roughly ninety seconds.
        </h2>
      </div>
      <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Step
          n={1}
          title="Verify once"
          body="Sign a wallet-ownership challenge. A ZK-backed attestor records a humanity + business proof on the PoHRegistry contract. Valid for 180 days."
          artifact="PoHRegistry.recordAttestation()"
        />
        <Step
          n={2}
          title="Connect revenue"
          body="Link Shopify, Stripe, TikTok Shop, or a marketplace via the RevenueAdapter interface. We pull 90 days of gross sales, refund rate, and chargeback rate."
          artifact="RevenueAdapter.fetchProfile()"
        />
        <Step
          n={3}
          title="Get scored by AI"
          body="DeepSeek assigns a tier (A–E) with a plain-English rationale. APR and max line are clamped to policy bands — the LLM can't invent risk-free 50% lines."
          artifact="CreditLine.applyScore() with EIP-712 signed attestation"
        />
        <Step
          n={4}
          title="Draw & auto-repay"
          body="Borrow HKDm against your line. A settlement relayer watches your sales webhook and routes proceeds into on-chain repayment automatically."
          artifact="CreditLine.borrow() + onSaleReceived()"
        />
      </ol>
    </section>
  );
}

function WhyHashKey() {
  return (
    <section className="border-y border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-wider text-muted font-semibold">
            Why HashKey Chain
          </div>
          <h2 className="mt-2 text-3xl font-bold leading-tight">
            Built for Hong Kong&apos;s stablecoin moment.
          </h2>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <Pillar
            title="Regulated rails"
            body="HKMA issued its first stablecoin licenses in April 2026 (HSBC + Anchorpoint HKDAP). ZephyrPay's HKDm is a transitional stand-in designed to swap to HKDAP the moment it's live — via a bridge contract, not a re-deploy."
          />
          <Pillar
            title="Compliance-native"
            body="EIP-712 attestations map cleanly onto the HKMA travel-rule framework (HK$8,000 threshold). Address-bound humanity proofs satisfy KYC without leaking PII."
          />
          <Pillar
            title="Institutional-grade L2"
            body="HashKey Chain is an OP-stack Layer 2 with gas priced in sub-gwei. End-to-end onboarding costs roughly $0.00002 in fees — 10,000× cheaper than a Stripe Capital application."
          />
        </div>
      </div>
    </section>
  );
}

function ArchitectureSection() {
  return (
    <section id="architecture" className="mx-auto max-w-6xl px-6 py-20">
      <div className="max-w-2xl">
        <div className="text-xs uppercase tracking-wider text-muted font-semibold">
          Under the hood
        </div>
        <h2 className="mt-2 text-3xl font-bold leading-tight">
          Three contracts. One credit primitive. Verifiable end-to-end.
        </h2>
      </div>

      <div className="mt-12 rounded-xl border border-border bg-card p-6 overflow-x-auto">
        <pre className="text-xs leading-relaxed font-mono text-ink">
{`  HKDm  ←── MINTER_ROLE ───┐
                            │
  PoHRegistry  ◀── reads ── CreditLine ──── BURNER_ROLE ──▶ HKDm
         ▲                       ▲
         │ EIP-712                │ EIP-712
         │ Attestation            │ Score
     attestor key              scorer key
     (off-chain KMS)           (off-chain KMS)`}
        </pre>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        <Contract
          name="HKDm"
          tagline="Regulated stablecoin stand-in"
          body="ERC-20 + Permit + Pausable + AccessControl. 6 decimals. Role-gated mint / burn. Swappable for HKDAP behind the same IERC20 surface."
          size="5,697 B"
        />
        <Contract
          name="PoHRegistry"
          tagline="ZK-attested identity layer"
          body="EIP-712 attestor-signed humanity + business proofs. Per-attestor nonce replay guard. Three kinds: humanity, business, bundle."
          size="4,751 B"
        />
        <Contract
          name="CreditLine"
          tagline="Signed-oracle credit origination"
          body="AI-scored credit lines (EIP-712 Score). Simple-interest accrual. Reentrancy-safe, pausable, role-gated settlement. Bounded blast radius via MAX_APR_BPS + global line cap."
          size="9,711 B"
        />
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2 text-sm">
        <div className="rounded-lg border border-border bg-paper p-4">
          <div className="text-xs uppercase tracking-wider text-muted font-semibold">
            Safety properties
          </div>
          <ul className="mt-3 space-y-2 text-ink leading-relaxed">
            <Bullet>
              Scorer output is <b>clamped to policy bands</b>, not trusted. A
              compromised LLM or key can&apos;t set 200% APR.
            </Bullet>
            <Bullet>
              <b>Per-attestor nonce bitmap</b> blocks signature replay.
            </Bullet>
            <Bullet>
              <b>Global caps</b>: MAX_APR = 50%, line cap = HK$50,000, fee cap = 10%.
            </Bullet>
            <Bullet>
              <b>OpenZeppelin v5</b>: AccessControl, Pausable, ReentrancyGuard, SafeERC20 throughout.
            </Bullet>
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-paper p-4">
          <div className="text-xs uppercase tracking-wider text-muted font-semibold">
            Test coverage
          </div>
          <ul className="mt-3 space-y-2 text-ink leading-relaxed">
            <Bullet>
              <b>48 Foundry tests</b> — unit (43) + full end-to-end integration (5).
            </Bullet>
            <Bullet>
              Includes fuzz testing (256 runs), adversarial scenarios, forged-signature tests, scorer-compromise simulation.
            </Bullet>
            <Bullet>
              Deploy script is regression-tested — the same script that goes to mainnet is exercised in CI.
            </Bullet>
            <Bullet>
              Full suite runs in <b>~170 ms</b>.
            </Bullet>
          </ul>
        </div>
      </div>
    </section>
  );
}

function StatsSection({ stats }: { stats: Awaited<ReturnType<typeof fetchProtocolStats>> }) {
  return (
    <section id="stats" className="border-y border-border bg-ink text-paper">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-wider text-paper/60 font-semibold">
            Live on-chain
          </div>
          <h2 className="mt-2 text-3xl font-bold leading-tight">
            Every number on this page is a contract call away.
          </h2>
          <p className="mt-3 text-paper/70">
            Pulled directly from{" "}
            {stats ? (
              <code className="text-accent">{stats.chainName}</code>
            ) : (
              <code className="text-paper/60">chain config</code>
            )}
            . Refreshed every 60 seconds. Click any number to inspect it on the block
            explorer.
          </p>
        </div>

        {stats ? (
          <div className="mt-10 grid gap-4 md:grid-cols-4">
            <StatTile
              label="Verified wallets"
              value={stats.totals.uniqueVerified.toString()}
              href={`${stats.explorerBase}/address/${stats.contracts.poh}`}
            />
            <StatTile
              label="Unique borrowers"
              value={stats.totals.uniqueBorrowers.toString()}
              href={`${stats.explorerBase}/address/${stats.contracts.creditLine}`}
            />
            <StatTile
              label="Loans originated"
              value={stats.totals.totalBorrows.toString()}
              href={`${stats.explorerBase}/address/${stats.contracts.creditLine}`}
            />
            <StatTile
              label="Repayment events"
              value={stats.totals.totalRepays.toString()}
              href={`${stats.explorerBase}/address/${stats.contracts.creditLine}`}
            />
            <StatTile
              label="Cumulative originated"
              value={formatHkdm(stats.totals.cumulativeOriginated)}
              href={`${stats.explorerBase}/address/${stats.contracts.creditLine}`}
            />
            <StatTile
              label="Cumulative repaid"
              value={formatHkdm(stats.totals.cumulativeRepaidPrincipal)}
              href={`${stats.explorerBase}/address/${stats.contracts.creditLine}`}
            />
            <StatTile
              label="Interest collected"
              value={formatHkdm(stats.totals.cumulativeInterestPaid)}
              href={`${stats.explorerBase}/address/${stats.contracts.creditLine}`}
            />
            <StatTile
              label="HKDm in circulation"
              value={formatHkdm(stats.totals.hkdmSupply)}
              href={`${stats.explorerBase}/address/${stats.contracts.hkdm}`}
            />
          </div>
        ) : (
          <div className="mt-10 rounded-lg border border-paper/10 bg-paper/5 p-6 text-sm text-paper/70">
            Contracts are not deployed yet for this environment. Run{" "}
            <code className="text-accent">./scripts/deploy-testnet.sh</code> and refresh.
          </div>
        )}
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="rounded-2xl border border-border bg-card p-10 md:p-14 text-center">
        <h2 className="text-4xl font-bold leading-tight">
          Try it right now — no signup, no waitlist.
        </h2>
        <p className="mt-4 text-muted max-w-xl mx-auto">
          Connect any EVM wallet on HashKey Chain testnet, pick a seeded merchant
          profile, get a real AI-signed credit score, and borrow HKDm against it.
          Every transaction is verifiable on the block explorer.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/app" className="btn-accent text-base">
            Launch app →
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-base"
          >
            Read the source
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer({ stats }: { stats: Awaited<ReturnType<typeof fetchProtocolStats>> }) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-10 grid gap-8 md:grid-cols-3 text-sm">
        <div>
          <div className="font-semibold">ZephyrPay</div>
          <p className="mt-2 text-muted max-w-sm leading-relaxed">
            ZK-verified, AI-underwritten HKD-stablecoin credit for Asian SMEs.
            Built on HashKey Chain.
          </p>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted font-semibold">
            Contracts
          </div>
          {stats ? (
            <ul className="mt-3 space-y-1 font-mono text-xs">
              <li>
                <a
                  className="text-ink hover:text-accent underline-offset-2 hover:underline"
                  href={`${stats.explorerBase}/address/${stats.contracts.hkdm}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  HKDm ↗
                </a>
                <span className="text-muted ml-2">
                  {shorten(stats.contracts.hkdm)}
                </span>
              </li>
              <li>
                <a
                  className="text-ink hover:text-accent underline-offset-2 hover:underline"
                  href={`${stats.explorerBase}/address/${stats.contracts.poh}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  PoHRegistry ↗
                </a>
                <span className="text-muted ml-2">
                  {shorten(stats.contracts.poh)}
                </span>
              </li>
              <li>
                <a
                  className="text-ink hover:text-accent underline-offset-2 hover:underline"
                  href={`${stats.explorerBase}/address/${stats.contracts.creditLine}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  CreditLine ↗
                </a>
                <span className="text-muted ml-2">
                  {shorten(stats.contracts.creditLine)}
                </span>
              </li>
            </ul>
          ) : (
            <div className="mt-3 text-muted">Contracts not yet deployed.</div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted font-semibold">
            Built on
          </div>
          <ul className="mt-3 space-y-1 text-muted">
            <li>Solidity 0.8.26 · Foundry · OpenZeppelin v5</li>
            <li>Next.js 15 · viem · wagmi · RainbowKit</li>
            <li>DeepSeek V3 · EIP-712 · EIP-191</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-4 flex flex-wrap items-center justify-between text-xs text-muted">
          <div>
            © {new Date().getFullYear()} ZephyrPay · MIT licensed
          </div>
          <div>
            Testnet build · do not use real funds
          </div>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
//                              Primitive UI
// ---------------------------------------------------------------------------

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-ink text-base font-semibold">{value}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}

function Row({ s, a, b }: { s: string; a: string; b: string }) {
  return (
    <tr>
      <td className="py-3 pr-4 font-medium">{s}</td>
      <td className="py-3 pr-4 text-muted line-through">{a}</td>
      <td className="py-3 text-accent font-medium">{b}</td>
    </tr>
  );
}

function Step({
  n,
  title,
  body,
  artifact,
}: {
  n: number;
  title: string;
  body: string;
  artifact: string;
}) {
  return (
    <li className="rounded-xl border border-border bg-card p-5 relative">
      <div className="absolute -top-3 left-5 rounded-full bg-ink text-paper text-xs font-bold px-2 py-1">
        {n}
      </div>
      <h3 className="mt-2 font-semibold text-lg">{title}</h3>
      <p className="mt-2 text-sm text-muted leading-relaxed">{body}</p>
      <div className="mt-4 text-xs font-mono text-ink/70 border-t border-border pt-3">
        {artifact}
      </div>
    </li>
  );
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-paper p-6">
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="mt-2 text-sm text-muted leading-relaxed">{body}</p>
    </div>
  );
}

function Contract({
  name,
  tagline,
  body,
  size,
}: {
  name: string;
  tagline: string;
  body: string;
  size: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono font-semibold">{name}</h3>
        <span className="text-xs text-muted">{size}</span>
      </div>
      <div className="mt-1 text-xs text-muted uppercase tracking-wide">{tagline}</div>
      <p className="mt-3 text-sm text-muted leading-relaxed">{body}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-accent shrink-0">›</span>
      <span>{children}</span>
    </li>
  );
}

function StatTile({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-lg border border-paper/10 bg-paper/5 p-4 hover:bg-paper/10 transition"
    >
      <div className="text-xs text-paper/60 uppercase tracking-wide">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold">{value}</div>
    </a>
  );
}

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
