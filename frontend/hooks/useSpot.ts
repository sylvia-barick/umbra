"use client";

import { useEffect, useState } from "react";
import { oracleAdapterClient, unwrap } from "@/lib/contracts";
import { READ_ONLY_ACCOUNT, underlyingAssetNative } from "@/lib/stellar";
import { toBig } from "@/lib/format";

export interface SpotInfo {
  price: bigint | null;
  updatedAt: number | null;
  realizedVolBps: number | null; // 1e-6 scale from get_realized_vol, kept as raw number
  loading: boolean;
}

const POLL_MS = 20_000;

export function useSpot(refreshKey: number): SpotInfo {
  const [price, setPrice] = useState<bigint | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [realizedVolBps, setRealizedVolBps] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const oracle = await oracleAdapterClient(READ_ONLY_ACCOUNT);
        const asset = underlyingAssetNative();
        const [priceTx, volTx] = await Promise.allSettled([
          oracle.get_price({ asset }),
          oracle.get_realized_vol({ asset }),
        ]);
        if (cancelled) return;
        if (priceTx.status === "fulfilled") {
          try {
            const [p, ts] = unwrap(priceTx.value.result);
            setPrice(toBig(p));
            setUpdatedAt(Number(toBig(ts)));
          } catch {
            // StalePrice/PriceUnavailable — leave price as-is, try again next poll.
          }
        }
        if (volTx.status === "fulfilled") {
          try {
            setRealizedVolBps(unwrap(volTx.value.result));
          } catch {
            // InsufficientHistory until enough nudge_volatility samples land — expected pre-warmup state.
            setRealizedVolBps(null);
          }
        } else {
          setRealizedVolBps(null);
        }
      } catch {
        // Client construction or the network call itself failed — try again next poll.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshKey]);

  return { price, updatedAt, realizedVolBps, loading };
}
