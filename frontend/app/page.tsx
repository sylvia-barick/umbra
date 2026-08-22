"use client";

import { useState } from "react";
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
import { Hero } from "@/components/Hero";
import { StatsBar } from "@/components/StatsBar";
import { Tabs } from "@/components/Tabs";
import { SeriesGrid } from "@/components/SeriesGrid";
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
  const [trade, setTrade] = useState<{ row: SeriesRow; side: "call" | "put" } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const underlyingSymbol = underlyingAsset().values[0];
  const tokenSymbol = statics?.tokenSymbol ?? "USDC";
  const tokenDecimals = statics?.tokenDecimals ?? 7;
  const priceDecimals = statics?.priceDecimals ?? 14;

  return (
    <>
      <Hero />
      <StatsBar
        underlyingSymbol={underlyingSymbol}
        tokenSymbol={tokenSymbol}
        sharePrice={sharePrice}
        tokenDecimals={tokenDecimals}
        seriesCount={series.length}
        loadingSeries={loadingSeries}
        loadingVault={loadingVault}
      />

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
        <SeriesGrid
          series={series}
          loading={loadingSeries}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          underlyingSymbol={underlyingSymbol}
          onTrade={(row, side) => setTrade({ row, side })}
          onCreateSeries={() => setCreateOpen(true)}
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
          onOpenTrade={(row, side) => setTrade({ row, side })}
          onChanged={refresh}
        />
      )}

      <TradeDrawer
        row={trade?.row ?? null}
        initialSide={trade?.side ?? "call"}
        onClose={() => setTrade(null)}
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
