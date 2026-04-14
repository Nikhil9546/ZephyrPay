/**
 * Contract ABIs — minimal surface required by the app.
 * Keeping them hand-curated (rather than auto-imported from forge artifacts)
 * avoids shipping the entire compiler output into the client bundle and keeps
 * the types tight. Any function added on-chain must also be added here.
 */

export const hkdmAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const pohAbi = [
  {
    type: "function",
    name: "recordAttestation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "subject", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "issuedAt", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isVerified",
    stateMutability: "view",
    inputs: [
      { name: "subject", type: "address" },
      { name: "kind", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isFullyVerified",
    stateMutability: "view",
    inputs: [{ name: "subject", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "AttestationRecorded",
    inputs: [
      { name: "subject", type: "address", indexed: true },
      { name: "kind", type: "uint8", indexed: true },
      { name: "attestor", type: "address", indexed: true },
      { name: "issuedAt", type: "uint64", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const creditLineAbi = [
  {
    type: "function",
    name: "applyScore",
    stateMutability: "nonpayable",
    inputs: [
      { name: "borrower", type: "address" },
      { name: "tier", type: "uint8" },
      { name: "maxLine", type: "uint256" },
      { name: "aprBps", type: "uint16" },
      { name: "issuedAt", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "duration", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "onSaleReceived",
    stateMutability: "nonpayable",
    inputs: [
      { name: "borrower", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "scores",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "tier", type: "uint8" },
      { name: "maxLine", type: "uint256" },
      { name: "aprBps", type: "uint16" },
      { name: "issuedAt", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "loans",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "principal", type: "uint256" },
      { name: "interestAccrued", type: "uint256" },
      { name: "lastAccrualAt", type: "uint64" },
      { name: "dueAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "availableCredit",
    stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "outstandingDebt",
    stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Borrowed",
    inputs: [
      { name: "borrower", type: "address", indexed: true },
      { name: "principal", type: "uint256", indexed: false },
      { name: "originationFee", type: "uint256", indexed: false },
      { name: "dueAt", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Repaid",
    inputs: [
      { name: "borrower", type: "address", indexed: true },
      { name: "principalRepaid", type: "uint256", indexed: false },
      { name: "interestPaid", type: "uint256", indexed: false },
      { name: "remainingPrincipal", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;
