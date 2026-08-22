import {
  keeperPublicKey,
  oracleAdapterClient,
  optionsFactoryClient,
  settlementKeeperClient,
  unwrap,
  SeriesInfo,
} from "./contracts";
import { maxSeriesProbe, pollIntervalSecs, underlyingAsset } from "./config";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/** Probes sequential series ids until the first miss — options-factory's
 * NextSeriesId counter is monotonic and never skips, so this is a complete
 * enumeration, not a sample. Mirrors the frontend's useSeriesList. */
async function listSeriesIds(): Promise<Array<{ id: bigint; info: SeriesInfo }>> {
  const factory = await optionsFactoryClient();
  const out: Array<{ id: bigint; info: SeriesInfo }> = [];
  for (let id = 1n; id <= BigInt(maxSeriesProbe); id++) {
    try {
      const tx = await factory.get_series({ series_id: id });
      out.push({ id, info: unwrap(tx.result) });
    } catch {
      break;
    }
  }
  return out;
}

/** Folds one new price observation into oracle-adapter's EWMA volatility
 * estimator for the configured underlying. Permissionless and idempotent
 * per-tick (a no-op if the feed hasn't moved since the last call) — safe to
 * call every cycle regardless of what else is happening. Without this,
 * amm-pool.quote() never has enough samples and every buy/sell reverts with
 * InsufficientHistory forever. */
async function nudgeVolatility(): Promise<void> {
  const oracle = await oracleAdapterClient();
  const asset = underlyingAsset();
  try {
    const tx = await oracle.nudge_volatility({ asset });
    await tx.signAndSend();
    log(`nudge_volatility(${asset.values[0]}) ok`);
  } catch (e) {
    log(`nudge_volatility(${asset.values[0]}) failed: ${errMessage(e)}`);
  }
}

async function settleExpired(series: Array<{ id: bigint; info: SeriesInfo }>): Promise<void> {
  if (series.length === 0) return;
  const keeper = await settlementKeeperClient();

  for (const { id } of series) {
    let settleable: boolean;
    try {
      const tx = await keeper.is_settleable({ series_id: id });
      settleable = unwrap(tx.result);
    } catch (e) {
      log(`is_settleable(#${id}) check failed: ${errMessage(e)}`);
      continue;
    }
    if (!settleable) continue;

    try {
      const tx = await keeper.settle({ caller: keeperPublicKey, series_id: id });
      const sent = await tx.signAndSend();
      const hash = (sent as { sendTransactionResponse?: { hash?: string } }).sendTransactionResponse?.hash;
      log(`settled series #${id}${hash ? ` (tx ${hash})` : ""}`);
    } catch (e) {
      log(`settle(#${id}) failed: ${errMessage(e)}`);
    }
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function cycle(): Promise<void> {
  await nudgeVolatility();
  const series = await listSeriesIds();
  log(`tracking ${series.length} series`);
  await settleExpired(series);
}

async function main() {
  log(`Umbra keeper starting — account ${keeperPublicKey}, poll every ${pollIntervalSecs}s`);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    log("shutting down…");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopped) {
    try {
      await cycle();
    } catch (e) {
      log(`cycle failed: ${errMessage(e)}`);
    }
    await sleep(pollIntervalSecs * 1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
