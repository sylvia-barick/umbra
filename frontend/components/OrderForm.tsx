"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/app/providers";
import { ammPoolClient, CALL, PUT, Side } from "@/lib/contracts";
import { SeriesRow } from "@/hooks/useUmbraData";
import { formatFixed, parseFixed, toBig } from "@/lib/format";
import { useTx } from "@/hooks/useTx";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

interface OrderFormProps {
  row: SeriesRow;
  initialSide: "call" | "put";
  onSuccess: () => void;
  tokenSymbol: string;
  tokenDecimals: number;
  priceDecimals: number;
  underlyingSymbol: string;
}

const SLIPPAGE_PRESETS_BPS = [50, 100, 200, 500] as const; // 0.5% / 1% / 2% / 5%

export function OrderForm({
  row,
  initialSide,
  onSuccess,
  tokenSymbol,
  tokenDecimals,
  priceDecimals,
  underlyingSymbol,
}: OrderFormProps) {
  const wallet = useWallet();
  const { run, busy } = useTx();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [side, setSide] = useState<"call" | "put">(initialSide);
  const [sizeInput, setSizeInput] = useState("1");
  const [position, setPosition] = useState<{ size: bigint } | null>(null);
  const [slippageBps, setSlippageBps] = useState<bigint>(200n);

  useEffect(() => {
    setSide(initialSide);
    setMode("buy");
    setSizeInput("1");
  }, [initialSide, row.id]);

  useEffect(() => {
    if (!wallet.address) {
      setPosition(null);
      return;
    }
    let cancelled = false;
    const sideVal: Side = side === "call" ? CALL : PUT;
    ammPoolClient(wallet.address)
      .then((client) => client.get_position({ holder: wallet.address!, series_id: row.id, side: sideVal }))
      .then((tx) => !cancelled && setPosition({ size: toBig(tx.result.size) }))
      .catch(() => !cancelled && setPosition(null));
    return () => {
      cancelled = true;
    };
  }, [row.id, side, wallet.address]);

  const priceScale = 10n ** BigInt(priceDecimals);
  const quotePerUnit = side === "call" ? row.callQuote : row.putQuote;
  const sizeRaw = useMemo(() => {
    try {
      return parseFixed(sizeInput, priceDecimals);
    } catch {
      return 0n;
    }
  }, [sizeInput, priceDecimals]);

  const estimatedPremium = useMemo(() => {
    if (quotePerUnit === null || sizeRaw <= 0n) return null;
    return (quotePerUnit * sizeRaw) / priceScale;
  }, [quotePerUnit, sizeRaw, priceScale]);

  const bound =
    estimatedPremium !== null
      ? mode === "buy"
        ? (estimatedPremium * (10000n + slippageBps)) / 10000n
        : (estimatedPremium * (10000n - slippageBps)) / 10000n
      : null;

  // Display-only risk summary for a new buy: strike and premium share the
  // oracle's price scale (see the strike-scale fix), so plain float division
  // is fine here — nothing downstream uses these values for the actual
  // transaction bounds. Payout is capped at notional per the contract's
  // full-collateral design (a call's true intrinsic value is unbounded, but
  // the pool never locks more than notional against it — see settlement).
  const riskSummary = useMemo(() => {
    if (mode !== "buy" || estimatedPremium === null || sizeRaw <= 0n) return null;
    const strikeNum = Number(row.info.strike) / 10 ** priceDecimals;
    const premiumPerUnitNum = quotePerUnit !== null ? Number(quotePerUnit) / 10 ** tokenDecimals : null;
    const sizeNum = Number(sizeRaw) / 10 ** priceDecimals;
    if (premiumPerUnitNum === null) return null;
    const breakeven = side === "call" ? strikeNum + premiumPerUnitNum : strikeNum - premiumPerUnitNum;
    const notional = strikeNum * sizeNum;
    const premiumPaidNum = Number(estimatedPremium) / 10 ** tokenDecimals;
    const maxGain = Math.max(0, notional - premiumPaidNum);
    return { breakeven, maxLoss: premiumPaidNum, maxGain };
  }, [mode, estimatedPremium, sizeRaw, row.info.strike, priceDecimals, quotePerUnit, tokenDecimals, side]);

  const expired = row.info.expiry <= BigInt(Math.floor(Date.now() / 1000));
  const positionSize = position?.size ?? 0n;
  const canSell = positionSize > 0n;
  const insufficientForSell = mode === "sell" && sizeRaw > positionSize;

  async function submit() {
    if (!wallet.address || estimatedPremium === null || bound === null) return;
    const sideVal: Side = side === "call" ? CALL : PUT;
    if (mode === "buy") {
      await run(
        async () => {
          const client = await ammPoolClient(wallet.address, wallet.signTransaction);
          const tx = await client.buy({
            buyer: wallet.address!,
            series_id: row.id,
            side: sideVal,
            size: sizeRaw,
            max_premium: bound,
          });
          return tx.signAndSend();
        },
        { pendingTitle: `Buying ${side}…`, successTitle: `Bought ${sizeInput} ${side} @ series #${row.id}` },
      );
    } else {
      await run(
        async () => {
          const client = await ammPoolClient(wallet.address, wallet.signTransaction);
          const tx = await client.sell({
            seller: wallet.address!,
            series_id: row.id,
            side: sideVal,
            size: sizeRaw,
            min_premium: bound,
          });
          return tx.signAndSend();
        },
        { pendingTitle: `Selling ${side}…`, successTitle: `Sold ${sizeInput} ${side} @ series #${row.id}` },
      );
    }
    onSuccess();
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-xs text-umbra-faint">Series #{row.id.toString()}</div>
        <div className="font-mono text-lg font-semibold tabular text-umbra-ink">
          {underlyingSymbol} ${formatFixed(row.info.strike, priceDecimals, 2)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["call", "put"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
              side === s
                ? s === "call"
                  ? "border-umbra-call/50 bg-umbra-call/10 text-umbra-call"
                  : "border-umbra-put/50 bg-umbra-put/10 text-umbra-put"
                : "border-umbra-border text-umbra-muted hover:border-umbra-border-soft"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex rounded-lg bg-umbra-panel-raised p-1">
        {(["buy", "sell"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={m === "sell" && !canSell}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              mode === m ? "bg-umbra-panel text-umbra-ink shadow-sm" : "text-umbra-muted"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {expired && (
        <div className="rounded-lg bg-umbra-warn/10 px-3 py-2 text-xs text-umbra-warn">
          This series has expired — trading is closed. It can still be settled from the Positions tab.
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-umbra-muted">Size ({underlyingSymbol} units)</label>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={sizeInput}
          onChange={(e) => setSizeInput(e.target.value)}
          suffix={underlyingSymbol}
        />
        {mode === "sell" && (
          <p className="mt-1 text-xs text-umbra-faint">
            Open position: {formatFixed(positionSize, priceDecimals)} {underlyingSymbol}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-umbra-border-soft bg-umbra-panel-raised p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-umbra-muted">Premium / unit</span>
          <span className="font-mono tabular">
            {quotePerUnit !== null ? `${formatFixed(quotePerUnit, tokenDecimals)} ${tokenSymbol}` : "—"}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-umbra-muted">Estimated {mode === "buy" ? "cost" : "proceeds"}</span>
          <span className="font-mono text-base font-semibold tabular text-umbra-ink">
            {estimatedPremium !== null ? `${formatFixed(estimatedPremium, tokenDecimals)} ${tokenSymbol}` : "—"}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-umbra-faint">
          <span>{mode === "buy" ? "Max" : "Min"} ({(Number(slippageBps) / 100).toFixed(1)}% slippage)</span>
          <span className="font-mono tabular">{bound !== null ? `${formatFixed(bound, tokenDecimals)} ${tokenSymbol}` : "—"}</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {SLIPPAGE_PRESETS_BPS.map((bps) => (
            <button
              key={bps}
              onClick={() => setSlippageBps(BigInt(bps))}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                Number(slippageBps) === bps
                  ? "bg-umbra-violet/15 text-umbra-violet-glow"
                  : "text-umbra-faint hover:text-umbra-muted"
              }`}
            >
              {(bps / 100).toFixed(1)}%
            </button>
          ))}
        </div>
      </div>

      {riskSummary && (
        <div className="rounded-lg border border-umbra-border-soft p-4 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-umbra-faint">Breakeven</span>
            <span className="font-mono tabular text-umbra-ink">${riskSummary.breakeven.toFixed(4)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-umbra-faint">Max loss</span>
            <span className="font-mono tabular text-umbra-put">
              -{riskSummary.maxLoss.toFixed(4)} {tokenSymbol}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-umbra-faint">Max payout (capped at notional)</span>
            <span className="font-mono tabular text-umbra-call">
              {riskSummary.maxGain.toFixed(4)} {tokenSymbol}
            </span>
          </div>
        </div>
      )}

      {!wallet.connected ? (
        <Button className="w-full" onClick={wallet.connect} loading={wallet.connecting}>
          Connect wallet to trade
        </Button>
      ) : wallet.wrongNetwork ? (
        <Badge tone="warn">Switch Freighter to Testnet</Badge>
      ) : (
        <Button
          className="w-full"
          variant={side === "call" ? "call" : "put"}
          onClick={submit}
          loading={busy}
          disabled={expired || sizeRaw <= 0n || estimatedPremium === null || quotePerUnit === null || insufficientForSell}
        >
          {insufficientForSell ? "Exceeds open position" : `${mode === "buy" ? "Buy" : "Sell"} ${side}`}
        </Button>
      )}
    </div>
  );
}
