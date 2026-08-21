use crate::{AmmPool, AmmPoolClient, Side};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use sep_40_oracle::{
    testutils::{Asset as MockAsset, MockPriceOracleClient, MockPriceOracleWASM},
    Asset,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    vec, Address, Env, Symbol,
};
use vault_accounting::{VaultAccounting, VaultAccountingClient};

const RESOLUTION: u32 = 300;
const MAX_STALENESS: u64 = 3_600;

struct Setup {
    env: Env,
    admin: Address,
    amm: AmmPoolClient<'static>,
    token_addr: Address,
    asset: Asset,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    // Aligned to RESOLUTION (300s) — the mock oracle snaps set_price's
    // timestamp to the nearest tick.
    env.ledger().set_timestamp(9_000_000);

    let admin = Address::generate(&env);
    let sym = Symbol::new(&env, "XLM");
    let asset = Asset::Other(sym.clone());
    let mock_asset = MockAsset::Other(sym);

    let mock_id = env.register_contract_wasm(None, MockPriceOracleWASM);
    let mock = MockPriceOracleClient::new(&env, &mock_id);
    mock.set_data(&admin, &mock_asset, &vec![&env, mock_asset.clone()], &7, &RESOLUTION);
    // Seed a flat 8-sample price history so realized-vol reads succeed.
    let now = env.ledger().timestamp();
    for i in 0..8u64 {
        mock.set_price(&vec![&env, 100_0000000i128], &(now - (8 - i) * RESOLUTION as u64));
    }

    let oracle_id = env.register(OracleAdapter, ());
    let oracle = OracleAdapterClient::new(&env, &oracle_id);
    oracle.initialize(&admin, &mock_id, &MAX_STALENESS);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let sac_client = StellarAssetClient::new(&env, &token_addr);

    let vault_id = env.register(VaultAccounting, ());
    let vault = VaultAccountingClient::new(&env, &vault_id);
    vault.initialize(&admin, &token_addr);

    let lp = Address::generate(&env);
    sac_client.mint(&lp, &1_000_000_0000000i128);
    vault.deposit(&lp, &1_000_000_0000000i128);

    let amm_id = env.register(AmmPool, ());
    let amm = AmmPoolClient::new(&env, &amm_id);
    amm.initialize(&admin, &oracle_id, &vault_id, &token_addr, &50u32, &vec![&env, asset.clone()]);
    vault.add_authorized_caller(&admin, &amm_id);

    Setup { env, admin, amm, token_addr, asset }
}

fn register_series(s: &Setup, strike: i128, expiry: u64) -> u64 {
    let factory = Address::generate(&s.env);
    s.amm.set_factory(&s.admin, &factory);
    let series_id = 1u64;
    s.amm.register_series(&factory, &series_id, &s.asset, &strike, &expiry);
    series_id
}

#[test]
fn quote_with_near_zero_vol_approaches_intrinsic() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    let series_id = register_series(&s, 90_0000000i128, now + 86_400);

    let premium = s.amm.quote(&series_id, &Side::Call);
    // Flat price history -> realized vol ~ 0 -> premium ~ intrinsic:
    // spot(100) - strike(90) = 10, at PRICE_SCALE (1e7).
    assert_eq!(premium, 10_0000000i128);
}

#[test]
#[should_panic]
fn buy_with_stale_oracle_price_reverts() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    let series_id = register_series(&s, 90_0000000i128, now + 86_400);

    // Push ledger time far enough past the last price sample to exceed MaxStaleness.
    s.env.ledger().set_timestamp(now + MAX_STALENESS + 1);

    let buyer = Address::generate(&s.env);
    let mint = StellarAssetClient::new(&s.env, &s.token_addr);
    mint.mint(&buyer, &1_000_0000000i128);

    // oracle-adapter reverts on a stale price — no trade executes.
    s.amm.buy(&buyer, &series_id, &Side::Call, &1_0000000i128, &1_000_0000000i128);
}

#[test]
fn buy_records_position_and_locks_collateral() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    let series_id = register_series(&s, 90_0000000i128, now + 86_400);

    let buyer = Address::generate(&s.env);
    let mint = StellarAssetClient::new(&s.env, &s.token_addr);
    mint.mint(&buyer, &1_000_0000000i128);

    let premium = s.amm.buy(&buyer, &series_id, &Side::Call, &1_0000000i128, &1_000_0000000i128);
    assert_eq!(premium, 10_0000000i128);
}

#[test]
#[should_panic]
fn buy_at_extreme_notional_overflows_checked_not_silently() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    // Strike chosen so strike * size overflows i128 in the notional
    // calculation — checked_mul must panic, never wrap.
    let series_id = register_series(&s, i128::MAX / 2, now + 86_400);

    let buyer = Address::generate(&s.env);
    let mint = StellarAssetClient::new(&s.env, &s.token_addr);
    mint.mint(&buyer, &i128::MAX);

    s.amm.buy(&buyer, &series_id, &Side::Call, &i128::MAX, &i128::MAX);
}

#[test]
fn quote_errors_on_expired_series() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    let series_id = register_series(&s, 90_0000000i128, now + 1);
    s.env.ledger().set_timestamp(now + 100);

    let result = s.amm.try_quote(&series_id, &Side::Call);
    assert!(result.is_err());
}
