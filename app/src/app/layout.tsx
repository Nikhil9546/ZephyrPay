import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
const jbm = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jbm",
});

export const metadata: Metadata = {
  title: "ZephyrPay — On-chain working capital for SMEs",
  description:
    "ZK-verified, AI-underwritten HKD-stablecoin credit lines on HashKey Chain. 90 seconds, not 6 weeks.",
  openGraph: {
    title: "ZephyrPay",
    description:
      "ZK-verified, AI-underwritten HKD-stablecoin credit for Asian SMEs on HashKey Chain.",
    type: "website",
  },
};

/**
 * Root layout stays provider-free so the landing page (and any future
 * marketing routes) can fully server-render without pulling in wagmi /
 * RainbowKit / WalletConnect. The wallet-dependent tree is scoped to
 * `/app/layout.tsx`.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jbm.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
