"use client";

import { useMemo } from "react";
import { SeriesRow } from "@/hooks/useUmbraData";
import { formatDate, formatFixed } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

interface OptionChainProps {
  series: SeriesRow[];
  loading: boolean;
  selected: { row: SeriesRow; side: "call" | "put" } | null;
  tokenSymbol: string;
  tokenDecimals: number;
  priceDecimals: number;
  onSelect: (row: SeriesRow, side: "call" | "put") => void;
  onCreateSeries: () => void;
}

/**
 * The strike ladder — Umbra's equivalent of an order book. Not new backend
 * work: it's the same quote() the order ticket already calls, laid out
 * across every existing series (grouped by expiry, sorted by strike) rather
 * than shown one at a time. There's no cartesian grid of "all possible
 * strikes" — series are permissionlessly created ad hoc, so a row only
 * exists once someone has actually created that strike/expiry.
 */
export function OptionChain({
  series,
  loading,
  selected,
  tokenSymbol,
  tokenDecimals,
  priceDecimals,
  onSelect,
  onCreateSeries,
}: OptionChainProps) {
  const groups = useMemo(() => {
    const byExpiry = new Map<string, SeriesRow[]>();
    for (const row of series) {
      const key = row.info.expiry.toString();
      const list = byExpiry.get(key) ?? [];
      list.push(row);
      byExpiry.set(key, list);
    }
    return [...byExpiry.entries()]
      .sort((a, b) => Number(BigInt(a[0]) - BigInt(b[0])))
      .map(([, rows]) => rows.sort((a, b) => Number(a.info.strike - b.info.strike)));
  }, [series]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-umbra-border px-4 py-2.5">
        <span className="text-sm font-semibold text-umbra-ink">Option chain</span>
        <button onClick={onCreateSeries} className="text-xs font-medium text-umbra-violet-glow hover:underline">
          + New series
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && series.length === 0 ? (
          <div className="space-y-px p-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <p className="text-sm text-umbra-muted">No series yet.</p>
            <button onClick={onCreateSeries} className="text-sm font-medium text-umbra-violet-glow hover:underline">
              Create the first one →
            </button>
          </div>
        ) : (
          groups.map((rows) => {
            const expiry = rows[0].info.expiry;
            const now = BigInt(Math.floor(Date.now() / 1000));
            const expired = expiry <= now;
            return (
              <div key={expiry.toString()}>
                <div className="flex items-center justify-between border-b border-umbra-border bg-umbra-bg px-4 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-umbra-muted">
                    {formatDate(expiry)}
                  </span>
                  <span className={`text-[10px] ${expired ? "text-umbra-warn" : "text-umbra-faint"}`}>
                    {expired ? "expired" : "open"}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] px-4 py-1 text-[10px] uppercase tracking-wide text-umbra-faint">
                  <span>Strike</span>
                  <span className="text-right">Call</span>
                  <span className="text-right">Put</span>
                </div>
                {rows.map((row) => {
                  const isSelected = selected?.row.id === row.id;
                  return (
                    <div
                      key={row.id.toString()}
                      className={`grid grid-cols-[1fr_1fr_1fr] items-center border-t border-umbra-border-soft px-4 py-2 ${
                        isSelected ? "bg-umbra-violet/10" : ""
                      }`}
                    >
                      <span className="font-mono text-xs font-semibold tabular text-umbra-ink">
                        ${formatFixed(row.info.strike, priceDecimals, 2)}
                      </span>
                      <ChainCell
                        quote={row.callQuote}
                        active={isSelected && selected?.side === "call"}
                        tone="call"
                        tokenDecimals={tokenDecimals}
                        disabled={expired}
                        onClick={() => onSelect(row, "call")}
                      />
                      <ChainCell
                        quote={row.putQuote}
                        active={isSelected && selected?.side === "put"}
                        tone="put"
                        tokenDecimals={tokenDecimals}
                        disabled={expired}
                        onClick={() => onSelect(row, "put")}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
      <div className="border-t border-umbra-border px-4 py-1.5 text-right text-[10px] text-umbra-faint">
        premiums in {tokenSymbol}
      </div>
    </div>
  );
}

function ChainCell({
  quote,
  active,
  tone,
  tokenDecimals,
  disabled,
  onClick,
}: {
  quote: bigint | null;
  active: boolean;
  tone: "call" | "put";
  tokenDecimals: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const color = tone === "call" ? "text-umbra-call" : "text-umbra-put";
  return (
    <button
      onClick={onClick}
      disabled={disabled || quote === null}
      className={`rounded px-1.5 py-0.5 text-right font-mono text-xs tabular transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-white/10" : "hover:bg-white/5"
      } ${color}`}
    >
      {quote !== null ? formatFixed(quote, tokenDecimals) : "—"}
    </button>
  );
}
