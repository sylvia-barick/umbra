"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ammPoolClient,
  CALL,
  optionsFactoryClient,
  oracleAdapterClient,
  PUT,
  Side,
  SeriesInfo,
  tokenClient,
  vaultAccountingClient,
} from "@/lib/contracts";
import { READ_ONLY_ACCOUNT, underlyingAssetNative } from "@/lib/stellar";
import { toBig } from "@/lib/format";

export interface SeriesRow {
  id: bigint;
  info: SeriesInfo;
  callQuote: bigint | null;
  putQuote: bigint | null;
  callError: string | null;
  putError: string | null;
}

const MAX_SERIES_PROBE = 50;

async function fetchQuote(readAddr: string, seriesId: bigint, side: Side): Promise<bigint> {
  const client = await ammPoolClient(readAddr);
  const tx = await client.quote({ series_id: seriesId, side });
  return toBig(tx.result);
}

/** Normalizes a decoded SeriesInfo's numeric fields — see `toBig`. */
function normalizeSeriesInfo(info: SeriesInfo): SeriesInfo {
  return { ...info, strike: toBig(info.strike), expiry: toBig(info.expiry), created_at: toBig(info.created_at) };
}

async function fetchSeriesRow(readAddr: string, id: bigint, rawInfo: SeriesInfo): Promise<SeriesRow> {
  const info = normalizeSeriesInfo(rawInfo);
  const [callRes, putRes] = await Promise.allSettled([
    fetchQuote(readAddr, id, CALL),
    fetchQuote(readAddr, id, PUT),
  ]);
  return {
    id,
    info,
    callQuote: callRes.status === "fulfilled" ? callRes.value : null,
    callError: callRes.status === "rejected" ? errMessage(callRes.reason) : null,
    putQuote: putRes.status === "fulfilled" ? putRes.value : null,
    putError: putRes.status === "rejected" ? errMessage(putRes.reason) : null,
  };
}

function errMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return "unavailable";
}

export interface UmbraStatics {
  priceDecimals: number;
  tokenDecimals: number;
  tokenSymbol: string;
}

export function useUmbraStatics() {
  const [statics, setStatics] = useState<UmbraStatics | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [oracle, token] = await Promise.all([
          oracleAdapterClient(READ_ONLY_ACCOUNT),
          tokenClient(READ_ONLY_ACCOUNT),
        ]);
        const [priceDecTx, tokenDecTx, symTx] = await Promise.all([
          oracle.decimals(),
          token.decimals(),
          token.symbol().catch(() => null),
        ]);
        if (cancelled) return;
        setStatics({
          priceDecimals: priceDecTx.result,
          tokenDecimals: tokenDecTx.result,
          tokenSymbol: symTx?.result ?? "USDC",
        });
      } catch {
        if (!cancelled) setStatics({ priceDecimals: 14, tokenDecimals: 7, tokenSymbol: "USDC" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return statics;
}

export function useSeriesList(readAddr: string, refreshKey: number) {
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const factory = await optionsFactoryClient(readAddr);
      const rows: SeriesRow[] = [];
      for (let id = 1n; id <= BigInt(MAX_SERIES_PROBE); id++) {
        try {
          const tx = await factory.get_series({ series_id: id });
          const row = await fetchSeriesRow(readAddr, id, tx.result);
          if (cancelled) return;
          rows.push(row);
          setSeries([...rows].sort((a, b) => Number(a.info.expiry - b.info.expiry)));
        } catch {
          break;
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readAddr, refreshKey]);

  return { series, loading };
}

export function useVaultStats(readAddr: string, refreshKey: number) {
  const [sharePrice, setSharePrice] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const vault = await vaultAccountingClient(readAddr);
        const tx = await vault.share_price();
        if (!cancelled) setSharePrice(toBig(tx.result));
      } catch {
        if (!cancelled) setSharePrice(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readAddr, refreshKey]);

  return { sharePrice, loading };
}

export function useTokenBalance(address: string | null, refreshKey: number) {
  const [balance, setBalance] = useState<bigint | null>(null);

  const load = useCallback(async () => {
    if (!address) {
      setBalance(null);
      return;
    }
    try {
      const token = await tokenClient(address);
      const tx = await token.balance({ id: address });
      setBalance(toBig(tx.result));
    } catch {
      setBalance(null);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return balance;
}

export function usePositions(address: string | null, series: SeriesRow[], refreshKey: number) {
  const [positions, setPositions] = useState<
    Array<{ seriesId: bigint; side: Side; sideLabel: "Call" | "Put"; size: bigint; premiumPaid: bigint }>
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || series.length === 0) {
      setPositions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const amm = await ammPoolClient(address);
      const results: Array<{ seriesId: bigint; side: Side; sideLabel: "Call" | "Put"; size: bigint; premiumPaid: bigint }> = [];
      for (const row of series) {
        for (const [side, label] of [[CALL, "Call"], [PUT, "Put"]] as const) {
          try {
            const tx = await amm.get_position({ holder: address, series_id: row.id, side });
            const size = toBig(tx.result.size);
            if (size > 0n) {
              results.push({ seriesId: row.id, side, sideLabel: label, size, premiumPaid: toBig(tx.result.premium_paid) });
            }
          } catch {
            // no position / read failure — skip
          }
        }
      }
      if (!cancelled) {
        setPositions(results);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, series.length, refreshKey]);

  return { positions, loading };
}

export function underlyingAsset() {
  return underlyingAssetNative();
}
