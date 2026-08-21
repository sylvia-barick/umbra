use crate::{Error, OptionsFactory, OptionsFactoryClient};
use amm_pool::{AmmPool, AmmPoolClient};
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

struct Setup {
    env: Env,
    admin: Address,
    factory: OptionsFactoryClient<'static>,
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
    oracle.initialize(&admin, &mock_id, &3_600u64);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let _sac_client = StellarAssetClient::new(&env, &token_addr);

    let vault_id = env.register(VaultAccounting, ());
    let vault = VaultAccountingClient::new(&env, &vault_id);
    vault.initialize(&admin, &token_addr);

    let amm_id = env.register(AmmPool, ());
    let amm = AmmPoolClient::new(&env, &amm_id);
    amm.initialize(&admin, &oracle_id, &vault_id, &token_addr, &50u32, &vec![&env, asset.clone()]);

    let now = env.ledger().timestamp();
    let weekly_expiry = now + 7 * 86_400;

    let factory_id = env.register(OptionsFactory, ());
    let factory = OptionsFactoryClient::new(&env, &factory_id);
    factory.initialize(&admin, &amm_id, &vec![&env, weekly_expiry]);

    amm.set_factory(&admin, &factory_id);

    Setup { env, admin, factory, asset, weekly_expiry }
}

#[test]
fn create_series_on_approved_expiry_succeeds() {
    let s = setup();
    let series_id = s.factory.create_series(&s.asset, &90_0000000i128, &s.weekly_expiry);
    let info = s.factory.get_series(&series_id);
    assert_eq!(info.strike, 90_0000000i128);
    assert_eq!(info.expiry, s.weekly_expiry);
}

#[test]
fn create_series_on_non_approved_expiry_errors() {
    let s = setup();
    let bad_expiry = s.weekly_expiry + 1;
    let result = s.factory.try_create_series(&s.asset, &90_0000000i128, &bad_expiry);
    assert_eq!(result, Err(Ok(Error::ExpiryNotApproved)));
}

#[test]
fn create_series_is_permissionless() {
    // No caller/admin address is part of create_series's signature at all;
    // any account submitting the tx can call it once the grid slot exists.
    let s = setup();
    let series_id = s.factory.create_series(&s.asset, &80_0000000i128, &s.weekly_expiry);
    assert!(series_id > 0);
}

#[test]
fn approve_expiry_requires_admin() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    let result = s.factory.try_approve_expiry(&stranger, &(s.weekly_expiry + 86_400));
    assert_eq!(result, Err(Ok(Error::NotAuthorized)));
    let _ = &s.admin;
}
