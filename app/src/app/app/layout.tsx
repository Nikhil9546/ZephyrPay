import { Providers } from "../providers";

/**
 * Layout for the wallet-gated dApp. Wraps children in the dynamic-loaded
 * wagmi + RainbowKit + QueryClient tree. The root layout is intentionally
 * provider-free, so landing-page routes render as fully static HTML.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
