"use client";

import { useMemo } from "react";
import { useWallet } from "@/app/providers";
import { SeriesRow } from "@/hooks/useUmbraData";
import { settlementKeeperClient } from "@/lib/contracts";
import { formatFixed, formatSigned } from "@/lib/format";
import { useTx } from "@/hooks/useTx";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface PositionRow {
  seriesId: bigint;
  sideLabel: "Call" | "Put";
  size: bigint;
  premiumPaid: bigint;
}

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

/** Marks a position to the AMM's own current quote for that series/side —
 * "what it would fetch if sold right now", the same number the trade panel
 * already shows, not a separate valuation model. Null when no live quote
 * is available yet (e.g. InsufficientHistory) rather than a misleading 0. */
function markToMarket(
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
    const cost = withMtm.reduce((sum, r) => sum + r.p.premiumPaid, 0n);
    return { pnl, cost, partial: withMtm.length < rows.length };
  }, [rows]);

  if (!wallet.connected) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-14 text-center">
          <p className="text-sm text-umbra-muted">Connect your wallet to see your positions.</p>
          <Button onClick={wallet.connect} loading={wallet.connecting}>
            Connect Freighter
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (!loading && positions.length === 0) {
    return (
      <Card>
        <CardBody className="py-14 text-center text-sm text-umbra-muted">
          No open positions yet — buy a call or put from Markets to get started.
        </CardBody>
      </Card>
    );
  }

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
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-umbra-ink">Your positions</h3>
        {totals && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-umbra-faint">Unrealized P&L{totals.partial ? " (partial)" : ""}</span>
            <span className={`font-mono font-semibold tabular ${totals.pnl >= 0n ? "text-umbra-call" : "text-umbra-put"}`}>
              {formatSigned(totals.pnl, tokenDecimals)} {tokenSymbol}
            </span>
          </div>
        )}
      </CardHeader>
      <div className="divide-y divide-umbra-border-soft">
        {rows.map(({ p, row, mtm }) => {
          const info = row?.info;
          const expired = info ? info.expiry <= now : false;
          return (
            <div key={`${p.seriesId}-${p.sideLabel}`} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <Badge tone={p.sideLabel === "Call" ? "call" : "put"}>{p.sideLabel}</Badge>
                <div>
                  <div className="font-mono text-sm tabular text-umbra-ink">
                    {underlyingSymbol} {info ? `$${formatFixed(info.strike, priceDecimals, 2)}` : ""} · #{p.seriesId.toString()}
                  </div>
                  <div className="mt-0.5 text-xs text-umbra-faint">
                    {formatFixed(p.size, priceDecimals)} {underlyingSymbol} · paid{" "}
                    {formatFixed(p.premiumPaid, tokenDecimals)} {tokenSymbol}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                {mtm && (
                  <div className="text-right">
                    <div className="font-mono text-sm tabular text-umbra-ink">
                      {formatFixed(mtm.value, tokenDecimals)} {tokenSymbol}
                    </div>
                    <div className={`text-xs font-medium tabular ${mtm.pnl >= 0n ? "text-umbra-call" : "text-umbra-put"}`}>
                      {formatSigned(mtm.pnl, tokenDecimals)}
                    </div>
                  </div>
                )}
                {expired ? (
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => settle(p.seriesId)}>
                    Settle
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (row) onOpenTrade(row, p.sideLabel === "Call" ? "call" : "put");
                    }}
                  >
                    Manage
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
