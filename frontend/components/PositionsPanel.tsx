"use client";

import { useWallet } from "@/app/providers";
import { SeriesRow } from "@/hooks/useUmbraData";
import { settlementKeeperClient } from "@/lib/contracts";
import { formatFixed } from "@/lib/format";
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
      </CardHeader>
      <div className="divide-y divide-umbra-border-soft">
        {positions.map((p) => {
          const info = series.find((s) => s.id === p.seriesId)?.info;
          const expired = info ? info.expiry <= now : false;
          return (
            <div key={`${p.seriesId}-${p.sideLabel}`} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <Badge tone={p.sideLabel === "Call" ? "call" : "put"}>{p.sideLabel}</Badge>
                <div>
                  <div className="font-mono text-sm tabular text-umbra-ink">
                    {underlyingSymbol} {info ? `$${formatFixed(info.strike, tokenDecimals, 2)}` : ""} · #{p.seriesId.toString()}
                  </div>
                  <div className="mt-0.5 text-xs text-umbra-faint">
                    {formatFixed(p.size, priceDecimals)} {underlyingSymbol} · paid{" "}
                    {formatFixed(p.premiumPaid, tokenDecimals)} {tokenSymbol}
                  </div>
                </div>
              </div>
              <div className="shrink-0">
                {expired ? (
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => settle(p.seriesId)}>
                    Settle
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const row = series.find((s) => s.id === p.seriesId);
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
