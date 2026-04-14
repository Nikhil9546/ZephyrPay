"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { addresses } from "@/lib/addresses";
import { creditLineAbi, hkdmAbi, pohAbi } from "@/lib/abi";
import type { MerchantProfile } from "@/lib/server/revenue";

export function useAccountStatus(account: Address | undefined) {
  const enabled = Boolean(account);

  const { data, refetch, isFetching } = useReadContracts({
    allowFailure: false,
    contracts: account
      ? [
          {
            address: addresses.poh,
            abi: pohAbi,
            functionName: "isVerified",
            args: [account, 1],
          },
          {
            address: addresses.poh,
            abi: pohAbi,
            functionName: "isVerified",
            args: [account, 2],
          },
          {
            address: addresses.poh,
            abi: pohAbi,
            functionName: "isFullyVerified",
            args: [account],
          },
          {
            address: addresses.hkdm,
            abi: hkdmAbi,
            functionName: "balanceOf",
            args: [account],
          },
          {
            address: addresses.creditLine,
            abi: creditLineAbi,
            functionName: "scores",
            args: [account],
          },
          {
            address: addresses.creditLine,
            abi: creditLineAbi,
            functionName: "loans",
            args: [account],
          },
          {
            address: addresses.creditLine,
            abi: creditLineAbi,
            functionName: "availableCredit",
            args: [account],
          },
          {
            address: addresses.creditLine,
            abi: creditLineAbi,
            functionName: "outstandingDebt",
            args: [account],
          },
          {
            address: addresses.hkdm,
            abi: hkdmAbi,
            functionName: "allowance",
            args: [account, addresses.creditLine],
          },
        ]
      : [],
    query: { enabled, refetchInterval: 10_000 },
  });

  if (!data) {
    return {
      isLoading: isFetching,
      refetch,
      humanityVerified: false,
      businessVerified: false,
      fullyVerified: false,
      hkdmBalance: 0n,
      score: null as null | {
        tier: number;
        maxLine: bigint;
        aprBps: number;
        issuedAt: bigint;
        expiresAt: bigint;
      },
      loan: null as null | {
        principal: bigint;
        interestAccrued: bigint;
        lastAccrualAt: bigint;
        dueAt: bigint;
      },
      availableCredit: 0n,
      outstandingDebt: 0n,
      allowanceToCreditLine: 0n,
    };
  }

  const [
    humanityVerified,
    businessVerified,
    fullyVerified,
    hkdmBalance,
    scoreTuple,
    loanTuple,
    availableCredit,
    outstandingDebt,
    allowanceToCreditLine,
  ] = data as readonly [
    boolean,
    boolean,
    boolean,
    bigint,
    readonly [number, bigint, number, bigint, bigint],
    readonly [bigint, bigint, bigint, bigint],
    bigint,
    bigint,
    bigint,
  ];

  return {
    isLoading: isFetching,
    refetch,
    humanityVerified,
    businessVerified,
    fullyVerified,
    hkdmBalance,
    score:
      scoreTuple[4] > 0n
        ? {
            tier: scoreTuple[0],
            maxLine: scoreTuple[1],
            aprBps: scoreTuple[2],
            issuedAt: scoreTuple[3],
            expiresAt: scoreTuple[4],
          }
        : null,
    loan:
      loanTuple[0] > 0n
        ? {
            principal: loanTuple[0],
            interestAccrued: loanTuple[1],
            lastAccrualAt: loanTuple[2],
            dueAt: loanTuple[3],
          }
        : null,
    availableCredit,
    outstandingDebt,
    allowanceToCreditLine,
  };
}

export function useMerchants() {
  return useQuery({
    queryKey: ["merchants"],
    queryFn: async (): Promise<{ adapter: string; merchants: MerchantProfile[] }> => {
      const r = await fetch("/api/merchants", { cache: "no-store" });
      if (!r.ok) throw new Error(`merchants fetch ${r.status}`);
      return r.json();
    },
  });
}

export function useHkdmDecimals(): number {
  const { data } = useReadContract({
    address: addresses.hkdm,
    abi: hkdmAbi,
    functionName: "decimals",
  });
  return typeof data === "number" ? data : 6;
}
