# ZephyrPay

**On-chain working capital for SMEs. Verify once with a ZK proof, connect a revenue stream, draw a HKD-stablecoin credit line underwritten by an AI scoring oracle, repay automatically from sale proceeds.**

ZephyrPay is a PayFi protocol that turns pending merchant receivables into instant liquidity, denominated in a regulated HKD stablecoin (HKDm — designed to swap to HKDAP / HSBC HKD when those assets land on HashKey Chain). Three contracts, one credit primitive, an AI underwriter that produces auditable rationale, and a ZK identity layer that satisfies the HKMA travel-rule pattern.

---

## What it's for

Asian SME merchants and gig workers — Shopify sellers in Hong Kong, Stripe-billed freelancers in Singapore, TikTok Shop and Lazada operators across SEA — wait 14–18 days for payouts and routinely get rejected by banks for sub-HK$100k credit lines. Existing on-chain credit (Huma, Centrifuge, Goldfinch, Maple) is either institutional-only, on the wrong chain, or has no native HK-stablecoin or sybil-resistance layer.

ZephyrPay closes that gap with a single user flow:

| Step | Today (bank LOC) | ZephyrPay |
|------|------------------|-----------|
| Identity / KYB | 2–6 weeks of paperwork | One signature, one tx (~150k gas) |
| Underwriting decision | 4–6 weeks, opaque | ~3–5 seconds, AI rationale exposed |
| Disbursement | 1–2 business days, fiat rails | One tx, on-chain HKDm in seconds |
| Repayment | Manual transfer / direct debit | Auto-routed from sale proceeds |
| Cost to apply | Hours of staff time + interest | < $0.001 in L2 gas |

The protocol exposes three primitives and lets anyone build on top of them: ZK-attested identity (`PoHRegistry`), AI-signed credit scores (`CreditLine.applyScore`), and a regulated-stablecoin rail (`HKDm`).

---

## Architecture

### High-level system

```
                         ┌───────────────────────────────────────────────┐
                         │                  Browser (dApp)               │
                         │  Next.js 15 · wagmi v2 · viem · RainbowKit    │
                         └────────┬───────────────────────┬──────────────┘
                                  │ POST /api/poh/attest  │ writeContract(...)
                                  │ POST /api/score       │ readContract(...)
                                  │ GET  /api/merchants   │
                                  ▼                       ▼
            ┌──────────────────────────────┐   ┌──────────────────────────────┐
            │  Next.js server (Node.js)    │   │       HashKey Chain (L2)     │
            │                              │   │  ┌────────────────────────┐  │
            │  ┌────────────────────────┐  │   │  │   PoHRegistry          │  │
            │  │ DeepSeek-Chat (V3)     │  │   │  │   - EIP-712 verify      │  │
            │  │ + zod policy clamp     │  │   │  │   - nonce replay guard  │  │
            │  └─────────┬──────────────┘  │   │  └──────────┬─────────────┘  │
            │            │ tier/APR/line   │   │             │                │
            │  ┌─────────▼──────────────┐  │   │  ┌──────────▼─────────────┐  │
            │  │ EIP-712 signer (KMS)   │──┼───┼─▶│   CreditLine            │  │
            │  │ - attestor (PoH)       │  │   │  │   - applyScore (sig)    │  │
            │  │ - scorer (Score)       │  │   │  │   - borrow / repay      │  │
            │  └────────────────────────┘  │   │  │   - onSaleReceived      │  │
            │  ┌────────────────────────┐  │   │  └──────────┬─────────────┘  │
            │  │ RevenueAdapter (iface) │  │   │             │ mint / burnFrom│
            │  │  - FixtureAdapter      │  │   │  ┌──────────▼─────────────┐  │
            │  │  - ShopifyAdapter (v2) │  │   │  │   HKDm                  │  │
            │  │  - StripeAdapter  (v2) │  │   │  │   - ERC20 + Permit      │  │
            │  └────────────────────────┘  │   │  │   - Pausable            │  │
            │  ┌────────────────────────┐  │   │  │   - role-gated mint     │  │
            │  │ Rate limit (Upstash    │  │   │  └────────────────────────┘  │
            │  │   or in-memory)        │  │   └──────────────────────────────┘
            │  └────────────────────────┘  │
            └──────────────────────────────┘
```

### Contract topology

```
HKDm  ──── MINTER_ROLE ───┐
                          ▼
PoHRegistry  ◀── reads ── CreditLine ──── BURNER_ROLE ──▶ HKDm
       ▲                       ▲
       │ EIP-712               │ EIP-712
       │ Attestation           │ Score
   attestor key            scorer key
   (off-chain KMS)         (off-chain KMS)
```

