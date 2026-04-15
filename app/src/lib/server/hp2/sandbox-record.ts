import "server-only";
import type { SandboxCart } from "@/lib/server/hp2/sandbox-state";
import type { PaymentRecord } from "@/lib/server/hp2/types";

/**
 * Convert our internal sandbox cart state into the exact shape HP2 returns
 * from `GET /payments/cart-mandate` (Single-Pay §5.1 / §6.3).
 */
export function sandboxToPaymentRecord(cart: SandboxCart): PaymentRecord {
  return {
    payment_request_id: cart.paymentRequestId,
    request_id: `sandbox_${cart.flowId.slice(0, 12)}`,
    token_address: cart.tokenAddress,
    flow_id: cart.flowId,
    app_key: cart.appKey,
    amount: cart.usdcMinorUnits,
    usd_amount: cart.amountUsd,
    token: "USDC",
    chain: `eip155:${cart.chainId}`,
    network: cart.network,
    extra_protocol: "eip3009",
    status: cart.status,
    status_reason: cart.statusReason,
    payer_address: cart.payerAddress ?? "",
    to_pay_address: cart.merchantPayTo,
    risk_level: "Low",
    tx_signature: cart.txSignature,
    broadcast_at: cart.completedAt,
    gas_limit: 150000,
    gas_fee: "0.0001",
    service_fee_rate: "0.0000",
    service_fee_type: "free",
    deadline_time: cart.expiresAt,
    created_at: cart.createdAt,
    updated_at: cart.completedAt ?? cart.createdAt,
    completed_at: cart.completedAt,
  };
}
