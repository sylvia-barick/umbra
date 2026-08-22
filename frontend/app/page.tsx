"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/app/providers";
import {
  SeriesRow,
  underlyingAsset,
  useSeriesList,
  useTokenBalance,
  useUmbraStatics,
  useVaultStats,
  usePositions,
} from "@/hooks/useUmbraData";
import { READ_ONLY_ACCOUNT } from "@/lib/stellar";
import { Tabs } from "@/components/Tabs";
import { MarketView } from "@/components/MarketView";
import { TradeDrawer } from "@/components/TradeDrawer";
import { VaultPanel } from "@/components/VaultPanel";
import { PositionsPanel } from "@/components/PositionsPanel";
import { CreateSeriesModal } from "@/components/CreateSeriesModal";

type TabKey = "markets" | "vault" | "positions";

export default function Home() {
  const wallet = useWallet();
  const readAddr = wallet.address ?? READ_ONLY_ACCOUNT;
  const statics = useUmbraStatics();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const { series, loading: loadingSeries } = useSeriesList(readAddr, refreshKey);
  const { sharePrice, loading: loadingVault } = useVaultStats(readAddr, refreshKey);
  const walletBalance = useTokenBalance(wallet.address, refreshKey);
  const { positions, loading: loadingPositions } = usePositions(wallet.address, series, refreshKey);

  const [tab, setTab] = useState<TabKey>("markets");
  const [selected, setSelected] = useState<{ row: SeriesRow; side: "call" | "put" } | null>(null);
  const [manageTrade, setManageTrade] = useState<{ row: SeriesRow; side: "call" | "put" } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Keep the docked order panel pointed at a real series: default to the
  // first one once the list loads, and follow along if the selected series
  // disappears (e.g. a stale refresh) or the list order shifts.
  useEffect(() => {
    if (series.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) => {
      if (prev && series.some((s) => s.id === prev.row.id)) {
        const fresh = series.find((s) => s.id === prev.row.id)!;
        return fresh === prev.row ? prev : { row: fresh, side: prev.side };
      }
      return { row: series[0], side: "call" };
    });
  }, [series]);

  const underlyingSymbol = underlyingAsset().values[0];
  const tokenSymbol = statics?.tokenSymbol ?? "USDC";
  const tokenDecimals = statics?.tokenDecimals ?? 7;
  const priceDecimals = statics?.priceDecimals ?? 14;

  return (
    <>
      <Tabs
        tabs={[
          { key: "markets", label: "Markets", count: series.length },
          { key: "vault", label: "Vault" },
          { key: "positions", label: "Positions", count: positions.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "markets" && (
        <MarketView
          series={series}
          loading={loadingSeries}
          selected={selected}
          onSelect={(row, side) => setSelected({ row, side })}
          onCreateSeries={() => setCreateOpen(true)}
          onTraded={refresh}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          priceDecimals={priceDecimals}
          underlyingSymbol={underlyingSymbol}
          refreshKey={refreshKey}
        />
      )}

      {tab === "vault" && (
        <div className="max-w-md">
          <VaultPanel
            sharePrice={sharePrice}
            tokenSymbol={tokenSymbol}
            tokenDecimals={tokenDecimals}
            walletBalance={walletBalance}
            onChanged={refresh}
          />
        </div>
      )}

      {tab === "positions" && (
        <PositionsPanel
          positions={positions}
          loading={loadingPositions}
          series={series}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          priceDecimals={priceDecimals}
          underlyingSymbol={underlyingSymbol}
          onOpenTrade={(row, side) => setManageTrade({ row, side })}
          onChanged={refresh}
        />
      )}

      <TradeDrawer
        row={manageTrade?.row ?? null}
        initialSide={manageTrade?.side ?? "call"}
        onClose={() => setManageTrade(null)}
        onSuccess={refresh}
        tokenSymbol={tokenSymbol}
        tokenDecimals={tokenDecimals}
        priceDecimals={priceDecimals}
        underlyingSymbol={underlyingSymbol}
      />

      <CreateSeriesModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={refresh}
        tokenDecimals={tokenDecimals}
        underlyingSymbol={underlyingSymbol}
      />
    </>
  );
}
