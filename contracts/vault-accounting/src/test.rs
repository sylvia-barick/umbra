use crate::{Error, VaultAccounting, VaultAccountingClient};
use soroban_sdk::{
    contract, contractimpl,
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

/// Minimal test-only token stub exposing only decimals() — vault-accounting's
/// initialize() and a zero-deposit share_price() call never invoke any other
/// token method, and Soroban dispatches by function name, so a contract
/// implementing just this one function satisfies token::Client::decimals().
/// Lets the mismatched-token-decimals test below use a scale (3) that
/// register_stellar_asset_contract_v2's always-7-decimal SAC can't provide.
#[contract]
struct MockDecimalsToken;

#[contractimpl]
impl MockDecimalsToken {
    pub fn decimals(_env: Env) -> u32 {
        3
    }
}

struct Setup {
    env: Env,
    vault: VaultAccountingClient<'static>,
    token: TokenClient<'static>,
    asset: StellarAssetClient<'static>,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token = TokenClient::new(&env, &token_addr);
    let asset = StellarAssetClient::new(&env, &token_addr);

    let vault_id = env.register(VaultAccounting, ());
    let vault = VaultAccountingClient::new(&env, &vault_id);
    vault.initialize(&admin, &token_addr);

    Setup { env, vault, token, asset, admin }
}

#[test]
fn deposit_mints_shares_1to1_on_first_deposit() {
    let s = setup();
    let lp = Address::generate(&s.env);
    s.asset.mint(&lp, &1_000_0000000i128);

    let shares = s.vault.deposit(&lp, &100_0000000i128);
    assert_eq!(shares, 100_0000000i128);
    assert_eq!(s.token.balance(&lp), 900_0000000i128);
}

#[test]
fn deposit_then_withdraw_same_block_share_price_unchanged() {
    let s = setup();
    let lp = Address::generate(&s.env);
    s.asset.mint(&lp, &1_000_0000000i128);

    let price_before = s.vault.share_price();
    let shares = s.vault.deposit(&lp, &500_0000000i128);
    let amount = s.vault.withdraw(&lp, &shares);
    let price_after = s.vault.share_price();

    assert_eq!(amount, 500_0000000i128);
    assert_eq!(price_before, price_after);
    assert_eq!(s.token.balance(&lp), 1_000_0000000i128);
}

#[test]
fn withdraw_exceeding_free_collateral_queues_not_partial() {
    let s = setup();
    let lp = Address::generate(&s.env);
    s.asset.mint(&lp, &1_000_0000000i128);
    let shares = s.vault.deposit(&lp, &1_000_0000000i128);

    let amm = Address::generate(&s.env);
    s.vault.add_authorized_caller(&s.admin, &amm);
    s.vault.lock_collateral(&amm, &900_0000000i128);

    // Only 100 free remains; withdrawing all shares would need ~1000.
    let result = s.vault.try_withdraw(&lp, &shares);
    assert_eq!(result, Err(Ok(Error::InsufficientFreeCollateral)));

    // No partial execution: shares balance untouched.
    let result2 = s.vault.try_withdraw(&lp, &shares);
    assert_eq!(result2, Err(Ok(Error::InsufficientFreeCollateral)));
}

#[test]
fn dust_deposit_does_not_round_to_zero_shares() {
    let s = setup();
    let lp = Address::generate(&s.env);
    s.asset.mint(&lp, &10i128);

    let shares = s.vault.deposit(&lp, &1i128);
    assert_eq!(shares, 1i128);
}

#[test]
fn lock_and_release_collateral_preserves_free_plus_locked_invariant() {
    let s = setup();
    let lp = Address::generate(&s.env);
    s.asset.mint(&lp, &1_000_0000000i128);
    s.vault.deposit(&lp, &1_000_0000000i128);

    let amm = Address::generate(&s.env);
    s.vault.add_authorized_caller(&s.admin, &amm);
    s.vault.lock_collateral(&amm, &400_0000000i128);

    let holder = Address::generate(&s.env);
    s.vault.release_collateral(&amm, &400_0000000i128, &150_0000000i128);

    let contract_balance = s.token.balance(&s.vault.address);
    assert_eq!(contract_balance, 850_0000000i128);
    assert_eq!(s.token.balance(&amm), 150_0000000i128);
    let _ = holder;
}

#[test]
fn share_price_scale_matches_token_decimals_not_a_hardcoded_default() {
    // share_price() used to report at a hardcoded 7-decimal scale
    // regardless of the actual collateral token — cosmetic (deposit/
    // withdraw never read it, so no fund-safety impact) but silently
    // wrong for any non-7-decimal token, exactly the scale-hardcoding
    // bug class that broke amm-pool's buy() against a 14-decimal oracle.
    // Uses a 3-decimal mock token specifically because
    // register_stellar_asset_contract_v2 can only ever produce 7.
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_id = env.register(MockDecimalsToken, ());

    let vault_id = env.register(VaultAccounting, ());
    let vault = VaultAccountingClient::new(&env, &vault_id);
    vault.initialize(&admin, &token_id);

    // No deposits yet: share_price() must report "1.0" at the token's
    // own 3-decimal scale (1_000), not a hardcoded 7-decimal 10_000_000.
    assert_eq!(vault.share_price(), 1_000i128);
}

#[test]
fn lock_collateral_rejects_unauthorized_caller() {
    let s = setup();
    let lp = Address::generate(&s.env);
    s.asset.mint(&lp, &1_000_0000000i128);
    s.vault.deposit(&lp, &1_000_0000000i128);

    let stranger = Address::generate(&s.env);
    let result = s.vault.try_lock_collateral(&stranger, &100_0000000i128);
    assert_eq!(result, Err(Ok(Error::NotAuthorized)));
}
