import { defineChain } from "viem";

export const hashkeyTestnet = defineChain({
  id: 133,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HashKey", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet.hsk.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "HashKey Testnet Explorer",
      url: "https://testnet-explorer.hsk.xyz",
    },
  },
  testnet: true,
});

export const hashkeyMainnet = defineChain({
  id: 177,
  name: "HashKey Chain",
  nativeCurrency: { name: "HashKey", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.hsk.xyz"] },
  },
  blockExplorers: {
    default: { name: "HashKey Explorer", url: "https://explorer.hsk.xyz" },
  },
});
