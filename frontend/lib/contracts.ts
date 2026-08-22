import { contract } from "@stellar/stellar-sdk";
import { config, contracts } from "./stellar";

/** Mirrors sep_40_oracle::Asset / the enums each Umbra contract re-exports.
 * Soroban unit/tuple enum variants cross the JS boundary as {tag, values}. */
export type Asset = { tag: "Stellar"; values: [string] } | { tag: "Other"; values: [string] };
export type Side = { tag: "Call"; values: undefined } | { tag: "Put"; values: undefined };

export const CALL: Side = { tag: "Call", values: undefined };
export const PUT: Side = { tag: "Put", values: undefined };

/**
 * Any Rust contract method declared `-> Result<T, Error>` decodes on the JS
 * side to an `Ok<T>` instance (with a `.unwrap()` that returns T), not T
 * itself — see stellar-sdk's `contract.Spec.funcResToNative`. A method with
 * a plain (non-Result) return type decodes straight to T. This duck-types
 * the difference so every `tx.result` read goes through one unwrap point
 * instead of tracking, per method, which Rust signature it came from.
 */
export function unwrap<T>(result: T): T {
  const maybeResult = result as unknown as { unwrap?: () => T };
  return typeof maybeResult?.unwrap === "function" ? maybeResult.unwrap() : result;
}

export interface SeriesInfo {
  underlying: Asset;
  strike: bigint;
  expiry: bigint;
  created_at: bigint;
}

export interface Position {
  size: bigint;
  premium_paid: bigint;
}

interface OracleAdapterContract {
  get_price: (
    args: { asset: Asset },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<readonly [bigint, bigint]>>;
  get_realized_vol: (
    args: { asset: Asset },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<number>>;
  decimals: (options?: contract.MethodOptions) => Promise<contract.AssembledTransaction<number>>;
}

interface VaultAccountingContract {
  deposit: (
    args: { from: string; amount: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<bigint>>;
  withdraw: (
    args: { from: string; shares: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<bigint>>;
  share_price: (options?: contract.MethodOptions) => Promise<contract.AssembledTransaction<bigint>>;
}

interface AmmPoolContract {
  quote: (
    args: { series_id: bigint; side: Side },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<bigint>>;
  buy: (
    args: { buyer: string; series_id: bigint; side: Side; size: bigint; max_premium: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<bigint>>;
  sell: (
    args: { seller: string; series_id: bigint; side: Side; size: bigint; min_premium: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<bigint>>;
  get_position: (
    args: { holder: string; series_id: bigint; side: Side },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<Position>>;
}

interface OptionsFactoryContract {
  create_series: (
    args: { underlying: Asset; strike: bigint; expiry: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<bigint>>;
  list_series: (
    args: { underlying: Asset },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<SeriesInfo[]>>;
  get_series: (
    args: { series_id: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<SeriesInfo>>;
}

interface SettlementKeeperContract {
  settle: (
    args: { caller: string; series_id: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<null>>;
  is_settleable: (
    args: { series_id: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<boolean>>;
}

interface TokenContract {
  decimals: (options?: contract.MethodOptions) => Promise<contract.AssembledTransaction<number>>;
  balance: (
    args: { id: string },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<bigint>>;
  symbol: (options?: contract.MethodOptions) => Promise<contract.AssembledTransaction<string>>;
}

export interface PriceData {
  price: bigint;
  timestamp: bigint;
}

/** SEP-40 Reflector's own public interface — read directly for chart history,
 * since oracle-adapter only exposes a single averaged TWAP, not raw ticks. */
interface ReflectorContract {
  lastprice: (
    args: { asset: Asset },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<PriceData | null>>;
  prices: (
    args: { asset: Asset; records: number },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<PriceData[] | null>>;
  decimals: (options?: contract.MethodOptions) => Promise<contract.AssembledTransaction<number>>;
  resolution: (options?: contract.MethodOptions) => Promise<contract.AssembledTransaction<number>>;
}

export type SignTransaction = contract.ClientOptions["signTransaction"];

function baseOptions(contractId: string, publicKey?: string | null, signTransaction?: SignTransaction) {
  return {
    contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    publicKey: publicKey ?? undefined,
    signTransaction,
    allowHttp: config.rpcUrl.startsWith("http://"),
  };
}

// `contract.Client.from()` returns an untyped `Promise<Client>` — its methods
// are attached dynamically at runtime from the contract's on-chain spec, so
// there's no generic to hang static types off. Each helper below awaits it
// once and casts to the hand-written interface above (which mirrors the
// deployed contract's actual Rust signatures) so call sites stay typed.
//
// `Client.from` also does a real RPC round trip to fetch the contract's spec
// — with a market listing that probes many series IDs and re-quotes both
// sides of each one, building a fresh client per call would multiply into
// hundreds of redundant spec fetches. Cache by (contractId, publicKey), the
// only two inputs that change which client identity we need.
const clientCache = new Map<string, Promise<unknown>>();

async function typedClient<T>(contractId: string, publicKey?: string | null, signTransaction?: SignTransaction): Promise<T> {
  // Two calls with the same contract+address but different signer presence
  // must not share a client — a cached read-only client would be missing
  // signTransaction when a later write call needs to sign with it.
  const cacheKey = `${contractId}:${publicKey ?? ""}:${signTransaction ? "w" : "r"}`;
  let pending = clientCache.get(cacheKey);
  if (!pending) {
    pending = contract.Client.from(baseOptions(contractId, publicKey, signTransaction));
    clientCache.set(cacheKey, pending);
    pending.catch(() => clientCache.delete(cacheKey));
  }
  return pending as Promise<T>;
}

export function oracleAdapterClient(publicKey?: string | null, signTransaction?: SignTransaction) {
  return typedClient<OracleAdapterContract>(contracts.oracleAdapter, publicKey, signTransaction);
}

export function vaultAccountingClient(publicKey?: string | null, signTransaction?: SignTransaction) {
  return typedClient<VaultAccountingContract>(contracts.vaultAccounting, publicKey, signTransaction);
}

export function ammPoolClient(publicKey?: string | null, signTransaction?: SignTransaction) {
  return typedClient<AmmPoolContract>(contracts.ammPool, publicKey, signTransaction);
}

export function optionsFactoryClient(publicKey?: string | null, signTransaction?: SignTransaction) {
  return typedClient<OptionsFactoryContract>(contracts.optionsFactory, publicKey, signTransaction);
}

export function settlementKeeperClient(publicKey?: string | null, signTransaction?: SignTransaction) {
  return typedClient<SettlementKeeperContract>(contracts.settlementKeeper, publicKey, signTransaction);
}

export function tokenClient(publicKey?: string | null, signTransaction?: SignTransaction) {
  return typedClient<TokenContract>(contracts.token, publicKey, signTransaction);
}

export function reflectorClient(publicKey?: string | null, signTransaction?: SignTransaction) {
  return typedClient<ReflectorContract>(contracts.reflector, publicKey, signTransaction);
}
