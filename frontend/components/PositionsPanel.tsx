"use client";

import { useMemo } from "react";
import { useWallet } from "@/app/providers";
import { SeriesRow } from "@/hooks/useUmbraData";
import { settlementKeeperClient } from "@/lib/contracts";
import { formatFixed, formatSigned } from "@/lib/format";
import { markToMarket, PositionRow } from "@/lib/positions";
import { useTx } from "@/hooks/useTx";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface PositionsPanelProps {
  positions: PositionRow[];
  loading: boolean;
  series: SeriesRow[];
  tokenSymbol: string;
  tokenDecimals: number;
  priceDecimals: number;
  underlyingSymbol: string;
  onOpenTrade: (row: SeriesRow, side: "call" | "put") => void;
  onChanged: () => void;
}

/** Dense positions table for the bottom strip — Series/Side/Size/Entry/Mark/
 * P&L columns, sitting alongside Activity instead of a full-width tab of
 * its own, so both stay visible without switching views. */
export function PositionsPanel({
  positions,
  loading,
  series,
  tokenSymbol,
  tokenDecimals,
  priceDecimals,
  underlyingSymbol,
  onOpenTrade,
  onChanged,
}: PositionsPanelProps) {
  const wallet = useWallet();
  const { run, busy } = useTx();

  const rows = useMemo(
    () =>
      positions.map((p) => {
        const row = series.find((s) => s.id === p.seriesId);
        return { p, row, mtm: markToMarket(p, row, priceDecimals) };
      }),
    [positions, series, priceDecimals],
  );

  const totals = useMemo(() => {
    const withMtm = rows.filter((r) => r.mtm !== null);
    if (withMtm.length === 0) return null;
    const pnl = withMtm.reduce((sum, r) => sum + r.mtm!.pnl, 0n);
    return { pnl, partial: withMtm.length < rows.length };
  }, [rows]);

  async function settle(seriesId: bigint) {
    if (!wallet.address) return;
    await run(
      async () => {
        const client = await settlementKeeperClient(wallet.address, wallet.signTransaction);
        return (await client.settle({ caller: wallet.address!, series_id: seriesId })).signAndSend();
      },
      { pendingTitle: `Settling series #${seriesId}…`, successTitle: `Settled series #${seriesId}` },
    );
    onChanged();
  }

  const now = BigInt(Math.floor(Date.now() / 1000));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-4 border-b border-umbra-border px-4 py-2">
        <span className="text-sm font-semibold text-umbra-ink">Positions</span>
        {totals && (
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            <span className="text-umbra-faint">Total{totals.partial ? " (partial)" : ""}</span>
            <span className={`font-mono font-semibold tabular ${totals.pnl >= 0n ? "text-umbra-call" : "text-umbra-put"}`}>
              {formatSigned(totals.pnl, tokenDecimals)} {tokenSymbol}
            </span>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!wallet.connected ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-umbra-muted">Connect your wallet to see your positions.</p>
            <Button size="sm" onClick={wallet.connect} loading={wallet.connecting}>
              Connect Freighter
            </Button>
          </div>
        ) : !loading && positions.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-umbra-muted">
            No open positions — buy a call or put to get started.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1.6fr_0.6fr_0.7fr_0.9fr_0.9fr_1fr_auto] gap-2 px-4 py-1 text-[10px] uppercase tracking-wide text-umbra-faint">
              <span>Series</span>
              <span>Side</span>
              <span className="text-right">Size</span>
              <span className="text-right">Entry</span>
              <span className="text-right">Mark</span>
              <span className="text-right">P&L</span>
              <span />
            </div>
            {rows.map(({ p, row, mtm }) => {
              const info = row?.info;
              const expired = info ? info.expiry <= now : false;
              return (
                <div
                  key={`${p.seriesId}-${p.sideLabel}`}
                  className="grid grid-cols-[1.6fr_0.6fr_0.7fr_0.9fr_0.9fr_1fr_auto] items-center gap-2 border-t border-umbra-border-soft px-4 py-1.5"
                >
                  <span className="truncate font-mono text-xs tabular text-umbra-ink">
                    {underlyingSymbol} {info ? `$${formatFixed(info.strike, priceDecimals, 2)}` : ""} #{p.seriesId.toString()}
                  </span>
                  <Badge tone={p.sideLabel === "Call" ? "call" : "put"}>{p.sideLabel}</Badge>
                  <span className="text-right font-mono text-xs tabular text-umbra-muted">
                    {formatFixed(p.size, priceDecimals)}
                  </span>
                  <span className="text-right font-mono text-xs tabular text-umbra-muted">
                    {formatFixed(p.premiumPaid, tokenDecimals)}
                  </span>
                  <span className="text-right font-mono text-xs tabular text-umbra-ink">
                    {mtm ? formatFixed(mtm.value, tokenDecimals) : "—"}
                  </span>
                  <span
                    className={`text-right font-mono text-xs font-medium tabular ${
                      mtm ? (mtm.pnl >= 0n ? "text-umbra-call" : "text-umbra-put") : "text-umbra-faint"
                    }`}
                  >
                    {mtm ? formatSigned(mtm.pnl, tokenDecimals) : "—"}
                  </span>
                  {expired ? (
                    <Button size="sm" variant="secondary" loading={busy} onClick={() => settle(p.seriesId)}>
                      Settle
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (row) onOpenTrade(row, p.sideLabel === "Call" ? "call" : "put");
                      }}
                    >
                      Manage
                    </Button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