`CreditLine` is the only contract that ever calls `HKDm.mint` / `burnFrom`. It reads `PoHRegistry.isFullyVerified(borrower)` on every `borrow`. The two signing keys never leave the server; the on-chain contracts only know their addresses through `ATTESTOR_ROLE` / `SCORER_ROLE`.

### Data flow — borrow path

```
1. Browser  → POST /api/poh/attest {subject, kind, ownerSig, proofBundle, nonce}
2. Server   → verifyOwnerSignature(subject, sig)        // EIP-191
            → verifyZkProof(proofBundle)                 // Self.xyz / Humanity (production)
            → attestor.signTypedData(Attestation)        // EIP-712
            → returns {issuedAt, expiresAt, nonce, signature}
3. Browser  → PoHRegistry.recordAttestation(...)         // ~148k gas
4. Browser  → POST /api/score {borrower, merchantProfileRef}
5. Server   → fixtureAdapter.fetchProfile(ref)           // RevenueAdapter
            → extractFeatures(profile, onChain)          // deterministic
            → DeepSeek chat.completions (JSON mode)      // ~1-3s
            → llmOutputSchema.parse(...)                 // zod
            → clamp aprBps & maxLine to TIER_POLICY
            → scorer.signTypedData(Score)                // EIP-712
            → returns {score, attestation}
6. Browser  → CreditLine.applyScore(...)                 // ~124k gas
7. Browser  → CreditLine.borrow(amount, duration)        // ~182k gas
            → checks PoH, score, available line
            → HKDm.mint(borrower, amount - fee)
            → HKDm.mint(treasury, fee)
8. Sale arrives → SETTLEMENT_ROLE.onSaleReceived(borrower, amount)  // ~59k gas
            → accrues interest, splits payment, transfers interest
              to treasury, burns principal from borrower
```

### Trust model

| Role / actor      | Where it lives                        | What it can do                                                | Production substitution                                   |
|-------------------|---------------------------------------|---------------------------------------------------------------|-----------------------------------------------------------|
| `DEFAULT_ADMIN`   | Deployer; multisig in production       | Grant/revoke all other roles                                  | Gnosis Safe / timelock                                    |
| `MINTER_ROLE`     | `HKDm` — granted to `CreditLine`       | Mint HKDm on `borrow`                                         | Same; rotated only on contract upgrade                    |
| `BURNER_ROLE`     | `HKDm` — granted to `CreditLine`       | Burn HKDm on `repay` / `onSaleReceived` (via allowance)       | Same                                                      |
| `PAUSER_ROLE`     | `HKDm` + `CreditLine` admin            | Circuit-break the protocol                                    | Multisig with 2-of-N approvers                            |
| `ATTESTOR_ROLE`   | `PoHRegistry`                          | Sign EIP-712 humanity/business attestations                   | Self.xyz, Humanity Protocol, KYB providers                |
| `SCORER_ROLE`     | `CreditLine`                           | Sign EIP-712 credit-score attestations                        | KMS-held key + multi-model ensemble                       |
| `SETTLEMENT_ROLE` | `CreditLine`                           | Forward sale proceeds via `onSaleReceived(borrower, amount)`  | Merchant gateway plugin (Shopify/Stripe webhook → relayer)|

### Repository layout

