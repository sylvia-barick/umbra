"use client";

import { useEffect, useState } from "react";
import { reflectorClient, unwrap } from "@/lib/contracts";
import { READ_ONLY_ACCOUNT, underlyingAssetNative } from "@/lib/stellar";
import { toBig } from "@/lib/format";

export interface PricePoint {
  time: number; // unix seconds
  value: number; // human-scaled price
}

export interface PriceHistory {
  points: PricePoint[];
  changePct: number | null;
  loading: boolean;
}

const RECORDS = 24;
const POLL_MS = 30_000;

/** Real spot-price history straight from Reflector — the same feed
 * oracle-adapter reads, not a synthetic candle series — so the strike/payoff
 * overlays drawn against it are honest to what's actually being traded. */
export function usePriceHistory(priceDecimals: number): PriceHistory {
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const reflector = await reflectorClient(READ_ONLY_ACCOUNT);
        const asset = underlyingAssetNative();
        const tx = await reflector.prices({ asset, records: RECORDS });
        if (cancelled) return;
        const raw = unwrap(tx.result) ?? [];
        const sorted = [...raw]
          .map((p) => ({ time: Number(toBig(p.timestamp)), value: Number(toBig(p.price)) / 10 ** priceDecimals }))
          .filter((p) => Number.isFinite(p.value))
          .sort((a, b) => a.time - b.time)
          .filter((p, i, arr) => i === 0 || p.time > arr[i - 1].time);
        setPoints(sorted);
      } catch {
        if (!cancelled) setPoints([]);
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
  }, [priceDecimals]);

  const spot = points.length > 0 ? points[points.length - 1].value : null;
  const dayAgo = points.length > 0 ? points[points.length - 1].time - 86400 : 0;
  const reference = points.find((p) => p.time >= dayAgo) ?? points[0];
  const changePct = spot !== null && reference && reference.value > 0 ? ((spot - reference.value) / reference.value) * 100 : null;

  return { points, changePct, loading };
}
