import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, contracts } from "./stellar";
import { toBig } from "./format";

/**
 * Reads a user's LP share balance directly from vault-accounting's
 * persistent storage (`DataKey::Shares(Address)`), since the contract
 * exposes no `shares_of` getter — only `share_price()` and the
 * mutating deposit/withdraw calls. Best-effort: returns null on any
 * failure (missing entry, XDR shape mismatch) rather than throwing,
 * since this only backs a "your position" hint in the UI.
 */
export async function getUserShares(address: string): Promise<bigint | null> {
  try {
    const key = StellarSdk.xdr.ScVal.scvVec([
      StellarSdk.xdr.ScVal.scvSymbol("Shares"),
      new StellarSdk.Address(address).toScVal(),
    ]);
    const entry = await rpc.getContractData(
      contracts.vaultAccounting,
      key,
      StellarSdk.rpc.Durability.Persistent,
    );
    const val = entry.val.contractData().val();
    return toBig(StellarSdk.scValToNative(val) as bigint | number);
  } catch {
    return null;
  }
}
