use crate::{Error, OracleAdapter, OracleAdapterClient};
use sep_40_oracle::{
    testutils::{Asset as MockAsset, MockPriceOracleClient, MockPriceOracleWASM},
    Asset,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, Symbol,
};

const RESOLUTION: u32 = 300; // 5 minutes/tick
const MAX_STALENESS: u64 = 300;

struct Setup {
    env: Env,
    admin: Address,
    oracle: OracleAdapterClient<'static>,
    mock: MockPriceOracleClient<'static>,
    asset: Asset,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    // Aligned to RESOLUTION (300s) — the mock oracle snaps set_price's
    // timestamp to the nearest tick, so an unaligned base would make
    // later exact-timestamp assertions drift.
    env.ledger().set_timestamp(900_000);

    let admin = Address::generate(&env);
    let sym = Symbol::new(&env, "XLM");
    let asset = Asset::Other(sym.clone());
    let mock_asset = MockAsset::Other(sym);

    let mock_id = env.register_contract_wasm(None, MockPriceOracleWASM);
    let mock = MockPriceOracleClient::new(&env, &mock_id);
    mock.set_data(
        &admin,
        &mock_asset,
        &vec![&env, mock_asset.clone()],
        &7,
        &RESOLUTION,
    );

    let oracle_id = env.register(OracleAdapter, ());
    let oracle = OracleAdapterClient::new(&env, &oracle_id);
    oracle.initialize(&admin, &mock_id, &MAX_STALENESS);

    Setup { env, admin, oracle, mock, asset }
}

#[test]
fn decimals_passes_through_to_reflector() {
    let s = setup();
    assert_eq!(s.oracle.decimals(), 7);
}

#[test]
fn get_price_happy_path() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    s.mock.set_price(&vec![&s.env, 1_000_0000i128], &now);

    let (price, ts) = s.oracle.get_price(&s.asset);
    assert_eq!(price, 1_000_0000i128);
    assert_eq!(ts, now);
}

#[test]
fn get_price_rejects_stale_price() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    // Priced far enough in the past to exceed MAX_STALENESS.
    let stale_ts = now - MAX_STALENESS - 1;
    s.mock.set_price(&vec![&s.env, 1_000_0000i128], &stale_ts);

    let result = s.oracle.try_get_price(&s.asset);
    assert_eq!(result, Err(Ok(Error::StalePrice)));
}

#[test]
fn get_realized_vol_rejects_insufficient_samples() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    // 3 nudges = 1 seed + 2 return observations, fewer than the
    // MIN_VOL_SAMPLES floor.
    s.mock.set_price(&vec![&s.env, 1_000_0000i128], &now);
    s.oracle.nudge_volatility(&s.asset);
    s.env.ledger().set_timestamp(now + RESOLUTION as u64);
    s.mock.set_price(&vec![&s.env, 1_010_0000i128], &(now + RESOLUTION as u64));
    s.oracle.nudge_volatility(&s.asset);
    s.env.ledger().set_timestamp(now + 2 * RESOLUTION as u64);
    s.mock.set_price(&vec![&s.env, 1_005_0000i128], &(now + 2 * RESOLUTION as u64));
    s.oracle.nudge_volatility(&s.asset);

    let result = s.oracle.try_get_realized_vol(&s.asset);
    assert_eq!(result, Err(Ok(Error::InsufficientHistory)));
}

#[test]
fn get_realized_vol_happy_path() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    let prices = [
        1_000_0000i128,
        1_010_0000,
        1_005_0000,
        1_020_0000,
        1_015_0000,
        1_030_0000,
        1_025_0000,
        1_040_0000,
        1_035_0000,
        1_050_0000,
    ];
    for (i, p) in prices.iter().enumerate() {
        let ts = now + (i as u64) * RESOLUTION as u64;
        s.env.ledger().set_timestamp(ts);
        s.mock.set_price(&vec![&s.env, *p], &ts);
        s.oracle.nudge_volatility(&s.asset);
    }

    // 10 nudges = 1 seed + 9 return observations, clearing MIN_VOL_SAMPLES.
    let vol = s.oracle.get_realized_vol(&s.asset);
    assert!(vol > 0);
}

#[test]
fn nudge_volatility_first_call_seeds_without_a_sample() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    s.mock.set_price(&vec![&s.env, 1_000_0000i128], &now);
    s.oracle.nudge_volatility(&s.asset);

    // A single observation can't produce a return — still InsufficientHistory.
    let result = s.oracle.try_get_realized_vol(&s.asset);
    assert_eq!(result, Err(Ok(Error::InsufficientHistory)));
}

#[test]
fn nudge_volatility_is_a_noop_when_feed_has_not_ticked() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    s.mock.set_price(&vec![&s.env, 1_000_0000i128], &now);
    s.oracle.nudge_volatility(&s.asset);

    // Calling again with the same underlying price/timestamp (feed hasn't
    // ticked) must not fabricate a zero-return observation.
    s.oracle.nudge_volatility(&s.asset);
    s.oracle.nudge_volatility(&s.asset);
    s.oracle.nudge_volatility(&s.asset);

    // Still only the initial seed — no returns observed yet.
    let result = s.oracle.try_get_realized_vol(&s.asset);
    assert_eq!(result, Err(Ok(Error::InsufficientHistory)));
}

#[test]
fn set_ewma_lambda_rejects_out_of_bounds() {
    let s = setup();
    let result = s.oracle.try_set_ewma_lambda(&s.admin, &0u32);
    assert_eq!(result, Err(Ok(Error::InvalidParameter)));

    let result2 = s.oracle.try_set_ewma_lambda(&s.admin, &1_000_000u32);
    assert_eq!(result2, Err(Ok(Error::InvalidParameter)));
}

#[test]
fn get_twap_happy_path() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    let base = now - (RESOLUTION as u64) * 2;
    s.mock.set_price(&vec![&s.env, 100_0000000i128], &base);
    s.mock.set_price(&vec![&s.env, 110_0000000i128], &(base + RESOLUTION as u64));
    s.mock.set_price(&vec![&s.env, 120_0000000i128], &now);

    let twap = s.oracle.get_twap(&s.asset, &(RESOLUTION as u64 * 3));
    assert_eq!(twap, 110_0000000i128);
}
