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
});
