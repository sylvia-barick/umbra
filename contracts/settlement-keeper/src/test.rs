use crate::{Error, SettlementKeeper, SettlementKeeperClient};
use amm_pool::{AmmPool, AmmPoolClient, Side};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use options_factory::{OptionsFactory, OptionsFactoryClient};
use sep_40_oracle::{
    testutils::{Asset as MockAsset, MockPriceOracleClient, MockPriceOracleWASM},
    Asset,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, Symbol,
};
use vault_accounting::{VaultAccounting, VaultAccountingClient};

const RESOLUTION: u32 = 300;
const MAX_STALENESS: u64 = 3_600;
const KEEPER_REWARD_BPS: u32 = 500; // 5%

struct Setup {
    env: Env,
    admin: Address,
    oracle: OracleAdapterClient<'static>,
    mock: MockPriceOracleClient<'static>,
    vault: VaultAccountingClient<'static>,
    amm: AmmPoolClient<'static>,
    factory: OptionsFactoryClient<'static>,
    keeper: SettlementKeeperClient<'static>,
    token: TokenClient<'static>,
    token_addr: Address,
    asset: Asset,
    weekly_expiry: u64,
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
    // 8 zero-return observations, clearing MIN_VOL_SAMPLES).
    let start = env.ledger().timestamp();
    for i in 0..9u64 {
        let ts = start + i * RESOLUTION as u64;
        env.ledger().set_timestamp(ts);
        mock.set_price(&vec![&env, 100_0000000i128], &ts);
        oracle.nudge_volatility(&asset);
    }
    let now = env.ledger().timestamp();

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token = TokenClient::new(&env, &token_addr);
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

    let weekly_expiry = now + 7 * 86_400;
    let factory_id = env.register(OptionsFactory, ());
    let factory = OptionsFactoryClient::new(&env, &factory_id);
    factory.initialize(&admin, &amm_id, &vec![&env, weekly_expiry]);
    amm.set_factory(&admin, &factory_id);

    let keeper_id = env.register(SettlementKeeper, ());
    let keeper = SettlementKeeperClient::new(&env, &keeper_id);
    keeper.initialize(&oracle_id, &vault_id, &factory_id, &amm_id, &token_addr, &KEEPER_REWARD_BPS);
    amm.set_settlement(&admin, &keeper_id);
    vault.add_authorized_caller(&admin, &keeper_id);

    Setup {
        env,
        admin,
        oracle,
        mock,
        vault,
        amm,
        factory,
        keeper,
        token,
        token_addr,
        asset,
        weekly_expiry,
    }
}

#[test]
fn settle_pays_correct_amount_with_mismatched_oracle_and_token_decimals() {
    // The buy-path scale-conflation bug (notional/premium computed in the
    // oracle's price scale, then passed directly as a token amount) has
    // a mirror-image risk here: settle()'s payout does the same kind of
    // price-to-collateral conversion (strike/intrinsic, in the oracle's
    // scale, times position size, rescaled into the collateral token's
    // scale) on the way OUT. Reproduces the exact live-testnet mismatch
    // (Reflector's 14-decimal feed vs. native XLM's 7-decimal SAC) all
    // the way through a real settlement, and asserts the ITM payout
    // lands at a plausible few-hundredths-of-a-token amount — not the
    // ~10,000,000x-inflated (or, the other direction, truncated-to-zero)
    // value a missed rescale would produce.
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
    let now = env.ledger().timestamp();

    // 7-decimal collateral token (native-XLM-like), deliberately
    // different from the oracle's 14 decimals.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token = TokenClient::new(&env, &token_addr);
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

    let expiry = now + 1_800;
    let factory_id = env.register(OptionsFactory, ());
    let factory = OptionsFactoryClient::new(&env, &factory_id);
    factory.initialize(&admin, &amm_id, &vec![&env, expiry]);
    amm.set_factory(&admin, &factory_id);

    let keeper_id = env.register(SettlementKeeper, ());
    let keeper = SettlementKeeperClient::new(&env, &keeper_id);
    keeper.initialize(&oracle_id, &vault_id, &factory_id, &amm_id, &token_addr, &KEEPER_REWARD_BPS);
    amm.set_settlement(&admin, &keeper_id);
    vault.add_authorized_caller(&admin, &keeper_id);

    // $0.18 strike at 14-decimal scale.
    let strike = 18_000_000_000_000i128;
    let series_id = factory.create_series(&asset, &strike, &expiry);

    let buyer = Address::generate(&env);
    sac_client.mint(&buyer, &10_0000000i128); // 10 tokens
    let size = 100_000_000_000_000i128; // 1 whole contract at the 14-decimal price_scale
    amm.buy(&buyer, &series_id, &Side::Call, &size, &10_0000000i128);
    let buyer_balance_after_buy = token.balance(&buyer);

    // Settle deep-ish ITM: spot rises to $0.22, intrinsic = 0.04.
    env.ledger().set_timestamp(expiry + 1);
    mock.set_price(&vec![&env, 22_000_000_000_000i128], &(expiry + 1));

    let bot = Address::generate(&env);
    keeper.settle(&bot, &series_id);

    // Expected payout: intrinsic(0.04) * size(1 contract), rescaled from
    // the 14-decimal price scale into the 7-decimal token scale ==
    // 400_000 raw (0.04 tokens) — not ~4e12 (unrescaled) or 0 (scale
    // collapsed the wrong direction).
    let payout = token.balance(&buyer) - buyer_balance_after_buy;
    assert_eq!(payout, 400_000i128);
}

