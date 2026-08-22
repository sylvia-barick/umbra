"use client";

import { SeriesRow } from "@/hooks/useUmbraData";
import { formatCountdown, formatFixed } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

interface StrikeRailProps {
  series: SeriesRow[];
  loading: boolean;
  selectedId: bigint | null;
  tokenDecimals: number;
  onSelect: (row: SeriesRow) => void;
  onCreateSeries: () => void;
}

export function StrikeRail({ series, loading, selectedId, tokenDecimals, onSelect, onCreateSeries }: StrikeRailProps) {
  if (loading && series.length === 0) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-40 shrink-0 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {series.map((row) => {
        const expired = row.info.expiry <= BigInt(Math.floor(Date.now() / 1000));
        const active = selectedId === row.id;
        return (
          <button
            key={row.id.toString()}
            onClick={() => onSelect(row)}
            className={`flex shrink-0 flex-col gap-1 rounded-xl border px-4 py-2.5 text-left transition-colors ${
              active
                ? "border-umbra-violet/60 bg-umbra-violet/10"
                : "border-umbra-border bg-umbra-panel hover:border-umbra-border-strong"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold tabular text-umbra-ink">
                ${formatFixed(row.info.strike, tokenDecimals, 2)}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-umbra-faint">#{row.id.toString()}</span>
            </div>
            <span className={`text-[11px] ${expired ? "text-umbra-warn" : "text-umbra-faint"}`}>
              {expired ? "expired" : formatCountdown(row.info.expiry)}
            </span>
          </button>
        );
      })}
      <button
        onClick={onCreateSeries}
        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-umbra-border px-4 py-2.5 text-sm text-umbra-faint transition-colors hover:border-umbra-violet/50 hover:text-umbra-violet-glow"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New series
      </button>
    </div>
  );
}
