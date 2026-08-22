"use client";

import { useEffect, useState } from "react";
import { getUserShares } from "@/lib/ledger";

/** Reads a wallet's LP share balance directly from vault-accounting's
 * storage (see lib/ledger.ts) — lifted to a hook since both the sidebar's
 * vault tile and the top bar's portfolio value need the same number. */
export function useVaultShares(address: string | null, refreshKey: number) {
  const [shares, setShares] = useState<bigint | null>(null);

  useEffect(() => {
    if (!address) {
      setShares(null);
      return;
    }
    let cancelled = false;
    getUserShares(address).then((s) => !cancelled && setShares(s));
    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

  return shares;
}
