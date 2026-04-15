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
  title: "ZephyrPay — Sybil-resistant, AI-underwritten SME credit on HashKey Chain",
  description:
    "Verify once with a ZK proof, connect your revenue stream, and draw a HKD-stablecoin credit line underwritten by an AI oracle.",
  openGraph: {
    title: "ZephyrPay",
    description:
      "ZK-verified, AI-underwritten HKD-stablecoin credit for Asian SMEs on HashKey Chain.",
    type: "website",
  },
};

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
