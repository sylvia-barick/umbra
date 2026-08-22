"use client";

import { useEffect, useState } from "react";

interface Sample {
  t: number; // unix seconds
  v: number; // share price, human-scaled
}

const MAX_SAMPLES = 200;
const MIN_SPAN_SECS = 3600; // don't extrapolate an APY from less than an hour of observed history

function storageKey(contractId: string) {
  return `umbra:vault-history:${contractId}`;
}

/**
 * Persists share_price samples to localStorage per vault contract and
 * derives a sparkline + an annualized return from the observed span —
 * this is real (if noisy) data the app has actually seen, not a fabricated
 * APY figure. Returns null for the rate until there's enough history to
 * extrapolate from, rather than showing a number that isn't earned yet.
 */
export function useVaultHistory(contractId: string, sharePrice: bigint | null, tokenDecimals: number) {
  const [points, setPoints] = useState<Sample[]>([]);

  useEffect(() => {
    if (sharePrice === null) return;
    const value = Number(sharePrice) / 10 ** tokenDecimals;
    if (!Number.isFinite(value)) return;

    let history: Sample[] = [];
    try {
      const raw = localStorage.getItem(storageKey(contractId));
      history = raw ? (JSON.parse(raw) as Sample[]) : [];
    } catch {
      history = [];
    }

    const now = Math.floor(Date.now() / 1000);
    history.push({ t: now, v: value });
    if (history.length > MAX_SAMPLES) history = history.slice(history.length - MAX_SAMPLES);

    try {
      localStorage.setItem(storageKey(contractId), JSON.stringify(history));
    } catch {
      // best-effort only — a full/blocked storage just means no sparkline this session
    }
    setPoints(history);
  }, [contractId, sharePrice, tokenDecimals]);

  const first = points[0];
  const last = points[points.length - 1];
  const spanSecs = first && last ? last.t - first.t : 0;
  const annualizedPct =
    first && last && spanSecs >= MIN_SPAN_SECS && first.v > 0
      ? ((last.v / first.v - 1) * ((365 * 86400) / spanSecs)) * 100
      : null;

  return { points, annualizedPct };
}
