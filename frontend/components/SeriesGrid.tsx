"use client";

import { SeriesRow } from "@/hooks/useUmbraData";
import { SeriesCard } from "@/components/SeriesCard";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

interface SeriesGridProps {
  series: SeriesRow[];
  loading: boolean;
  tokenSymbol: string;
  tokenDecimals: number;
  underlyingSymbol: string;
  onTrade: (row: SeriesRow, side: "call" | "put") => void;
  onCreateSeries: () => void;
}

export function SeriesGrid({
  series,
  loading,
  tokenSymbol,
  tokenDecimals,
  underlyingSymbol,
  onTrade,
  onCreateSeries,
}: SeriesGridProps) {
  if (loading && series.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="mb-3 h-6 w-32" />
            <Skeleton className="mb-2 h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <p className="text-sm text-umbra-muted">No option series yet on this deployment.</p>
        <button
          onClick={onCreateSeries}
          className="text-sm font-medium text-umbra-violet-glow hover:underline"
        >
          Create the first one →
        </button>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {series.map((row) => (
        <SeriesCard
          key={row.id.toString()}
          row={row}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          underlyingSymbol={underlyingSymbol}
          onTrade={onTrade}
        />
      ))}
      <button
        onClick={onCreateSeries}
        className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-umbra-border text-umbra-faint transition-colors hover:border-umbra-violet/50 hover:text-umbra-violet-glow"
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <span className="text-sm font-medium">New series</span>
      </button>
    </div>
  );
}
