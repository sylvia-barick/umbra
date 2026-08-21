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
    oracle: OracleAdapterClient<'static>,
    mock: MockPriceOracleClient<'static>,
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

    let oracle_id = env.register(OracleAdapter, ());
    let oracle = OracleAdapterClient::new(&env, &oracle_id);
    oracle.initialize(&admin, &mock_id, &MAX_STALENESS);

    // Nudge a flat 9-tick price history into the EWMA estimator (1 seed +
    // 8 zero-return observations, clearing MIN_VOL_SAMPLES) so
    // realized-vol reads succeed. Flat prices -> realized vol ~ 0, same
    // property the old fixed-window approach had for this fixture.
    let start = env.ledger().timestamp();
    for i in 0..9u64 {
        let ts = start + i * RESOLUTION as u64;
        env.ledger().set_timestamp(ts);
        mock.set_price(&vec![&env, 100_0000000i128], &ts);
        oracle.nudge_volatility(&asset);
    }

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

    Setup { env, admin, amm, oracle, mock, token_addr, asset }
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

#[test]
fn buy_with_mismatched_oracle_and_token_decimals_computes_correct_notional() {
    // Reproduces a live-testnet failure: Reflector's real feed uses 14
    // decimals while the collateral token (native XLM) uses 7. Locking
    // notional computed in the oracle's price_scale directly, without
    // rescaling to the token's own scale, made a 1000-XLM-collateralized
    // pool try to lock 1.8 MILLION XLM for a single ~$0.18-strike
    // contract — reverting the deposit-sized LP pool in this test the
    // same way it reverted the real one on testnet.
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(9_000_000);

    let admin = Address::generate(&env);
    let sym = Symbol::new(&env, "XLM");
    let asset = Asset::Other(sym.clone());
    let mock_asset = MockAsset::Other(sym);

    let mock_id = env.register_contract_wasm(None, MockPriceOracleWASM);
    let mock = MockPriceOracleClient::new(&env, &mock_id);
    // 14-decimal oracle, matching Reflector's real CEX/DEX feed.
    mock.set_data(&admin, &mock_asset, &vec![&env, mock_asset.clone()], &14, &RESOLUTION);

    let oracle_id = env.register(OracleAdapter, ());
    let oracle = OracleAdapterClient::new(&env, &oracle_id);
    oracle.initialize(&admin, &mock_id, &MAX_STALENESS);

    // ~$0.19 XLM spot at 14-decimal scale; nudge a flat 9-tick history
    // into the EWMA estimator so realized-vol reads succeed.
    let start = env.ledger().timestamp();
    for i in 0..9u64 {
        let ts = start + i * RESOLUTION as u64;
        env.ledger().set_timestamp(ts);
        mock.set_price(&vec![&env, 19_000_000_000_000i128], &ts);
        oracle.nudge_volatility(&asset);
    }

    // 7-decimal collateral token (native-XLM-like), deliberately
    // different from the oracle's 14 decimals.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let sac_client = StellarAssetClient::new(&env, &token_addr);

    let vault_id = env.register(VaultAccounting, ());
    let vault = VaultAccountingClient::new(&env, &vault_id);
    vault.initialize(&admin, &token_addr);

    let lp = Address::generate(&env);
    sac_client.mint(&lp, &1_000_0000000i128); // 1000 tokens at 7-decimal scale
    vault.deposit(&lp, &1_000_0000000i128);

    let amm_id = env.register(AmmPool, ());
    let amm = AmmPoolClient::new(&env, &amm_id);
    amm.initialize(&admin, &oracle_id, &vault_id, &token_addr, &50u32, &vec![&env, asset.clone()]);
    vault.add_authorized_caller(&admin, &amm_id);

    let factory = Address::generate(&env);
    amm.set_factory(&admin, &factory);
    let series_id = 1u64;
    // $0.18 strike at 14-decimal scale — matches the live deployment.
    let strike = 18_000_000_000_000i128;
    let now = env.ledger().timestamp();
    amm.register_series(&factory, &series_id, &asset, &strike, &(now + 1_800));

    let buyer = Address::generate(&env);
    sac_client.mint(&buyer, &10_0000000i128); // 10 tokens

    // notional ~= strike(0.18) * size(1 contract) rescaled into the
    // 7-decimal token: a few tenths of a token, not 1.8 million.
    let size = 1_00_000_000_000_00i128; // 1 whole contract at the 14-decimal price_scale
    let premium = amm.buy(&buyer, &series_id, &Side::Call, &size, &10_0000000i128);
    assert!(premium > 0 && premium < 1_0000000i128, "premium should be a fraction of one token, got {premium}");
}

