"use client";

import { useState } from "react";
import { useWallet } from "@/app/providers";
import { vaultAccountingClient } from "@/lib/contracts";
import { formatFixed, parseFixed } from "@/lib/format";
import { useTx } from "@/hooks/useTx";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

interface VaultPanelProps {
  sharePrice: bigint | null;
  shares: bigint | null;
  tokenSymbol: string;
  tokenDecimals: number;
  walletBalance: bigint | null;
  onChanged: () => void;
}

export function VaultPanel({ sharePrice, shares, tokenSymbol, tokenDecimals, walletBalance, onChanged }: VaultPanelProps) {
  const wallet = useWallet();
  const { run, busy } = useTx();
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");

  const holdingsValue =
    shares !== null && sharePrice !== null ? (shares * sharePrice) / 10n ** BigInt(tokenDecimals) : null;

  async function submit() {
    if (!wallet.address) return;
    if (tab === "deposit") {
      const amt = parseFixed(amount, tokenDecimals);
      if (amt <= 0n) return;
      await run(
        async () => {
          const client = await vaultAccountingClient(wallet.address, wallet.signTransaction);
          return (await client.deposit({ from: wallet.address!, amount: amt })).signAndSend();
        },
        { pendingTitle: "Depositing…", successTitle: `Deposited ${amount} ${tokenSymbol}` },
      );
    } else {
      const sh = parseFixed(amount, tokenDecimals);
      if (sh <= 0n) return;
      await run(
        async () => {
          const client = await vaultAccountingClient(wallet.address, wallet.signTransaction);
          return (await client.withdraw({ from: wallet.address!, shares: sh })).signAndSend();
        },
        { pendingTitle: "Withdrawing…", successTitle: `Withdrew ${amount} shares` },
      );
    }
    setAmount("");
    onChanged();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-umbra-muted">Deposit collateral, earn premiums as a market maker.</p>
        <Badge tone="violet">
          1 share = {sharePrice !== null ? formatFixed(sharePrice, tokenDecimals) : "—"} {tokenSymbol}
        </Badge>
      </div>
      {wallet.connected && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-umbra-border-soft bg-umbra-panel-raised p-3.5 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-umbra-faint">Your shares</div>
              <div className="mt-0.5 font-mono tabular">{shares !== null ? formatFixed(shares, tokenDecimals) : "—"}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-umbra-faint">Value</div>
              <div className="mt-0.5 font-mono tabular">
                {holdingsValue !== null ? `${formatFixed(holdingsValue, tokenDecimals)} ${tokenSymbol}` : "—"}
              </div>
            </div>
          </div>
        )}

        <div className="flex rounded-lg bg-umbra-panel-raised p-1">
          {(["deposit", "withdraw"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setAmount("");
              }}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium capitalize transition-colors ${
                tab === t ? "bg-umbra-panel text-umbra-ink shadow-sm" : "text-umbra-muted"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-umbra-muted">
              {tab === "deposit" ? `Amount (${tokenSymbol})` : "Shares"}
            </label>
            {tab === "deposit" && walletBalance !== null && (
              <button
                onClick={() => setAmount(formatFixed(walletBalance, tokenDecimals, tokenDecimals))}
                className="text-[11px] text-umbra-violet-glow hover:underline"
              >
                Balance: {formatFixed(walletBalance, tokenDecimals)}
              </button>
            )}
            {tab === "withdraw" && shares !== null && (
              <button
                onClick={() => setAmount(formatFixed(shares, tokenDecimals, tokenDecimals))}
                className="text-[11px] text-umbra-violet-glow hover:underline"
              >
                Max: {formatFixed(shares, tokenDecimals)}
              </button>
            )}
          </div>
          <Input
            type="number"
            min="0"
            step="0.0000001"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            suffix={tab === "deposit" ? tokenSymbol : "shares"}
          />
        </div>

        {!wallet.connected ? (
          <Button className="w-full" onClick={wallet.connect} loading={wallet.connecting}>
            Connect wallet
          </Button>
        ) : (
          <Button className="w-full" onClick={submit} loading={busy} disabled={!amount || Number(amount) <= 0}>
            {tab === "deposit" ? "Deposit" : "Withdraw"}
          </Button>
        )}
    </div>
  );
}
