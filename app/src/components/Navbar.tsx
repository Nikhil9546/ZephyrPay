"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function Navbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-paper/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition">
          <div className="h-8 w-8 rounded-md bg-ink flex items-center justify-center text-paper font-mono text-sm font-bold">
            Z
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">ZephyrPay</div>
            <div className="text-xs text-muted leading-tight">
              HKD-stablecoin credit on HashKey Chain
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="hidden md:inline text-sm text-muted hover:text-ink"
          >
            ← Landing
          </Link>
          <ConnectButton
            accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            chainStatus="icon"
            showBalance={false}
          />
        </div>
      </div>
    </header>
  );
}