#[test]
fn quote_near_expiry_with_real_volatility_does_not_overflow() {
    // Reproduces a live-testnet failure: real (non-flat) price history
    // plus a short time-to-expiry pushes d1 to an extreme value (tiny
    // sigma*sqrt(T) relative to ln(S/K)), which overflowed i128 inside
    // normal_cdf's exp() call before fp_exp clamped its exponent.
    let s = setup();
    // Nudge in mildly varying prices (on top of setup()'s flat history)
    // so realized vol is nonzero.
    let start = s.env.ledger().timestamp();
    for i in 0..8u64 {
        let price = 100_0000000i128 + (i as i128) * 500_000;
        let ts = start + i * RESOLUTION as u64;
        s.env.ledger().set_timestamp(ts);
        s.mock.set_price(&vec![&s.env, price], &ts);
        s.oracle.nudge_volatility(&s.asset);
    }
    let now = s.env.ledger().timestamp();
    let series_id = register_series(&s, 90_0000000i128, now + 1_800);

    let premium = s.amm.quote(&series_id, &Side::Call);
    // Deep-ITM, near-expiry: premium should land close to intrinsic
    // (spot - strike), not panic.
    assert!(premium > 5_0000000i128 && premium < 15_0000000i128);
}

/// Reimplements the OLD fixed-window realized-vol formula (removed from
/// oracle-adapter in favor of the EWMA estimator) as a pure, test-only
/// function purely for this comparison — not linked into any contract.
/// Matches oracle-adapter's removed get_realized_vol exactly: simple
/// returns over a trailing window, sum-of-squares variance, annualized
/// by SECONDS_PER_YEAR / resolution.
fn windowed_annualized_vol(window: &[i128], resolution: u64) -> u32 {
    const RETURN_SCALE: i128 = 1_000_000;
    const SECONDS_PER_YEAR: u128 = 31_536_000;

    let mut sum_sq: i128 = 0;
    let mut n: u32 = 0;
    for pair in window.windows(2) {
        let prev_p = pair[0];
        let p = pair[1];
        if prev_p != 0 {
            let r = (p - prev_p).checked_mul(RETURN_SCALE).expect("return overflow") / prev_p;
            sum_sq = sum_sq.checked_add(r.checked_mul(r).expect("sq overflow")).expect("sum overflow");
            n += 1;
        }
    }
    if n == 0 {
        return 0;
    }
    let variance_scaled = sum_sq / (n as i128);
    let periods_per_year = SECONDS_PER_YEAR / (resolution as u128).max(1);
    let variance_annual_scaled = (variance_scaled as u128)
        .checked_mul(periods_per_year)
        .expect("annualization overflow");
    isqrt(variance_annual_scaled) as u32
}

/// Mirrors oracle-adapter's own isqrt exactly, for the windowed-vol
/// comparison arm above.
fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