```
├── contracts/              Foundry project (Solidity 0.8.26, OpenZeppelin v5.1.0)
│   ├── src/
│   │   ├── HKDm.sol            ERC20 + Permit + Pausable + AccessControl, 6 dp
│   │   ├── PoHRegistry.sol     EIP-712 attestation registry, per-attestor nonce replay guard
│   │   └── CreditLine.sol      Signed scoring oracle, simple-interest accrual, role-gated settlement
│   ├── test/                   48 tests — unit (43) + end-to-end integration (5)
│   ├── script/Deploy.s.sol     One-shot deploy + role wiring; writes deployments/<chainId>.json
│   └── deployments/            Per-chain deployment records
├── app/                    Next.js 15 App Router dApp (TypeScript strict)
│   ├── src/app/
│   │   ├── api/score/          DeepSeek-Chat (JSON mode) → policy clamp → EIP-712 signed Score
│   │   ├── api/poh/attest/     EIP-191 wallet-ownership check → EIP-712 signed Attestation
│   │   └── api/merchants/      RevenueAdapter list endpoint
│   ├── src/lib/server/
│   │   ├── scoring.ts          Feature extraction + LLM + TIER_POLICY clamping
│   │   ├── revenue.ts          RevenueAdapter interface + FixtureAdapter
│   │   ├── signer.ts           EIP-712 typed-data signing for both keys
│   │   └── rateLimit.ts        Upstash-or-memory fixed-window limiter
│   └── src/components/         VerifyPanel · ScorePanel · BorrowPanel · TxHistory
├── relayer/                Settlement relayer (Fastify + viem)
│   └── src/
│       ├── server.ts           HTTP + queue + worker bootstrap, SETTLEMENT_ROLE pre-check
│       ├── webhooks.ts         HMAC-verified /webhooks/sale endpoint (Shopify/Stripe-shape)
│       ├── queue.ts            FIFO queue with dedupe, per-merchant back-pressure, backoff
│       ├── worker.ts           Drains queue → onSaleReceived, bounded retries, dead-letter
│       └── chain.ts            viem read/write clients + simulateContract safety
├── scripts/
│   ├── deploy-testnet.sh   One-command HashKey testnet deploy + role verification
│   └── e2e-anvil.ts        End-to-end smoke test: attest → score → borrow → webhook → settle
├── package.json            pnpm workspace root
└── pnpm-workspace.yaml
```

---

## Benchmarks

All numbers below were measured locally on this codebase. Tooling: `forge 1.5.1` + Solidity 0.8.26 (optimizer 200 runs, no via-IR), Node 23.3.0, `pnpm 9.15.4`.

### Contract sizes (runtime bytecode, EIP-170 limit 24,576 B)

| Contract     | Runtime | % of limit | Initcode | Deploy gas |
|--------------|---------|------------|----------|------------|
| `HKDm`       | 5,697 B | 23.2%      | 7,037 B  | 1,401,752  |
| `PoHRegistry`| 4,751 B | 19.3%      | 5,991 B  | 1,148,175  |
| `CreditLine` | 9,711 B | 39.5%      | 11,279 B | 2,294,913  |

### Per-call gas (median across the test suite)

| Path                                  | Gas       | At HSK = $0.05, 0.001 gwei (L2) |
|---------------------------------------|-----------|---------------------------------|
| `PoHRegistry.recordAttestation`       | 148,151   | ~$0.0000074                     |
| `CreditLine.applyScore`               | 124,453   | ~$0.0000062                     |
| `CreditLine.borrow`                   | 181,860   | ~$0.0000091                     |
| `CreditLine.repay`                    | 48,121    | ~$0.0000024                     |
| `CreditLine.onSaleReceived`           | 59,104    | ~$0.0000030                     |
| `CreditLine.outstandingDebt` (view)   | 9,857     | free                            |
| `PoHRegistry.isFullyVerified` (view)  | 8,923     | free                            |
| `HKDm.transfer`                       | 38,800    | ~$0.0000019                     |

End-to-end onboarding (verify → score → borrow) costs ~454k gas, roughly **$0.000023 in L2 fees**. By comparison, Stripe Capital charges 4–8% of principal as an upfront fee; Shopify Capital takes 1–3 business days plus a 12–18% factoring rate; a Hong Kong bank LOC application costs hours of staff time and weeks of waiting.

### Test suite

```
Suite             Tests   Time
HKDm              12      7.3 ms
PoHRegistry       11      3.7 ms
CreditLine        20     10.5 ms
Integration        5     12.8 ms   (deploy + full user flow + adversarial)
─────────────────────────────────
Total             48      ~170 ms
```

Includes EIP-712 signature verification, replay-protection, expiry, role-gating, reentrancy, pause behavior, simple-interest accrual fuzz, mint/burn fuzz (256 runs), and an integration suite that runs the production `Deploy` script in-memory and exercises the full attest → score → borrow → accrue → repay → re-borrow journey plus three adversarial scenarios (forged attestation, scorer-key compromise, pause behavior).

### Live-chain validation

The deploy script and end-to-end flow are verified against a live chain (local anvil) on every change:

```
--- forge script Deploy.s.sol against anvil (chainId 31337) ---
HKDm         : 0x2279b7a0a67db372996a5fab50d91eaa73d2ebe6
PoHRegistry  : 0x8a791620dd6260079bf849dc5567adc3f2fdc318
CreditLine   : 0x610178da211fef7d417bc0e6fed39f05609ad788
Roles verified on-chain:
  ✓ HKDm MINTER_ROLE → CreditLine
  ✓ HKDm BURNER_ROLE → CreditLine
  ✓ PoH ATTESTOR_ROLE → attestor
  ✓ Credit SCORER_ROLE → scorer

--- e2e-anvil.ts (attest → score → borrow → webhook → relayer → settle) ---
[1/4] attestation tx  status=success
[2/4] score tx        status=success
[3/4] borrow tx       status=success    debt after borrow: 1000 HKD
[4/4] webhook 202 {"enqueued":true}
       debt before webhook: 1000 HKD
       debt after  webhook:  500 HKD
✅ full e2e flow working
```

