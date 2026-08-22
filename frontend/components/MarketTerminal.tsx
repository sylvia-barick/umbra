"use client";

import { SeriesRow } from "@/hooks/useUmbraData";
import { SpotInfo } from "@/hooks/useSpot";
import { PriceHistory } from "@/hooks/usePriceHistory";
import { ActivityItem } from "@/lib/activity";
import { PriceChart } from "@/components/PriceChart";
import { PayoffDiagram } from "@/components/PayoffDiagram";
import { OptionChain } from "@/components/OptionChain";
import { OrderForm } from "@/components/OrderForm";
import { ActivityFeed } from "@/components/ActivityFeed";
import { PositionsPanel } from "@/components/PositionsPanel";
import { formatFixed } from "@/lib/format";
import { PositionRow } from "@/lib/positions";

interface MarketTerminalProps {
  series: SeriesRow[];
  loading: boolean;
  selected: { row: SeriesRow; side: "call" | "put" } | null;
  onSelect: (row: SeriesRow, side: "call" | "put") => void;
  onCreateSeries: () => void;
  onTraded: () => void;
  positions: PositionRow[];
  loadingPositions: boolean;
  onOpenTrade: (row: SeriesRow, side: "call" | "put") => void;
  tokenSymbol: string;
  tokenDecimals: number;
  priceDecimals: number;
  underlyingSymbol: string;
  spot: SpotInfo;
  history: PriceHistory;
  activityItems: ActivityItem[];
  activityLoading: boolean;
}

/**
 * The single-screen trading terminal: chart+payoff center stage, the option
 * chain and order ticket on the right, positions and activity always
 * visible at the bottom. Everything here reads from the same hooks the rest
 * of the app already uses — this is a layout, not new data plumbing.
 */
export function MarketTerminal({
  series,
  loading,
  selected,
  onSelect,
  onCreateSeries,
  onTraded,
  positions,
  loadingPositions,
  onOpenTrade,
  tokenSymbol,
  tokenDecimals,
  priceDecimals,
  underlyingSymbol,
  spot,
  history,
  activityItems,
  activityLoading,
}: MarketTerminalProps) {
  const strikeNum = selected ? Number(selected.row.info.strike) / 10 ** priceDecimals : null;
  const quote = selected ? (selected.side === "call" ? selected.row.callQuote : selected.row.putQuote) : null;
  const premiumPerUnitNum = quote !== null ? Number(quote) / 10 ** tokenDecimals : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* CENTER: chart + payoff */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-umbra-border">
          <div className="flex flex-[1.3] flex-col border-b border-umbra-border">
            <div className="flex items-center justify-between border-b border-umbra-border px-4 py-2.5">
              <div className="flex items-baseline gap-2.5">
                <span className="text-sm font-semibold text-umbra-ink">{underlyingSymbol} / USD</span>
                <span className="text-xs text-umbra-faint">Reflector spot feed</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-base font-bold tabular text-umbra-ink">
                  {spot.price !== null ? formatFixed(spot.price, priceDecimals, 4) : "—"}
                </span>
                {history.changePct !== null && (
                  <span className={`font-mono text-xs tabular ${history.changePct >= 0 ? "text-umbra-call" : "text-umbra-put"}`}>
                    {history.changePct >= 0 ? "+" : ""}
                    {history.changePct.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 p-2">
              <PriceChart points={history.points} strike={strikeNum} loading={history.loading} />
            </div>
          </div>

          <div className="flex flex-1 flex-col">
            <div className="border-b border-umbra-border px-4 py-2.5">
              <div className="text-sm font-semibold text-umbra-ink">Payoff at expiry</div>
              {selected && (
                <div className="text-xs text-umbra-faint">
                  {underlyingSymbol} ${formatFixed(selected.row.info.strike, priceDecimals, 2)} {selected.side} · #
                  {selected.row.id.toString()}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 p-3">
              {selected && strikeNum !== null ? (
                <PayoffDiagram
                  side={selected.side}
                  strike={strikeNum}
                  premiumPerUnit={premiumPerUnitNum}
                  spot={spot.price !== null ? Number(spot.price) / 10 ** priceDecimals : null}
                  tokenSymbol={tokenSymbol}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-umbra-faint">
                  Select a series from the option chain to see its payoff.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: option chain + order ticket */}
        <div className="flex w-[380px] shrink-0 flex-col">
          <div className="min-h-0 flex-[1.4] border-b border-umbra-border">
            <OptionChain
              series={series}
              loading={loading}
              selected={selected}
              tokenSymbol={tokenSymbol}
              tokenDecimals={tokenDecimals}
              priceDecimals={priceDecimals}
              onSelect={onSelect}
              onCreateSeries={onCreateSeries}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selected ? (
              <OrderForm
                key={`${selected.row.id.toString()}-${selected.side}`}
                row={selected.row}
                initialSide={selected.side}
                onSuccess={onTraded}
                tokenSymbol={tokenSymbol}
                tokenDecimals={tokenDecimals}
                priceDecimals={priceDecimals}
                underlyingSymbol={underlyingSymbol}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-center text-xs text-umbra-faint">
                Pick a strike to trade.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM: positions + activity */}
      <div className="flex h-[220px] shrink-0 border-t border-umbra-border">
        <div className="min-w-0 flex-[1.7] border-r border-umbra-border">
          <PositionsPanel
            positions={positions}
            loading={loadingPositions}
            series={series}
            tokenSymbol={tokenSymbol}
            tokenDecimals={tokenDecimals}
            priceDecimals={priceDecimals}
            underlyingSymbol={underlyingSymbol}
            onOpenTrade={onOpenTrade}
            onChanged={onTraded}
          />
        </div>
        <div className="min-w-0 flex-1">
          <ActivityFeed items={activityItems} loading={activityLoading} />
        </div>
      </div>
    </div>
  );
}
