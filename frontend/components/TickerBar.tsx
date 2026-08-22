"use client";

import { SpotInfo } from "@/hooks/useSpot";
import { formatFixed } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

interface TickerBarProps {
  underlyingSymbol: string;
  priceDecimals: number;
  spot: SpotInfo;
}

/** Dense, borderless stat row — the Mark/Oracle/24h-change strip a perp DEX
 * puts directly above its chart, not a boxed card of its own. */
export function TickerBar({ underlyingSymbol, priceDecimals, spot }: TickerBarProps) {
  const stale = spot.updatedAt !== null && Date.now() / 1000 - spot.updatedAt > 600;

  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-umbra-border bg-umbra-panel px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-umbra-warn" : "bg-umbra-call animate-pulse-soft"}`} />
        <span className="font-mono text-base font-semibold tabular text-umbra-ink">{underlyingSymbol}-USDC</span>
      </div>

      <Stat label="Oracle" value={spot.price !== null ? `$${formatFixed(spot.price, priceDecimals, 6)}` : "—"} loading={spot.loading} accent />
      <Stat label="Feed" value={stale ? "Stale" : "Live"} tone={stale ? "warn" : "call"} />
      <Stat
        label="Realized vol (ann.)"
        value={spot.realizedVolBps !== null ? `${(spot.realizedVolBps / 10_000).toFixed(1)}%` : "warming up"}
      />
      <Stat label="Settlement" value="European · cash" />
      <Stat label="Collateral" value="Full · 1:1" />
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  accent,
  tone,
}: {
  label: string;
  value: string;
  loading?: boolean;
  accent?: boolean;
  tone?: "warn" | "call";
}) {
  const toneColor = tone === "warn" ? "text-umbra-warn" : tone === "call" ? "text-umbra-call" : undefined;
  return (
    <div className="flex flex-col gap-0.5 leading-none">
      <span className="text-[10px] uppercase tracking-wide text-umbra-faint">{label}</span>
      {loading ? (
        <Skeleton className="h-4 w-16" />
      ) : (
        <span
          className={`font-mono text-[13px] tabular ${toneColor ?? (accent ? "text-umbra-violet-glow" : "text-umbra-ink")}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}
