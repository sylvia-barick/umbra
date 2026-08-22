/**
 * One-off helper: generates a fresh testnet keypair and funds it via
 * friendbot, so you have a KEEPER_SECRET_KEY to put in .env. The keeper
 * account needs no special role or admin rights — settle() and
 * nudge_volatility() are both permissionless; it only needs XLM for fees
 * (and it collects the keeper_reward_bps cut of each settlement it
 * triggers, so a well-run keeper is roughly self-funding over time).
 */
import * as StellarSdk from "@stellar/stellar-sdk";

async function main() {
  const keypair = StellarSdk.Keypair.random();
  console.log(`Generated keypair: ${keypair.publicKey()}`);
  console.log("Funding via friendbot...");

  const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(keypair.publicKey())}`);
  if (!response.ok) {
    throw new Error(`Friendbot funding failed: ${response.status} ${await response.text()}`);
  }

  console.log("\nFunded. Add this to keeper/.env:\n");
  console.log(`KEEPER_SECRET_KEY=${keypair.secret()}`);
  console.log(`\n(public key, for reference: ${keypair.publicKey()})`);
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
