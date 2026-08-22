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
import { useSpot } from "@/hooks/useSpot";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { useActivity } from "@/hooks/useActivity";
import { useVaultShares } from "@/hooks/useVaultShares";
import { useVaultHistory } from "@/hooks/useVaultHistory";
import { READ_ONLY_ACCOUNT, contracts } from "@/lib/stellar";
import { summarizePositions } from "@/lib/positions";
import { Navbar } from "@/components/Navbar";
import { TickerTape } from "@/components/TickerTape";
import { MarketSidebar } from "@/components/MarketSidebar";
import { MarketTerminal } from "@/components/MarketTerminal";
import { TradeDrawer } from "@/components/TradeDrawer";
import { VaultPanel } from "@/components/VaultPanel";
import { CreateSeriesModal } from "@/components/CreateSeriesModal";
import { Modal } from "@/components/ui/Modal";

export default function Home() {
  const wallet = useWallet();
  const readAddr = wallet.address ?? READ_ONLY_ACCOUNT;
  const statics = useUmbraStatics();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const { series, loading: loadingSeries } = useSeriesList(readAddr, refreshKey);
  const { sharePrice } = useVaultStats(readAddr, refreshKey);
  const walletBalance = useTokenBalance(wallet.address, refreshKey);
  const { positions, loading: loadingPositions } = usePositions(wallet.address, series, refreshKey);
  const userShares = useVaultShares(wallet.address, refreshKey);

  const underlyingSymbol = underlyingAsset().values[0];
  const tokenSymbol = statics?.tokenSymbol ?? "USDC";
  const tokenDecimals = statics?.tokenDecimals ?? 7;
  const priceDecimals = statics?.priceDecimals ?? 14;

  const spot = useSpot(refreshKey);
  const history = usePriceHistory(priceDecimals);
  const activity = useActivity(tokenDecimals, priceDecimals, refreshKey);
  const vaultHistory = useVaultHistory(contracts.vaultAccounting, sharePrice, tokenDecimals);

  const [selected, setSelected] = useState<{ row: SeriesRow; side: "call" | "put" } | null>(null);
  const [manageTrade, setManageTrade] = useState<{ row: SeriesRow; side: "call" | "put" } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);

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

  const vaultValue = userShares !== null && sharePrice !== null ? (userShares * sharePrice) / 10n ** BigInt(tokenDecimals) : null;
  const posSummary = summarizePositions(positions, series, priceDecimals);
  const portfolioValue = vaultValue !== null || posSummary !== null ? (vaultValue ?? 0n) + (posSummary?.markedValue ?? 0n) : null;

  return (
    <>
      <Navbar
        portfolioValue={wallet.connected ? portfolioValue : null}
        pnl={wallet.connected ? posSummary?.pnl ?? (positions.length === 0 ? 0n : null) : null}
        pnlPartial={posSummary?.partial ?? false}
        openPositions={positions.length}
        vaultApyPct={vaultHistory.annualizedPct}
        tokenSymbol={tokenSymbol}
        tokenDecimals={tokenDecimals}
      />
      <TickerTape />

      <div className="flex min-h-0 flex-1">
        <div className="w-[220px] shrink-0 overflow-y-auto border-r border-umbra-border bg-umbra-panel">
          <MarketSidebar
            underlyingSymbol={underlyingSymbol}
            spot={spot}
            changePct={history.changePct}
            seriesCount={series.length}
            vaultContractId={contracts.vaultAccounting}
            sharePrice={sharePrice}
            userShares={userShares}
            tokenSymbol={tokenSymbol}
            tokenDecimals={tokenDecimals}
            priceDecimals={priceDecimals}
            onOpenVault={() => setVaultOpen(true)}
          />
        </div>

        <MarketTerminal
          series={series}
          loading={loadingSeries}
          selected={selected}
          onSelect={(row, side) => setSelected({ row, side })}
          onCreateSeries={() => setCreateOpen(true)}
          onTraded={refresh}
          positions={positions}
          loadingPositions={loadingPositions}
          onOpenTrade={(row, side) => setManageTrade({ row, side })}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          priceDecimals={priceDecimals}
          underlyingSymbol={underlyingSymbol}
          spot={spot}
          history={history}
          activityItems={activity.items}
          activityLoading={activity.loading}
        />
      </div>

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

      <Modal open={vaultOpen} onClose={() => setVaultOpen(false)} title="LP Vault">
        <VaultPanel
          sharePrice={sharePrice}
          shares={userShares}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          walletBalance={walletBalance}
          onChanged={refresh}
        />
      </Modal>

      <CreateSeriesModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={refresh}
        priceDecimals={priceDecimals}
        underlyingSymbol={underlyingSymbol}
      />
    </>
  );
}
