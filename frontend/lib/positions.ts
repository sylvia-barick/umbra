import { SeriesRow } from "@/hooks/useUmbraData";
import { Side } from "@/lib/contracts";

export interface PositionRow {
  seriesId: bigint;
  side: Side;
  sideLabel: "Call" | "Put";
  size: bigint;
  premiumPaid: bigint;
}

/** Marks a position to the AMM's own current quote for that series/side —
 * "what it would fetch if sold right now", the same number the trade panel
 * already shows, not a separate valuation model. Null when no live quote
 * is available yet (e.g. InsufficientHistory) rather than a misleading 0. */
export function markToMarket(
  p: PositionRow,
  info: SeriesRow | undefined,
  priceDecimals: number,
): { value: bigint; pnl: bigint } | null {
  if (!info) return null;
  const quote = p.sideLabel === "Call" ? info.callQuote : info.putQuote;
  if (quote === null) return null;
  const priceScale = 10n ** BigInt(priceDecimals);
  const value = (quote * p.size) / priceScale;
  return { value, pnl: value - p.premiumPaid };
}

export interface PortfolioSummary {
  markedValue: bigint; // sum of position mark values that have a live quote
  pnl: bigint;
  partial: boolean; // true if some positions couldn't be marked (no live quote yet)
}

export function summarizePositions(positions: PositionRow[], series: SeriesRow[], priceDecimals: number): PortfolioSummary | null {
  const marks = positions.map((p) => markToMarket(p, series.find((s) => s.id === p.seriesId), priceDecimals));
  const withMtm = marks.filter((m): m is { value: bigint; pnl: bigint } => m !== null);
  if (withMtm.length === 0) return null;
  return {
    markedValue: withMtm.reduce((sum, m) => sum + m.value, 0n),
    pnl: withMtm.reduce((sum, m) => sum + m.pnl, 0n),
    partial: withMtm.length < positions.length,
  };
}
