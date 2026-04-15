import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "viem";
import { hashkeyTestnet, hashkeyMainnet } from "./chain";
import { clientEnv } from "./env";

export const wagmiConfig = getDefaultConfig({
  appName: "ZephyrPay",
  projectId: clientEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  chains:
    clientEnv.NEXT_PUBLIC_CHAIN_ID === hashkeyMainnet.id
      ? [hashkeyMainnet]
      : [hashkeyTestnet],
  transports: {
    [hashkeyTestnet.id]: http(),
    [hashkeyMainnet.id]: http(),
  },
  ssr: true,
  // Disable wagmi's EIP-6963 auto-discovery of injected wallets. RainbowKit
  // already curates a deduped connector list; without this flag, wallets that
  // announce themselves via EIP-6963 (notably Phantom, which also pretends to
  // be MetaMask) get registered twice with the same `app.phantom` key, and
  // React complains about duplicate children keys. One curated list, no dupes.
  multiInjectedProviderDiscovery: false,
});
