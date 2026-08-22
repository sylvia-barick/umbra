import * as StellarSdk from "@stellar/stellar-sdk";

const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";

// Next.js inlines `process.env.NEXT_PUBLIC_X` at build time via static
// text replacement — it only recognizes that exact literal-property form,
// not a dynamic `process.env[name]` lookup (which ships no env object to
// the client at all and would silently read as undefined). So this takes
// the already-read value rather than a key to look up.
function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function networkConfig(network: string) {
  switch (network) {
    case "testnet":
      return {
        horizonUrl: "https://horizon-testnet.stellar.org",
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: StellarSdk.Networks.TESTNET,
        friendbotUrl: "https://friendbot.stellar.org",
      };
    case "mainnet":
      return {
        horizonUrl: "https://horizon.stellar.org",
        rpcUrl: requireEnv("NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL", process.env.NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL),
        networkPassphrase: StellarSdk.Networks.PUBLIC,
        friendbotUrl: null as string | null,
      };
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

export const config = networkConfig(NETWORK);

export const rpc = new StellarSdk.rpc.Server(config.rpcUrl);

export const contracts = {
  oracleAdapter: requireEnv("NEXT_PUBLIC_ORACLE_ADAPTER_ID", process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ID),
  vaultAccounting: requireEnv("NEXT_PUBLIC_VAULT_ACCOUNTING_ID", process.env.NEXT_PUBLIC_VAULT_ACCOUNTING_ID),
  ammPool: requireEnv("NEXT_PUBLIC_AMM_POOL_ID", process.env.NEXT_PUBLIC_AMM_POOL_ID),
  optionsFactory: requireEnv("NEXT_PUBLIC_OPTIONS_FACTORY_ID", process.env.NEXT_PUBLIC_OPTIONS_FACTORY_ID),
  settlementKeeper: requireEnv("NEXT_PUBLIC_SETTLEMENT_KEEPER_ID", process.env.NEXT_PUBLIC_SETTLEMENT_KEEPER_ID),
  token: requireEnv("NEXT_PUBLIC_TOKEN_ADDR", process.env.NEXT_PUBLIC_TOKEN_ADDR),
  reflector: requireEnv("NEXT_PUBLIC_REFLECTOR_ADDR", process.env.NEXT_PUBLIC_REFLECTOR_ADDR),
};

export const underlyingSymbol = process.env.NEXT_PUBLIC_UNDERLYING_SYMBOL || "XLM";

/** amm-pool / options-factory both key series by Asset::Other(symbol) for the MVP grid. */
export function underlyingAsset(): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvVec([
    StellarSdk.xdr.ScVal.scvSymbol("Other"),
    StellarSdk.nativeToScVal(underlyingSymbol, { type: "symbol" }),
  ]);
}

export function underlyingAssetNative(): { tag: "Other"; values: [string] } {
  return { tag: "Other", values: [underlyingSymbol] };
}

/**
 * Stellar testnet's friendbot distribution account — always funded, so it's
 * a safe source account for building simulate-only (read) transactions when
 * no wallet is connected. Never used to sign or submit anything.
 */
export const READ_ONLY_ACCOUNT = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