### App

| Metric                              | Value          |
|-------------------------------------|----------------|
| Production build time               | ~22 s          |
| Page bundle (`/`)                   | 14.6 KB gz     |
| First Load JS                       | 335 KB         |
| API routes                          | 3 dynamic      |
| TypeScript strict                   | passes, zero `any` |
| Rate limit (per IP+wallet, /score)  | 10 / minute    |
| Rate limit (per wallet, /poh/attest)| 3 / 24h        |

### Underwriting latency (DeepSeek-Chat / V3, temperature 0, 700 max tokens, JSON mode)

These are estimates from the documented DeepSeek-Chat latency envelope, not yet measured against this exact prompt:

| Step                                  | Estimated wall time |
|---------------------------------------|--------------------|
| Feature extraction (deterministic)    | < 5 ms             |
| DeepSeek API call                     | 1.0 – 3.0 s        |
| Zod validation + policy clamp         | < 1 ms             |
| EIP-712 sign (viem)                   | < 5 ms             |
| **Total `/api/score`**                | **~1.5–3 s p50**   |

DeepSeek's JSON-mode (`response_format: { type: "json_object" }`) constrains the output to a valid JSON object — no fence-stripping, no parser fallback path. Cost: roughly **$0.0001 – $0.0003 per scoring call** at DeepSeek-Chat input/output pricing. Once a measurement run is recorded against a real API key, this row will be replaced with observed p50/p95/p99.

The provider is wired through the official `openai` SDK pointed at DeepSeek's OpenAI-compatible base URL — swapping providers (DeepSeek → OpenAI → Together → Groq → vLLM) is a one-line `baseURL` change with no contract or downstream-route changes.

### Codebase size (handwritten only)

```
Solidity (src + test + script): 1,350 LOC
TypeScript / TSX:               2,169 LOC
─────────────────────────────────────────
Total:                          3,519 LOC
```

---

## Running it

Prereqs: Node ≥ 20, pnpm 9, Foundry (`forge` 1.5+).

```bash
pnpm install
cd contracts && forge install && forge build && forge test
```

`forge test` should print **`48 passed; 0 failed`** in under a second.

### Configure environment

```bash
cp .env.example .env                 # repo root — used by deploy script + Foundry
cp .env.example app/.env.local       # used by the Next.js app
```

Required variables (see `.env.example` for the full list):

- `DEPLOYER_PRIVATE_KEY` — funded address on the target chain
- `ATTESTOR_PRIVATE_KEY` + `ATTESTOR_ADDRESS` — off-chain key that signs PoH attestations
- `SCORER_PRIVATE_KEY`   + `SCORER_ADDRESS`   — off-chain key that signs Score attestations
- `DEEPSEEK_API_KEY` — DeepSeek API key for the scoring service (`platform.deepseek.com`)
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — get one at `cloud.reown.com`
- `HASHKEY_TESTNET_RPC` (defaults to public endpoint)

Generate signing keys with `cast wallet new` — never reuse existing keys for these roles.

### Deploy contracts (one command)

```bash
./scripts/deploy-testnet.sh
```

The script:

1. Sources `.env`
2. Verifies the RPC is reachable and the deployer has HSK gas
3. Runs the full Foundry test suite (`forge test`)
4. Runs `forge script Deploy.s.sol --broadcast` which wires:
   - `MINTER_ROLE` + `BURNER_ROLE` on `HKDm` → `CreditLine`
   - `ATTESTOR_ROLE` on `PoHRegistry` → attestor address
   - `SCORER_ROLE` + `SETTLEMENT_ROLE` on `CreditLine` → scorer + deployer
5. Verifies every role via `cast call hasRole(...)` on-chain before declaring success
6. Writes addresses into `app/.env.local` and `contracts/deployments/<chainId>.json`

If you want a manual run:

```bash
cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url hashkey_testnet --broadcast
```

### Dry-run locally first

Anvil can simulate the exact same deploy for free before you spend testnet gas:

```bash
anvil --chain-id 31337     # terminal 1
# terminal 2: re-run deploy-testnet.sh pointing at http://localhost:8545
```

### Start the settlement relayer

