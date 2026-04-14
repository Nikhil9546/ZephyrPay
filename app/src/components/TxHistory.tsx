"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Address, Log } from "viem";
import { addresses } from "@/lib/addresses";
import { creditLineAbi, pohAbi } from "@/lib/abi";
import { hashkeyTestnet, hashkeyMainnet } from "@/lib/chain";
import { clientEnv } from "@/lib/env";
import { formatHkdm, formatUnixDate, formatAddress } from "@/lib/format";

type Row = {
  hash: `0x${string}`;
  blockNumber: bigint;
  label: string;
  detail: string;
  timestamp: bigint;
};

const chain =
  clientEnv.NEXT_PUBLIC_CHAIN_ID === hashkeyMainnet.id ? hashkeyMainnet : hashkeyTestnet;
const explorerBase = chain.blockExplorers.default.url;

/**
 * Query the last ~50k blocks for events relevant to this wallet.
 * For a hackathon volume of activity this is cheap; post-MVP we switch to a
 * proper indexer (ponder / envio) and drop the direct RPC scan.
 */
const LOOKBACK = 50_000n;

export function TxHistory({ account }: { account: Address | undefined }) {
  const publicClient = usePublicClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!account || !publicClient) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const current = await publicClient.getBlockNumber();
        const from = current > LOOKBACK ? current - LOOKBACK : 0n;

        const [borrowedLogs, repaidLogs, attestationLogs] = await Promise.all([
          publicClient.getContractEvents({
            address: addresses.creditLine,
            abi: creditLineAbi,
            eventName: "Borrowed",
            args: { borrower: account },
            fromBlock: from,
            toBlock: current,
          }),
          publicClient.getContractEvents({
            address: addresses.creditLine,
            abi: creditLineAbi,
            eventName: "Repaid",
            args: { borrower: account },
            fromBlock: from,
            toBlock: current,
          }),
          publicClient.getContractEvents({
            address: addresses.poh,
            abi: pohAbi,
            eventName: "AttestationRecorded",
            args: { subject: account },
            fromBlock: from,
            toBlock: current,
          }),
        ]);

        const collected: Row[] = [];
        for (const log of borrowedLogs) {
          const ts = await blockTs(publicClient, log);
          collected.push({
            hash: log.transactionHash,
            blockNumber: log.blockNumber,
            label: "Borrowed",
            detail: `${formatHkdm(log.args.principal ?? 0n)} · fee ${formatHkdm(log.args.originationFee ?? 0n)}`,
            timestamp: ts,
          });
        }
        for (const log of repaidLogs) {
          const ts = await blockTs(publicClient, log);
          collected.push({
            hash: log.transactionHash,
            blockNumber: log.blockNumber,
            label: "Repaid",
            detail: `principal ${formatHkdm(log.args.principalRepaid ?? 0n)} · interest ${formatHkdm(log.args.interestPaid ?? 0n)}`,
            timestamp: ts,
          });
        }
        for (const log of attestationLogs) {
          const ts = await blockTs(publicClient, log);
          collected.push({
            hash: log.transactionHash,
            blockNumber: log.blockNumber,
            label: `Attestation kind ${log.args.kind}`,
            detail: `by ${formatAddress(String(log.args.attestor))}`,
            timestamp: ts,
          });
        }

        collected.sort((a, b) => Number(b.blockNumber - a.blockNumber));
        if (!cancelled) setRows(collected);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account, publicClient]);

  if (!account) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">On-chain history</h2>
        {loading && <span className="text-xs text-muted">loading…</span>}
      </div>

      {rows.length === 0 && !loading && (
        <div className="mt-3 text-sm text-muted">
          No on-chain activity yet for this wallet.
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 divide-y divide-border">
          {rows.map((r) => (
            <div key={`${r.hash}-${r.label}`} className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{r.label}</div>
                <div className="text-sm text-muted">{r.detail}</div>
                <div className="text-xs text-muted">{formatUnixDate(r.timestamp)}</div>
              </div>
              <a
                className="text-xs font-mono text-ink underline"
                href={`${explorerBase}/tx/${r.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                {r.hash.slice(0, 10)}…{r.hash.slice(-8)} ↗
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function blockTs(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  log: Log,
): Promise<bigint> {
  if (log.blockNumber == null) return 0n;
  const block = await client.getBlock({ blockNumber: log.blockNumber });
  return block.timestamp;
}
