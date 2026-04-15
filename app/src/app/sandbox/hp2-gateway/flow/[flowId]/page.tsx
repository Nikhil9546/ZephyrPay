import Link from "next/link";
import { notFound } from "next/navigation";
import { getCartByFlowId } from "@/lib/server/hp2/sandbox-state";
import { PaySimulator } from "./PaySimulator";

export const dynamic = "force-dynamic";

/**
 * Sandbox checkout page served at `/sandbox/hp2-gateway/flow/{flowId}` —
 * this is what the real HP2 gateway would serve at `pay.hashkey.com/flow/{id}`.
 * We render the cart contents the merchant signed, and let a sandbox
 * "customer" click Pay to simulate a successful USDC payment.
 *
 * When Pay is clicked, the client posts to /api/sandbox/hp2/simulate-pay,
 * which signs a real HP2-shape webhook and fires it at /api/webhooks/hp2.
 * The webhook runs the full real verification path + on-chain settlement.
 */

export default async function SandboxCheckout({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  const cart = getCartByFlowId(flowId);
  if (!cart) notFound();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-lg border border-border bg-card p-6 space-y-5">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-7 w-7 rounded bg-ink flex items-center justify-center text-paper font-mono text-xs font-bold">
                HP2
              </div>
              <div className="text-sm font-semibold">HashKey Payment</div>
            </Link>
            <span className="text-[10px] uppercase tracking-widest bg-accent/10 text-accent px-2 py-0.5 rounded">
              sandbox · testnet
            </span>
          </div>

          <div className="border-t border-border" />

          <div>
            <div className="text-xs text-muted uppercase tracking-wide">Pay to</div>
            <div className="font-semibold">{cart.merchantName}</div>
            <div className="font-mono text-xs text-muted break-all mt-0.5">
              {cart.merchantPayTo}
            </div>
          </div>

          <div className="rounded-md bg-paper border border-border p-4">
            <div className="text-xs text-muted uppercase tracking-wide">Total</div>
            <div className="mt-1 flex items-baseline gap-2">
              <div className="text-4xl font-bold">${cart.amountUsd}</div>
              <div className="text-sm text-muted">USDC · {cart.network}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <KV label="cart_mandate_id" value={cart.cartMandateId} mono />
            <KV label="payment_request_id" value={cart.paymentRequestId} mono />
            <KV label="flow_id" value={cart.flowId} mono />
            <KV label="expires" value={new Date(cart.expiresAt).toLocaleString()} />
            <KV label="chain_id" value={cart.chainId.toString()} mono />
            <KV label="protocol" value="x402 / EIP-3009" mono />
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-xs text-muted">
              Status: <code className="text-ink">{cart.status}</code>
            </div>
          </div>

          <PaySimulator flowId={cart.flowId} />

          <div className="text-[11px] text-muted leading-relaxed pt-3 border-t border-border">
            <p>
              <strong>Sandbox notice:</strong> this checkout is served from the
              ZephyrPay app itself and simulates the HashKey HP2 gateway. The
              Cart Mandate was signed with a real ES256K JWT; the webhook
              fired on payment will use a real HMAC-SHA256 signature; the
              downstream on-chain call to{" "}
              <code>CreditLine.onSaleReceived</code> happens for real on
              HashKey Chain testnet. The only mocked element is the HP2
              gateway endpoint itself — swapping{" "}
              <code>HP2_BASE_URL</code> to the production URL makes this
              entirely live.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className={`mt-0.5 break-all ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