The relayer watches merchant-gateway webhooks (Shopify / Stripe) and routes sale proceeds into `CreditLine.onSaleReceived`. First grant `SETTLEMENT_ROLE` to a fresh relayer key, then boot it:

```bash
# one-time: grant SETTLEMENT_ROLE to the relayer
cast send $CREDIT_LINE_ADDRESS "grantRole(bytes32,address)" \
  $(cast keccak "SETTLEMENT_ROLE") $RELAYER_ADDRESS \
  --private-key $DEPLOYER_PRIVATE_KEY --rpc-url $HASHKEY_TESTNET_RPC

# then run the relayer
RELAYER_PRIVATE_KEY=... \
CREDIT_LINE_ADDRESS=... \
HKDM_ADDRESS=... \
RPC_URL=$HASHKEY_TESTNET_RPC \
CHAIN_ID=133 \
WEBHOOK_SECRET=$(openssl rand -hex 32) \
pnpm --filter @zephyrpay/relayer dev
```

On startup the relayer reads `SETTLEMENT_ROLE` from the contract and refuses to run if it doesn't hold it — you cannot boot a misconfigured relayer.

Health check: `curl http://localhost:8787/health` → `{"status":"ok","queueSize":0}`

Webhook endpoint: `POST /webhooks/sale` (HMAC-SHA256 signed in `x-zephyrpay-signature`).

### Run the dApp

```bash
pnpm dev                 # http://localhost:3000
# or:
pnpm build && pnpm --filter @zephyrpay/app start
```

The first time you connect a wallet, the UI walks you through:

1. **Verify** — sign a wallet-ownership challenge; the server issues an EIP-712 PoH+business attestation; you submit it on-chain.
2. **Score** — pick a merchant profile (the `FixtureAdapter` exposes three seeded merchants for testing); the server runs the scoring pipeline and returns a signed Score; you commit it on-chain.
3. **Borrow** — set an amount and duration; `borrow()` mints HKDm to your wallet net of a 1.5% origination fee.
4. **Repay** — either call `repay(amount)` directly, or have a `SETTLEMENT_ROLE` relayer call `onSaleReceived(...)` as sales arrive.

---

## Security posture

- Solidity 0.8.26, optimizer 200 runs, custom errors throughout
- OpenZeppelin v5.1.0 `AccessControl`, `Pausable`, `ReentrancyGuard`, `ERC20Permit`, `EIP712`, `ECDSA`, `MessageHashUtils`, `SafeERC20`
- Per-attestor nonce bitmap on both `PoHRegistry` and `CreditLine` to block signature replay
- `MAX_APR_BPS = 5000`, per-tier APR bands, absolute `LINE_ABSOLUTE_CAP_CENTS` = HK$50,000, max origination fee 10% — bound the blast radius of a compromised scorer key
- Server-side env split (`serverEnv` vs `clientEnv`) keeps signing keys and DeepSeek API key out of the client bundle
- Zod validation at every API boundary; structured LLM output parsed and clamped before signing
- Rate limits on both API endpoints (10/min on `/score`, 3/24h on `/poh/attest`)

Open items: external audit, formal verification of interest-accrual arithmetic, decentralized scorer/attestor rotation registry, on-chain revocation lists.

---

## Roadmap (production substitution table)

| Subsystem    | Current implementation                          | Next implementation                                                |
|--------------|-------------------------------------------------|--------------------------------------------------------------------|
| Stablecoin   | `HKDm` — role-gated ERC-20 + Permit + Pausable  | `HKDAP` / HSBC HKD via bridge contract behind same `IERC20` surface |
| ZK identity  | EIP-712 attestor, opaque `proofBundle`          | Self.xyz / Humanity Protocol — verifier called before signing      |
| Revenue data | `FixtureAdapter` (3 seeded merchants)           | `ShopifyAdapter`, `StripeAdapter`, `WeChatPayAdapter` (OAuth)      |
| Settlement   | Manual `SETTLEMENT_ROLE` call                   | Merchant-gateway plugin streams sale proceeds via webhook → relayer|
| LP side      | Protocol-funded credit pool                     | LP deposit/withdraw + tier-tranched yield                          |
| Indexing     | Direct `getContractEvents` scan (50k blocks)    | Ponder / Envio indexer with subgraph-style queries                 |
| Scoring      | Single Sonnet 4.6 call + clamps                 | Multi-model ensemble + on-chain reputation feedback loop            |

None of these substitutions change the on-chain interface; each is a drop-in behind an existing typed boundary.

---

## License

MIT.
