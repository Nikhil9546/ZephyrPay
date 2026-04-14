"use client";

import { useState } from "react";
import { useAccount, useSignMessage, useWalletClient, usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import { addresses } from "@/lib/addresses";
import { pohAbi } from "@/lib/abi";

interface Props {
  fullyVerified: boolean;
  onDone: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "attesting" }
  | { kind: "submitting" }
  | { kind: "confirming"; hash: Hex }
  | { kind: "done"; hash: Hex }
  | { kind: "error"; message: string };

export function VerifyPanel({ fullyVerified, onDone }: Props) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function runVerify() {
    if (!address || !walletClient || !publicClient) return;
    setStatus({ kind: "signing" });
    try {
      const kind = 3 as const; // humanity + business bundle
      const clientNonce = crypto.randomUUID();
      const message = `ZephyrPay PoH ${address.toLowerCase()} ${kind} ${clientNonce}`;
      const ownerSignature = await signMessageAsync({ message });

      setStatus({ kind: "attesting" });
      const attestRes = await fetch("/api/poh/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: address,
          kind,
          /**
           * In production this `proofBundle` will be the ZK proof returned by
           * Self.xyz / Humanity Protocol after the user completes their flow.
           * The attestation API verifies it before signing. For this demo, we
           * send an opaque bundle; the backend gates on rate-limit + wallet
           * ownership signature (verified above).
           */
          proofBundle: `zephyrpay-demo-bundle-${clientNonce}`,
          ownerSignature,
          clientNonce,
        }),
      });
      if (!attestRes.ok) {
        const body = await attestRes.json().catch(() => ({}));
        throw new Error(body.error ?? `attestation failed (${attestRes.status})`);
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
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "unknown error",
      });
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
            <div className="text-sm text-muted">
              Humanity and business attestations recorded on-chain.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isBusy =
    status.kind === "signing" ||
    status.kind === "attesting" ||
    status.kind === "submitting" ||
    status.kind === "confirming";

  return (
    <div className="card space-y-4">
      <div>
        <div className="text-sm font-medium text-muted">Step 1</div>
        <h2 className="text-xl font-semibold">Verify once with ZK + business attestation</h2>
        <p className="mt-1 text-sm text-muted max-w-2xl">
          One click signs a wallet-ownership challenge. Our attestor then issues an EIP-712
          signed humanity+business attestation that you submit to the <code>PoHRegistry</code>
          contract. In production this is backed by Self.xyz / Humanity Protocol ZK proofs.
        </p>
      </div>

      <button
        onClick={runVerify}
        disabled={isBusy || !address}
        className="btn-accent"
      >
        {status.kind === "signing" && "Waiting for wallet signature…"}
        {status.kind === "attesting" && "Issuing attestation…"}
        {status.kind === "submitting" && "Submitting on-chain…"}
        {status.kind === "confirming" && "Confirming…"}
        {status.kind === "idle" && "Verify humanity + business"}
        {status.kind === "error" && "Retry verification"}
        {status.kind === "done" && "Verified ✓"}
      </button>

      {status.kind === "error" && (
        <div className="text-sm text-danger">Failed: {status.message}</div>
      )}
      {status.kind === "confirming" && (
        <div className="text-xs font-mono text-muted">tx: {status.hash}</div>
      )}
    </div>
  );
}
