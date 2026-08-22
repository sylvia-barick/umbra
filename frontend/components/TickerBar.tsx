"use client";

import { SpotInfo } from "@/hooks/useSpot";
import { formatFixed } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";

interface TickerBarProps {
  underlyingSymbol: string;
  priceDecimals: number;
  spot: SpotInfo;
}

export function TickerBar({ underlyingSymbol, priceDecimals, spot }: TickerBarProps) {
  const stale = spot.updatedAt !== null && Date.now() / 1000 - spot.updatedAt > 600;

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-3xl border border-umbra-border bg-umbra-panel px-5 py-4 shadow-panel">
      <div>
        <div className="flex items-center gap-2 text-xs text-umbra-faint">
          <span className="h-2 w-2 rounded-full bg-umbra-violet" />
          {underlyingSymbol} / USDC
        </div>
        {spot.loading ? (
          <Skeleton className="mt-1 h-8 w-32" />
        ) : (
          <div className="mt-0.5 font-mono text-2xl font-semibold tabular text-umbra-ink">
            {spot.price !== null ? `$${formatFixed(spot.price, priceDecimals, 6)}` : "—"}
          </div>
        )}
      </div>

      <Stat label="Reflector oracle" value={stale ? "stale feed" : "live"} tone={stale ? "warn" : "call"} />

      <Stat
        label="Realized vol (ann.)"
        value={spot.realizedVolBps !== null ? `${(spot.realizedVolBps / 10_000).toFixed(1)}%` : "warming up"}
      />

      <Stat label="Settlement style" value="European · cash" />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "call" }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-umbra-faint">{label}</span>
      {tone ? (
        <Badge tone={tone}>{value}</Badge>
      ) : (
        <span className="font-mono text-sm tabular text-umbra-ink">{value}</span>
      )}
    </div>
  );
}
