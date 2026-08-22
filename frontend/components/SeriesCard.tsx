"use client";

import { SeriesRow } from "@/hooks/useUmbraData";
import { formatCountdown, formatDate, formatFixed } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

interface SeriesCardProps {
  row: SeriesRow;
  tokenSymbol: string;
  tokenDecimals: number;
  underlyingSymbol: string;
  onTrade: (row: SeriesRow, side: "call" | "put") => void;
}

export function SeriesCard({ row, tokenSymbol, tokenDecimals, underlyingSymbol, onTrade }: SeriesCardProps) {
  const expired = row.info.expiry <= BigInt(Math.floor(Date.now() / 1000));

  return (
    <Card className="group flex flex-col overflow-hidden transition-colors hover:border-umbra-violet/40">
      <div className="flex items-center justify-between border-b border-umbra-border-soft px-5 py-3.5">
        <div>
          <div className="font-mono text-lg font-semibold tabular text-umbra-ink">
            {underlyingSymbol} ${formatFixed(row.info.strike, tokenDecimals, 2)}
          </div>
          <div className="mt-0.5 text-xs text-umbra-faint">Series #{row.id.toString()}</div>
        </div>
        <Badge tone={expired ? "warn" : "neutral"}>{expired ? "Expired" : formatCountdown(row.info.expiry)}</Badge>
      </div>

      <div className="grid grid-cols-2 divide-x divide-umbra-border-soft">
        <SideQuote
          label="Call"
          tone="call"
          quote={row.callQuote}
          error={row.callError}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          disabled={expired}
          onClick={() => onTrade(row, "call")}
        />
        <SideQuote
          label="Put"
          tone="put"
          quote={row.putQuote}
          error={row.putError}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          disabled={expired}
          onClick={() => onTrade(row, "put")}
        />
      </div>

      <div className="border-t border-umbra-border-soft px-5 py-2.5 text-[11px] text-umbra-faint">
        Expires {formatDate(row.info.expiry)}
      </div>
    </Card>
  );
}

function SideQuote({
  label,
  tone,
  quote,
  error,
  tokenSymbol,
  tokenDecimals,
  disabled,
  onClick,
}: {
  label: string;
  tone: "call" | "put";
  quote: bigint | null;
  error: string | null;
  tokenSymbol: string;
  tokenDecimals: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneText = tone === "call" ? "text-umbra-call" : "text-umbra-put";
  const available = quote !== null && !disabled;

  return (
    <button
      onClick={onClick}
      disabled={!available}
      className="flex flex-col items-start gap-1 px-5 py-4 text-left transition-colors hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={`text-xs font-medium uppercase tracking-wide ${toneText}`}>{label}</span>
      {quote !== null ? (
        <span className="font-mono text-base font-semibold tabular text-umbra-ink">
          {formatFixed(quote, tokenDecimals)} <span className="text-xs text-umbra-faint">{tokenSymbol}</span>
        </span>
      ) : error ? (
        <span className="text-xs text-umbra-faint">unavailable</span>
      ) : (
        <Skeleton className="h-5 w-16" />
      )}
    </button>
  );
}
