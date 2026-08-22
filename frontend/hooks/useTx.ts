"use client";

import { useCallback, useState } from "react";
import { useToasts } from "@/app/providers";
import { config } from "@/lib/stellar";

interface RunOptions {
  pendingTitle: string;
  successTitle: string;
  errorTitle?: string;
}

/** Wraps an AssembledTransaction.signAndSend() call with toast + busy-state plumbing. */
export function useTx() {
  const { push, update } = useToasts();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T,>(action: () => Promise<{ result: T; sendTransactionResponse?: { hash?: string } }>, opts: RunOptions) => {
      setBusy(true);
      const toastId = push({ kind: "pending", title: opts.pendingTitle, detail: "Confirm in Freighter…" });
      try {
        const sent = await action();
        const hash = sent.sendTransactionResponse?.hash;
        update(toastId, {
          kind: "success",
          title: opts.successTitle,
          detail: hash ? `Tx ${hash.slice(0, 10)}…` : undefined,
          href: hash ? `https://stellar.expert/explorer/${config.networkPassphrase.includes("Test") ? "testnet" : "public"}/tx/${hash}` : undefined,
        });
        return sent.result;
      } catch (e) {
        update(toastId, {
          kind: "error",
          title: opts.errorTitle ?? "Transaction failed",
          detail: friendlyError(e),
        });
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [push, update],
  );

  return { run, busy };
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("User declined") || msg.includes("declined access")) return "Rejected in wallet.";
  if (msg.includes("StalePrice")) return "Oracle price is stale — try again shortly.";
  if (msg.includes("InsufficientFreeCollateral")) return "Not enough free collateral in the vault right now.";
  if (msg.includes("InsufficientHistory")) return "Not enough volatility history yet for this series.";
  if (msg.includes("SlippageExceeded")) return "Price moved beyond your slippage tolerance.";
  if (msg.includes("SeriesExpired")) return "This series has already expired.";
  if (msg.includes("NotYetExpired")) return "This series hasn't expired yet.";
  if (msg.includes("AlreadySettled")) return "This series has already been settled.";
  return msg.length > 180 ? `${msg.slice(0, 180)}…` : msg;
}
