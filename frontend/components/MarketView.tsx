"use client";

import { SeriesRow } from "@/hooks/useUmbraData";
import { useSpot } from "@/hooks/useSpot";
import { useActivity } from "@/hooks/useActivity";
import { tradingViewSymbol } from "@/lib/tradingview";
import { TickerBar } from "@/components/TickerBar";
import { TradingViewChart } from "@/components/TradingViewChart";
import { StrikeRail } from "@/components/StrikeRail";
import { OrderForm } from "@/components/OrderForm";
import { ActivityFeed } from "@/components/ActivityFeed";

interface MarketViewProps {
  series: SeriesRow[];
  loading: boolean;
  selected: { row: SeriesRow; side: "call" | "put" } | null;
  onSelect: (row: SeriesRow, side: "call" | "put") => void;
  onCreateSeries: () => void;
  onTraded: () => void;
  tokenSymbol: string;
  tokenDecimals: number;
  priceDecimals: number;
  underlyingSymbol: string;
  refreshKey: number;
}

/**
 * Terminal-style trade layout: one bordered grid with hairline dividers
 * between panels — chart, strikes, and the order form sit flush against
 * each other, no floating cards or gutters, matching a perp-DEX trade page
 * rather than a dashboard of widgets.
 */
export function MarketView({
  series,
  loading,
  selected,
  onSelect,
  onCreateSeries,
  onTraded,
  tokenSymbol,
  tokenDecimals,
  priceDecimals,
  underlyingSymbol,
  refreshKey,
}: MarketViewProps) {
  const spot = useSpot(refreshKey);
  const activity = useActivity(tokenDecimals, priceDecimals, refreshKey);

  return (
    <div className="grid grid-cols-1 border border-umbra-border lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 border-b border-umbra-border lg:border-b-0 lg:border-r">
        <TickerBar underlyingSymbol={underlyingSymbol} priceDecimals={priceDecimals} spot={spot} />
        <TradingViewChart symbol={tradingViewSymbol(underlyingSymbol)} height={560} />
        <StrikeRail
          series={series}
          loading={loading}
          selectedId={selected?.row.id ?? null}
          priceDecimals={priceDecimals}
          onSelect={(row) => onSelect(row, selected?.side ?? "call")}
          onCreateSeries={onCreateSeries}
        />
        <ActivityFeed items={activity.items} loading={activity.loading} />
      </div>

      <div className="bg-umbra-panel lg:sticky lg:top-16 lg:self-start">
        {selected ? (
          <div className="px-5 py-5">
            <OrderForm
              key={selected.row.id.toString()}
              row={selected.row}
              initialSide={selected.side}
              onSuccess={onTraded}
              tokenSymbol={tokenSymbol}
              tokenDecimals={tokenDecimals}
              priceDecimals={priceDecimals}
              underlyingSymbol={underlyingSymbol}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
            <p className="text-sm text-umbra-muted">
              {loading ? "Loading series…" : "No series yet — create one to start trading."}
            </p>
            {!loading && (
              <button onClick={onCreateSeries} className="text-sm font-medium text-umbra-violet-glow hover:underline">
                Create the first one →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
