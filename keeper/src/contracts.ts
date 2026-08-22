import { contract } from "@stellar/stellar-sdk";
import { contracts, keeperKeypair, netConfig, rpc } from "./config";

export type Asset = { tag: "Stellar"; values: [string] } | { tag: "Other"; values: [string] };

export interface SeriesInfo {
  underlying: Asset;
  strike: bigint;
  expiry: bigint;
  created_at: bigint;
}

/**
 * Any Rust contract method declared `-> Result<T, Error>` decodes on the JS
 * side to an `Ok<T>` instance (with `.unwrap()` returning T), not T itself —
 * see stellar-sdk's `contract.Spec.funcResToNative`. A plain-return method
 * decodes straight to T. This duck-types the difference so every `tx.result`
 * read goes through one unwrap point.
 */
export function unwrap<T>(result: T): T {
  const maybeResult = result as unknown as { unwrap?: () => T };
  return typeof maybeResult?.unwrap === "function" ? maybeResult.unwrap() : result;
}

const signer = contract.basicNodeSigner(keeperKeypair, netConfig.networkPassphrase);
const publicKey = keeperKeypair.publicKey();

function baseOptions(contractId: string) {
  return {
    contractId,
    rpcUrl: netConfig.rpcUrl,
    networkPassphrase: netConfig.networkPassphrase,
    publicKey,
    signTransaction: signer.signTransaction,
  };
}

const clientCache = new Map<string, Promise<unknown>>();

async function typedClient<T>(contractId: string): Promise<T> {
  let pending = clientCache.get(contractId);
  if (!pending) {
    pending = contract.Client.from(baseOptions(contractId));
    clientCache.set(contractId, pending);
    pending.catch(() => clientCache.delete(contractId));
  }
  return pending as Promise<T>;
}

interface OracleAdapterContract {
  nudge_volatility: (
    args: { asset: Asset },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<null>>;
}

interface OptionsFactoryContract {
  get_series: (
    args: { series_id: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<SeriesInfo>>;
}

interface SettlementKeeperContract {
  is_settleable: (
    args: { series_id: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<boolean>>;
  settle: (
    args: { caller: string; series_id: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<null>>;
}

export function oracleAdapterClient() {
  return typedClient<OracleAdapterContract>(contracts.oracleAdapter);
}

export function optionsFactoryClient() {
  return typedClient<OptionsFactoryContract>(contracts.optionsFactory);
}

export function settlementKeeperClient() {
  return typedClient<SettlementKeeperContract>(contracts.settlementKeeper);
}

export { publicKey as keeperPublicKey, rpc };
