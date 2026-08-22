import { ConnectButton } from "@/components/ConnectButton";
import { UmbraMark } from "@/components/UmbraMark";
import { formatFixed, formatSigned } from "@/lib/format";

interface NavbarProps {
  portfolioValue: bigint | null;
  pnl: bigint | null;
  pnlPartial: boolean;
  openPositions: number;
  vaultApyPct: number | null;
  tokenSymbol: string;
  tokenDecimals: number;
}

/**
 * The top bar doubles as a real account strip once a wallet is connected —
 * portfolio value, aggregate unrealized P&L, open position count, and vault
 * APY, all inline, rather than a pill that only shows an address. The
 * numbers themselves already exist (see lib/positions.ts / useVaultHistory);
 * this just surfaces them at the top instead of only inside their own tabs.
 */
export function Navbar({ portfolioValue, pnl, pnlPartial, openPositions, vaultApyPct, tokenSymbol, tokenDecimals }: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-umbra-border bg-umbra-bg">
      <div className="flex h-14 items-center gap-8 px-4 sm:px-5">
        <div className="flex shrink-0 items-center gap-2.5">
          <UmbraMark className="h-6 w-6" />
          <span className="text-base font-semibold tracking-tight">Umbra</span>
          <span className="rounded border border-umbra-border bg-white/5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-umbra-faint">
            Testnet
          </span>
        </div>

        <div className="hidden min-w-0 flex-1 items-center gap-7 overflow-x-auto lg:flex">
          <Stat label="Portfolio value" value={portfolioValue !== null ? `$${formatFixed(portfolioValue, tokenDecimals, 2)}` : "—"} />
          <div className="h-6 w-px shrink-0 bg-umbra-border" />
          <Stat
            label={`Unrealized P&L${pnlPartial ? " (partial)" : ""}`}
            value={pnl !== null ? `${formatSigned(pnl, tokenDecimals)} ${tokenSymbol}` : "—"}
            tone={pnl === null ? undefined : pnl >= 0n ? "call" : "put"}
          />
          <div className="h-6 w-px shrink-0 bg-umbra-border" />
          <Stat label="Open positions" value={String(openPositions)} />
          <div className="h-6 w-px shrink-0 bg-umbra-border" />
          <Stat
            label="Vault APY"
            value={vaultApyPct !== null ? `${vaultApyPct.toFixed(1)}%` : "warming up"}
            tone={vaultApyPct !== null ? "call" : undefined}
          />
        </div>

        <div className="ml-auto shrink-0">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "call" | "put" }) {
  const color = tone === "call" ? "text-umbra-call" : tone === "put" ? "text-umbra-put" : "text-umbra-ink";
  return (
    <div className="flex shrink-0 flex-col gap-0.5 leading-none">
      <span className="text-[9.5px] uppercase tracking-wide text-umbra-faint">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular ${color}`}>{value}</span>
    </div>
  );
}
