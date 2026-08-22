import "dotenv/config";
import * as StellarSdk from "@stellar/stellar-sdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

const network = process.env.NETWORK || "testnet";

function networkConfig(net: string) {
  switch (net) {
    case "testnet":
      return {
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: StellarSdk.Networks.TESTNET,
      };
    case "mainnet":
      return {
        rpcUrl: requireEnv("MAINNET_RPC_URL"),
        networkPassphrase: StellarSdk.Networks.PUBLIC,
      };
    default:
      throw new Error(`Unknown network: ${net}`);
  }
}

export const netConfig = networkConfig(network);
export const rpc = new StellarSdk.rpc.Server(netConfig.rpcUrl);

export const keeperKeypair = StellarSdk.Keypair.fromSecret(requireEnv("KEEPER_SECRET_KEY"));

export const contracts = {
  oracleAdapter: requireEnv("ORACLE_ADAPTER_ID"),
  vaultAccounting: requireEnv("VAULT_ACCOUNTING_ID"),
  ammPool: requireEnv("AMM_POOL_ID"),
  optionsFactory: requireEnv("OPTIONS_FACTORY_ID"),
  settlementKeeper: requireEnv("SETTLEMENT_KEEPER_ID"),
  token: requireEnv("TOKEN_ADDR"),
  reflector: requireEnv("REFLECTOR_ADDR"),
};

export const underlyingSymbol = process.env.UNDERLYING_SYMBOL || "XLM";
export const pollIntervalSecs = Number(process.env.POLL_INTERVAL_SECS || "60");
export const maxSeriesProbe = Number(process.env.MAX_SERIES_PROBE || "200");

export function underlyingAsset(): { tag: "Other"; values: [string] } {
  return { tag: "Other", values: [underlyingSymbol] };
}
