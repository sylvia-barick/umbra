"use client";

import { SeriesRow } from "@/hooks/useUmbraData";
import { formatCountdown, formatFixed } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

interface StrikeRailProps {
  series: SeriesRow[];
  loading: boolean;
  selectedId: bigint | null;
  priceDecimals: number;
  onSelect: (row: SeriesRow) => void;
  onCreateSeries: () => void;
}

/** Contract selector strip — the row of instruments a perp DEX would list
 * under a symbol dropdown, flattened into a scrollable row of strikes. */
export function StrikeRail({ series, loading, selectedId, priceDecimals, onSelect, onCreateSeries }: StrikeRailProps) {
  if (loading && series.length === 0) {
    return (
      <div className="flex gap-px overflow-x-auto border-t border-umbra-border bg-umbra-bg">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 w-32 shrink-0" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-stretch divide-x divide-umbra-border overflow-x-auto border-t border-umbra-border bg-umbra-bg">
      {series.map((row) => {
        const expired = row.info.expiry <= BigInt(Math.floor(Date.now() / 1000));
        const active = selectedId === row.id;
        return (
          <button
            key={row.id.toString()}
            onClick={() => onSelect(row)}
            className={`flex shrink-0 items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
              active ? "bg-umbra-violet/10" : "hover:bg-white/[0.03]"
            }`}
          >
            <span className={`font-mono text-sm font-semibold tabular ${active ? "text-umbra-violet-glow" : "text-umbra-ink"}`}>
              ${formatFixed(row.info.strike, priceDecimals, 2)}
            </span>
            <span className={`text-[11px] ${expired ? "text-umbra-warn" : "text-umbra-faint"}`}>
              {expired ? "expired" : formatCountdown(row.info.expiry)}
            </span>
          </button>
        );
      })}
      <button
        onClick={onCreateSeries}
        className="flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-umbra-faint transition-colors hover:bg-white/[0.03] hover:text-umbra-violet-glow"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New series
      </button>
    </div>
  );
}
