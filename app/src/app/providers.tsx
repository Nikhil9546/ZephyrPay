"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

/**
 * Lazy-load the wagmi + RainbowKit + WalletConnect tree on the client only.
 *
 * WalletConnect's underlying core (`@walletconnect/core`) calls `indexedDB`
 * during initialization, which throws under Node's SSR runtime. Disabling
 * SSR for this subtree is the supported escape hatch — it has no SEO impact
 * because the app is wallet-gated and rendered behind auth anyway.
 */
const ClientProviders = dynamic(
  () => import("./providers-impl").then((m) => m.Providers),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading…
      </div>
    ),
  },
);

export function Providers({ children }: { children: ReactNode }) {
  return <ClientProviders>{children}</ClientProviders>;
}