#[test]
fn settle_before_expiry_errors() {
    let s = setup();
    let series_id = s.factory.create_series(&s.asset, &90_0000000i128, &s.weekly_expiry);
    let bot = Address::generate(&s.env);

    let result = s.keeper.try_settle(&bot, &series_id);
    assert_eq!(result, Err(Ok(Error::NotYetExpired)));
}

#[test]
fn double_settle_errors_and_first_payout_untouched() {
    let s = setup();
    let series_id = s.factory.create_series(&s.asset, &90_0000000i128, &s.weekly_expiry);

    let buyer = Address::generate(&s.env);
    let mint = StellarAssetClient::new(&s.env, &s.token_addr);
    mint.mint(&buyer, &1_000_0000000i128);
    s.amm.buy(&buyer, &series_id, &Side::Call, &1_0000000i128, &1_000_0000000i128);

    s.env.ledger().set_timestamp(s.weekly_expiry + 1);
    // Refresh the price feed so it isn't considered stale at settlement time.
    s.mock.set_price(&vec![&s.env, 120_0000000i128], &(s.weekly_expiry + 1));

    let bot = Address::generate(&s.env);
    s.keeper.settle(&bot, &series_id);
    let buyer_balance_after_first = s.token.balance(&buyer);
    assert!(buyer_balance_after_first > 0);

    let result = s.keeper.try_settle(&bot, &series_id);
    assert_eq!(result, Err(Ok(Error::AlreadySettled)));
    assert_eq!(s.token.balance(&buyer), buyer_balance_after_first);
}

#[test]
fn full_lifecycle_pays_itm_holder_and_keeper_reward() {
    let s = setup();
    let series_id = s.factory.create_series(&s.asset, &90_0000000i128, &s.weekly_expiry);

    let buyer = Address::generate(&s.env);
    let mint = StellarAssetClient::new(&s.env, &s.token_addr);
    mint.mint(&buyer, &1_000_0000000i128);
    let premium = s.amm.buy(&buyer, &series_id, &Side::Call, &1_0000000i128, &1_000_0000000i128);
    assert_eq!(premium, 10_0000000i128); // spot(100) - strike(90), vol ~0
    let buyer_balance_after_buy = s.token.balance(&buyer);

    s.env.ledger().set_timestamp(s.weekly_expiry + 1);
    s.mock.set_price(&vec![&s.env, 120_0000000i128], &(s.weekly_expiry + 1));

    let bot = Address::generate(&s.env);
    let bot_balance_before = s.token.balance(&bot);
    s.keeper.settle(&bot, &series_id);

    // Call intrinsic at settlement: 120 - 90 = 30, size 1 -> 30 paid to buyer
    // on top of their post-buy balance.
    assert_eq!(s.token.balance(&buyer), buyer_balance_after_buy + 30_0000000i128);

    let bot_balance_after = s.token.balance(&bot);
    assert!(bot_balance_after > bot_balance_before, "keeper reward should be paid");

    let is_settleable_after = s.keeper.is_settleable(&series_id);
    assert!(!is_settleable_after);
    let _ = &s.oracle;
    let _ = &s.admin;
    let _ = &s.vault;
}
