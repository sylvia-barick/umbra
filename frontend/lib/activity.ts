import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, contracts } from "./stellar";
import { toBig } from "./format";

export interface ActivityItem {
  id: string;
  time: number; // unix seconds
  label: string;
  detail: string;
  tone: "call" | "put" | "violet" | "neutral";
}

const LOOKBACK_LEDGERS = 17_280; // ~1 day at 5s/ledger — most public RPC event retention windows cover this
const LIMIT = 40;

/**
 * Reads recent buy/sell/deposit/withdraw/settlement/creation events straight
 * from the four contracts' own event streams rather than maintaining any
 * off-chain index — this is a read-only "what just happened" feed, so a
 * short window and best-effort decoding (skip anything that doesn't parse)
 * is the right tradeoff over building real indexing infrastructure for it.
 */
export async function fetchRecentActivity(tokenDecimals: number, priceDecimals: number): Promise<ActivityItem[]> {
  const latest = await rpc.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - LOOKBACK_LEDGERS);

  const contractIds = [contracts.ammPool, contracts.optionsFactory, contracts.settlementKeeper, contracts.vaultAccounting];

  let events: StellarSdk.rpc.Api.EventResponse[] = [];
  try {
    const res = await rpc.getEvents({
      startLedger,
      filters: [{ type: "contract", contractIds }],
      limit: LIMIT,
    });
    events = res.events;
  } catch {
    return [];
  }

  const items: ActivityItem[] = [];
  for (const ev of events) {
    const item = decodeEvent(ev, tokenDecimals, priceDecimals);
    if (item) items.push(item);
  }
  return items.sort((a, b) => b.time - a.time);
}

function decodeEvent(
  ev: StellarSdk.rpc.Api.EventResponse,
  tokenDecimals: number,
  priceDecimals: number,
): ActivityItem | null {
  try {
    const topic = ev.topic.map((t) => StellarSdk.scValToNative(t));
    const value = StellarSdk.scValToNative(ev.value);
    const time = Math.floor(new Date(ev.ledgerClosedAt).getTime() / 1000);
    const [a, b] = topic as [string, string?];
    const priceScale = (n: bigint | number) => `${(Number(toBig(n)) / 10 ** priceDecimals).toLocaleString()}`;
    const tokenAmt = (n: bigint | number) => `${(Number(toBig(n)) / 10 ** tokenDecimals).toLocaleString()}`;

    if (a === "amm" && (b === "buy" || b === "sell")) {
      const [, side, size, amount] = value as [unknown, { tag: string }, bigint, bigint];
      return {
        id: ev.id,
        time,
        label: b === "buy" ? "Bought" : "Sold",
        detail: `${side.tag} · ${priceScale(size)} units · ${tokenAmt(amount)}`,
        tone: side.tag === "Call" ? "call" : "put",
      };
    }
    if (a === "factory" && b === "created") {
      const [seriesId, , strike] = value as [bigint, unknown, bigint];
      return {
        id: ev.id,
        time,
        label: "New series",
        detail: `#${toBig(seriesId)} · strike $${tokenAmt(strike)}`,
        tone: "violet",
      };
    }
    if (a === "keeper" && b === "settled") {
      const [finalPrice, totalPayout] = value as [bigint, bigint];
      return {
        id: ev.id,
        time,
        label: "Settled",
        detail: `final $${priceScale(finalPrice)} · paid out ${tokenAmt(totalPayout)}`,
        tone: "neutral",
      };
    }
    if (a === "vault" && b === "deposit") {
      const [, amount] = value as [unknown, bigint];
      return { id: ev.id, time, label: "Vault deposit", detail: `${tokenAmt(amount)}`, tone: "call" };
    }
    if (a === "vault" && b === "withdraw") {
      const [, , amount] = value as [unknown, unknown, bigint];
      return { id: ev.id, time, label: "Vault withdraw", detail: `${tokenAmt(amount)}`, tone: "neutral" };
    }
    return null;
  } catch {
    return null;
  }
}
