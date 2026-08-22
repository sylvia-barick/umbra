import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatFixed } from "@/lib/format";

interface StatsBarProps {
  underlyingSymbol: string;
  tokenSymbol: string;
  sharePrice: bigint | null;
  tokenDecimals: number;
  seriesCount: number;
  loadingSeries: boolean;
  loadingVault: boolean;
}

function Stat({ label, value, loading, accent }: { label: string; value: string; loading: boolean; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="text-[11px] uppercase tracking-wide text-umbra-faint">{label}</span>
      {loading ? (
        <Skeleton className="h-6 w-20" />
      ) : (
        <span className={`font-mono text-xl font-semibold tabular ${accent ? "text-umbra-violet-glow" : "text-umbra-ink"}`}>
          {value}
        </span>
      )}
    </div>
  );
}

export function StatsBar({
  underlyingSymbol,
  tokenSymbol,
  sharePrice,
  tokenDecimals,
  seriesCount,
  loadingSeries,
  loadingVault,
}: StatsBarProps) {
  return (
    <Card className="mb-8 grid grid-cols-2 divide-x divide-y divide-umbra-border-soft sm:grid-cols-4 sm:divide-y-0">
      <Stat label="Underlying" value={underlyingSymbol} loading={false} />
      <Stat
        label="LP share price"
        value={sharePrice !== null ? `${formatFixed(sharePrice, tokenDecimals)} ${tokenSymbol}` : "—"}
        loading={loadingVault}
        accent
      />
      <Stat label="Live series" value={String(seriesCount)} loading={loadingSeries} />
      <Stat label="Collateral asset" value={tokenSymbol} loading={false} />
    </Card>
  );
}
