"use client";

import { SeriesRow } from "@/hooks/useUmbraData";
import { useSpot } from "@/hooks/useSpot";
import { tradingViewSymbol } from "@/lib/tradingview";
import { TickerBar } from "@/components/TickerBar";
import { TradingViewChart } from "@/components/TradingViewChart";
import { StrikeRail } from "@/components/StrikeRail";
import { OrderForm } from "@/components/OrderForm";
import { Card, CardBody } from "@/components/ui/Card";

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

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
      <div className="min-w-0 space-y-4">
        <TickerBar underlyingSymbol={underlyingSymbol} priceDecimals={priceDecimals} spot={spot} />
        <TradingViewChart symbol={tradingViewSymbol(underlyingSymbol)} />
        <StrikeRail
          series={series}
          loading={loading}
          selectedId={selected?.row.id ?? null}
          tokenDecimals={tokenDecimals}
          onSelect={(row) => onSelect(row, selected?.side ?? "call")}
          onCreateSeries={onCreateSeries}
        />
      </div>

      <div className="lg:sticky lg:top-24">
        {selected ? (
          <Card>
            <CardBody>
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
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody className="flex flex-col items-center gap-3 py-14 text-center">
              <p className="text-sm text-umbra-muted">
                {loading ? "Loading series…" : "No series yet — create one to start trading."}
              </p>
              {!loading && (
                <button onClick={onCreateSeries} className="text-sm font-medium text-umbra-violet-glow hover:underline">
                  Create the first one →
                </button>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
