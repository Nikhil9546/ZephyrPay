import { formatUnits } from "viem";

const HKDM_DECIMALS = 6;

const HKD_FMT = new Intl.NumberFormat("en-HK", {
  style: "currency",
  currency: "HKD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatHkdm(value: bigint): string {
  const asNum = Number(formatUnits(value, HKDM_DECIMALS));
  return HKD_FMT.format(asNum);
}

export function formatHkdCents(cents: number): string {
  return HKD_FMT.format(cents / 100);
}

export function formatAprBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatUnixDate(seconds: bigint | number): string {
  const n = typeof seconds === "bigint" ? Number(seconds) : seconds;
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Date(n * 1000).toLocaleString("en-HK", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
