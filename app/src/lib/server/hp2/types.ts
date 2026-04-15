import "server-only";

/**
 * HP2 API request/response types. Minimal but exact — exactly what the spec
 * defines (§6 and §9), no more. Keeping types narrow prevents accidentally
 * shipping undocumented fields to the gateway.
 */

// ----------------------------- Cart Mandate -------------------------------

export interface MoneyAmount {
  currency: string; // ISO 4217 (e.g. "USD") per spec display examples
  value: string; // decimal string, e.g. "15.00"
}

export interface DisplayItem {
  label: string;
  amount: MoneyAmount;
}

export interface PaymentMethodData {
  supported_methods: "https://www.x402.org/";
  data: {
    x402Version: 2;
    network: string; // e.g. "hashkey-testnet"
    chain_id: number; // e.g. 133
    contract_address: string; // payment token (USDC on HashKey testnet)
    pay_to: string; // merchant receiving address
    coin: string; // "USDC"
  };
}

export interface PaymentRequest {
  method_data: PaymentMethodData[];
  details: {
    id: string; // payment_request_id (ID2)
    display_items: DisplayItem[];
    total: DisplayItem;
  };
}

export interface CartContents {
  id: string; // cart_mandate_id (ID1)
  user_cart_confirmation_required: boolean;
  payment_request: PaymentRequest;
  cart_expiry: string; // RFC 3339, e.g. "2026-04-15T18:00:00Z"
  merchant_name: string;
}

export interface CartMandateRequestBody {
  cart_mandate: {
    contents: CartContents;
    merchant_authorization: string; // the ES256K JWT
  };
  redirect_url?: string;
}

export interface CreateCartMandateResponseData {
  payment_request_id: string;
  payment_url: string;
  multi_pay: false;
}

// ----------------------------- Payment record ------------------------------

export type PaymentStatus =
  | "payment-required"
  | "payment-submitted"
  | "payment-verified"
  | "payment-processing"
  | "payment-successful"
  | "payment-failed";

export interface PaymentRecord {
  payment_request_id: string;
  request_id: string;
  token_address: string;
  flow_id: string;
  app_key: string;
  amount: string; // smallest unit (USDC 6dp: "15000000" = 15 USDC)
  usd_amount: string;
  token: string;
  chain: string; // CAIP-2 (e.g. "eip155:133")
  network: string;
  extra_protocol: "eip3009" | "permit2";
  status: PaymentStatus;
  status_reason?: string;
  payer_address: string;
  to_pay_address: string;
  risk_level?: string;
  tx_signature?: string;
  broadcast_at?: string;
  gas_limit?: number;
  gas_fee?: string;
  service_fee_rate: string;
  service_fee_type: "free" | "price_include" | "price_extra";
  deadline_time: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

// ---------------------------- Webhook payload ------------------------------

export interface WebhookPaymentEvent {
  event_type: "payment";
  payment_request_id: string;
  request_id: string;
  cart_mandate_id: string;
  payer_address: string;
  amount: string;
  token: string;
  token_address: string;
  network: string;
  status: "payment-successful" | "payment-failed";
  created_at: string;
  tx_signature?: string; // present iff successful
  completed_at?: string; // present iff successful
  status_reason?: string; // present iff failed
}

// ----------------------------- Chain config --------------------------------

export interface HP2ChainConfig {
  networks: Array<{
    chain_id: number;
    name: string;
    display_name: string;
    is_testnet: boolean;
    icon_url: string;
  }>;
  tokens: Array<{
    chain_id: number;
    symbol: string;
    name: string;
    address: string;
    decimals: number;
    version: string;
    payment_protocol: "eip3009" | "permit2";
    is_stablecoin: boolean;
    icon_url: string;
    permit2_spender?: string;
  }>;
}

// ---------------------------- Common envelope ------------------------------

export interface HP2Envelope<T> {
  code: number; // 0 = success
  msg: string;
  data: T;
}
