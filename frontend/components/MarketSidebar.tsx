"use client";

import { SpotInfo } from "@/hooks/useSpot";
import { useVaultHistory } from "@/hooks/useVaultHistory";
import { formatFixed } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

interface MarketSidebarProps {
  underlyingSymbol: string;
  spot: SpotInfo;
  changePct: number | null;
  seriesCount: number;
  vaultContractId: string;
  sharePrice: bigint | null;
  userShares: bigint | null;
  tokenSymbol: string;
  tokenDecimals: number;
  priceDecimals: number;
  onOpenVault: () => void;
}

/**
 * The persistent market list Hyperliquid always keeps visible on the left —
 * here it's underlyings rather than perp pairs. Only shows what's actually
 * registered on amm-pool (today, just the one configured underlying):
 * listing symbols the contract doesn't support would be a dead click.
 */
export function MarketSidebar({
  underlyingSymbol,
  spot,
  changePct,
  seriesCount,
  vaultContractId,
  sharePrice,
  userShares,
  tokenSymbol,
  tokenDecimals,
  priceDecimals,
  onOpenVault,
}: MarketSidebarProps) {
  const vaultHistory = useVaultHistory(vaultContractId, sharePrice, tokenDecimals);
  const userValue = userShares !== null && sharePrice !== null ? (userShares * sharePrice) / 10n ** BigInt(tokenDecimals) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-umbra-faint">Markets</div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between border-l-2 border-umbra-violet bg-umbra-violet/10 px-3.5 py-2.5">
          <div>
            <div className="text-sm font-semibold text-umbra-ink">{underlyingSymbol}</div>
            <div className="text-[10px] text-umbra-faint">{seriesCount} series</div>
          </div>
          <div className="text-right">
            {spot.loading ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              <div className="font-mono text-xs tabular text-umbra-ink">
                {spot.price !== null ? formatFixed(spot.price, priceDecimals, 4) : "—"}
              </div>
            )}
            {changePct !== null && (
              <div className={`font-mono text-[11px] tabular ${changePct >= 0 ? "text-umbra-call" : "text-umbra-put"}`}>
                {changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={onOpenVault}
        className="m-3 rounded-xl border border-umbra-border bg-umbra-panel-raised p-3.5 text-left transition-colors hover:border-umbra-border-strong"
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-umbra-ink">LP Vault</span>
          <span className="rounded bg-umbra-violet/15 px-1.5 py-0.5 font-mono text-[10px] text-umbra-violet-glow">
            {vaultHistory.annualizedPct !== null ? `${vaultHistory.annualizedPct.toFixed(1)}% APY` : "warming up"}
          </span>
        </div>
        <VaultSparkline points={vaultHistory.points.map((p) => p.v)} />
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-umbra-faint">Your shares</div>
            <div className="mt-0.5 font-mono text-xs tabular text-umbra-ink">
              {userShares !== null ? formatFixed(userShares, tokenDecimals) : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wide text-umbra-faint">Value</div>
            <div className="mt-0.5 font-mono text-xs tabular text-umbra-ink">
              {userValue !== null ? `${formatFixed(userValue, tokenDecimals)} ${tokenSymbol}` : "—"}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

function VaultSparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <div className="h-[26px] w-full border-b border-dashed border-umbra-border-soft" />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || max * 0.01 || 1;
  const w = 190;
  const h = 26;
  const coords = points.map((v, i) => `${(i / (points.length - 1)) * w},${h - ((v - min) / span) * h}`).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={coords} fill="none" stroke="#18d26e" strokeWidth={1.6} />
    </svg>
  );
}