#[test]
fn ewma_premiums_are_more_stable_than_windowed_across_a_regime_change() {
    // Simulates a calm period (small, tight price oscillations) followed
    // immediately by a volatile period (large swings) — a sudden vol
    // regime change, the scenario a fixed-window estimator handles
    // worst: old samples fall OUT of a 12-record window abruptly as the
    // window slides, so the reported vol (and the premium it drives)
    // jumps in discrete steps as extreme samples enter/exit. The EWMA
    // estimator instead folds each new observation in by a small
    // (1-lambda) fraction, so the same regime change shows up as a much
    // smoother glide in the quoted premium.
    const WINDOW: usize = 12;
    const CALM_STEPS: usize = 20;
    const VOLATILE_STEPS: usize = 20;
    const TOTAL_STEPS: usize = CALM_STEPS + VOLATILE_STEPS;
    // Matches setup()'s mock oracle, which reports 7 decimals.
    const PRICE_SCALE: i128 = 10_000_000;
    const BASE: i128 = 100_0000000i128; // 100.0 at PRICE_SCALE (1e7)
    const CALM_DELTA: i128 = BASE / 1_000; // ~0.1% swings
    const VOLATILE_DELTA: i128 = BASE * 3 / 100; // ~3% swings

    let s = setup();
    let start = s.env.ledger().timestamp();
    let strike = BASE; // ATM
    let expiry = start + 30 * 86_400; // far enough out that time decay isn't a confound

    let mut prices = [0i128; TOTAL_STEPS];
    for i in 0..CALM_STEPS {
        let d = if i % 2 == 0 { CALM_DELTA } else { -CALM_DELTA };
        prices[i] = BASE + d;
    }
    for i in 0..VOLATILE_STEPS {
        let d = if i % 2 == 0 { VOLATILE_DELTA } else { -VOLATILE_DELTA };
        prices[CALM_STEPS + i] = BASE + d;
    }

    let mut ewma_premium = [0i128; TOTAL_STEPS];
    let mut ewma_valid = [false; TOTAL_STEPS];
    let mut windowed_premium = [0i128; TOTAL_STEPS];
    let mut windowed_valid = [false; TOTAL_STEPS];

    for i in 0..TOTAL_STEPS {
        let ts = start + (i as u64) * RESOLUTION as u64;
        s.env.ledger().set_timestamp(ts);
        s.mock.set_price(&vec![&s.env, prices[i]], &ts);
        s.oracle.nudge_volatility(&s.asset);

        // EWMA: valid once MIN_VOL_SAMPLES (8) return observations have
        // been folded in — the 9th nudge (i == 8, 0-indexed).
        if i >= 8 {
            let sigma = s.oracle.get_realized_vol(&s.asset);
            ewma_premium[i] = crate::black_scholes(prices[i], strike, sigma, expiry, ts, Side::Call, PRICE_SCALE);
            ewma_valid[i] = true;
        }

        // Windowed: valid once WINDOW (12) trailing samples exist.
        if i + 1 >= WINDOW {
            let sigma = windowed_annualized_vol(&prices[i + 1 - WINDOW..=i], RESOLUTION as u64);
            windowed_premium[i] =
                crate::black_scholes(prices[i], strike, sigma, expiry, ts, Side::Call, PRICE_SCALE);
            windowed_valid[i] = true;
        }
    }

    // Compare stability over the range both estimators have data for.
    let mut ewma_max_jump: i128 = 0;
    let mut windowed_max_jump: i128 = 0;
    for i in (WINDOW)..TOTAL_STEPS {
        assert!(ewma_valid[i] && ewma_valid[i - 1] && windowed_valid[i] && windowed_valid[i - 1]);
        let ewma_jump = (ewma_premium[i] - ewma_premium[i - 1]).abs();
        let windowed_jump = (windowed_premium[i] - windowed_premium[i - 1]).abs();
        ewma_max_jump = ewma_max_jump.max(ewma_jump);
        windowed_max_jump = windowed_max_jump.max(windowed_jump);
    }

    assert!(
        ewma_max_jump < windowed_max_jump,
        "expected EWMA's largest single-step premium jump ({ewma_max_jump}) to be smaller than \
         the windowed approach's ({windowed_max_jump}) across the calm->volatile transition"
    );

    // The transition is sharpest exactly where the windowed approach's
    // sliding window first admits a volatile-regime sample (i ==
    // CALM_STEPS, i.e. one volatile price has entered a still-mostly-calm
    // window) — the EWMA's single-step reaction there should be smaller
    // too, since it weights the new observation by only (1-lambda).
    let transition = CALM_STEPS;
    let ewma_transition_jump = (ewma_premium[transition] - ewma_premium[transition - 1]).abs();
    let windowed_transition_jump = (windowed_premium[transition] - windowed_premium[transition - 1]).abs();
    assert!(
        ewma_transition_jump < windowed_transition_jump,
        "expected EWMA's jump right at the regime change ({ewma_transition_jump}) to be smaller \
         than the windowed approach's ({windowed_transition_jump})"
    );
}
