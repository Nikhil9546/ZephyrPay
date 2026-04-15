"use client";

import { useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import { toast } from "sonner";
import { addresses } from "@/lib/addresses";
import { pohAbi } from "@/lib/abi";
import { loadOrCreateIdentity, enrollIdentity, buildProof } from "@/lib/zk-client";

interface Props {
  fullyVerified: boolean;
  onDone: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "proving" }
  | { kind: "attesting" }
  | { kind: "submitting" }
  | { kind: "confirming"; hash: Hex }
  | { kind: "done"; hash: Hex };

export function VerifyPanel({ fullyVerified, onDone }: Props) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function runVerify() {
    if (!address || !walletClient || !publicClient) return;
    try {
      // 1. Load or create a persistent ZK identity for this browser.
      setStatus({ kind: "preparing" });
      const identity = loadOrCreateIdentity();
      await enrollIdentity(identity);

      // 2. Generate a real Groth16 zk-SNARK proof of group membership, scoped
      //    to this wallet and a fresh challenge.
      setStatus({ kind: "proving" });
      const kind = 3 as const; // humanity + business bundle
      const clientNonce = crypto.randomUUID();
      const zkProof = await buildProof({
        identity,
        subject: address,
        kind,
        clientNonce,
      });

      // 3. Submit proof to the attestor. Server runs real Groth16 verification.
      setStatus({ kind: "attesting" });
      const attestRes = await fetch("/api/poh/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: address,
          kind,
          zkProof,
          clientNonce,
        }),
      });
      if (!attestRes.ok) {
        const body = await attestRes.json().catch(() => ({}));
        throw new Error(body.detail ?? body.error ?? `attestation failed (${attestRes.status})`);
      }
      const { attestation } = (await attestRes.json()) as {
        attestation: {
          subject: Address;
          kind: 1 | 2 | 3;
          issuedAt: string;
          expiresAt: string;
          nonce: Hex;
          signature: Hex;
        };
      };

      // 4. Record the signed attestation on-chain.
      setStatus({ kind: "submitting" });
      const hash = await walletClient.writeContract({
        address: addresses.poh,
        abi: pohAbi,
        functionName: "recordAttestation",
        args: [
          attestation.subject,
          attestation.kind,
          BigInt(attestation.issuedAt),
          BigInt(attestation.expiresAt),
          attestation.nonce,
          attestation.signature,
        ],
      });
      setStatus({ kind: "confirming", hash });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus({ kind: "done", hash });
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      if (msg.includes("User rejected") || msg.includes("User denied")) {
        toast.info("Cancelled");
      } else {
        toast.error(`Verification failed: ${msg}`);
      }
      setStatus({ kind: "idle" });
    }
  }

  if (fullyVerified) {
    return (
      <div className="card">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-accent/20 text-accent flex items-center justify-center">
            ✓
          </div>
          <div>
            <div className="font-semibold">Verified</div>
            <div className="text-sm text-muted">You&apos;re good to go.</div>
          </div>
        </div>
      </div>
    );
  }

  const isBusy =
    status.kind === "preparing" ||
    status.kind === "proving" ||
    status.kind === "attesting" ||
    status.kind === "submitting" ||
    status.kind === "confirming";

  return (
    <div className="card space-y-4">
      <div>
        <div className="text-sm font-medium text-muted">Step 1</div>
        <h2 className="text-xl font-semibold">Verify you&apos;re real</h2>
        <p className="mt-1 text-sm text-muted max-w-2xl">
          Generate a zero-knowledge proof of humanity and business. One click,
          one on-chain record.
        </p>
      </div>

      <button onClick={runVerify} disabled={isBusy || !address} className="btn-accent">
        {status.kind === "preparing" && "Preparing identity…"}
        {status.kind === "proving" && "Generating ZK proof…"}
        {status.kind === "attesting" && "Verifying proof…"}
        {status.kind === "submitting" && "Waiting for wallet…"}
        {status.kind === "confirming" && "Confirming on-chain…"}
        {status.kind === "idle" && "Verify"}
        {status.kind === "done" && "Verified ✓"}
      </button>
    </div>
  );
}
