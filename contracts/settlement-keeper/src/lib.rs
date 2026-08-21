//! settlement-keeper
//!
//! Exercise/expiry settlement — the contract the off-chain keeper bot
//! calls, and where every other contract's state resolves. Discovers open
//! positions via amm-pool's per-series holder index (amm-pool has no
//! dependency on this crate, so settlement reaches in through the
//! close_position/holders_of_series edge registered via set_settlement).
#![no_std]

use amm_pool::{AmmPoolClient, Side};
use oracle_adapter::OracleAdapterClient;
use options_factory::OptionsFactoryClient;
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env};
use vault_accounting::VaultAccountingClient;

const LEDGER_THRESHOLD: u32 = 17_280;
const LEDGER_BUMP_TO: u32 = 535_680;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    OracleAddr,
    VaultAddr,
    FactoryAddr,
    AmmPoolAddr,
    TokenAddr,
    KeeperRewardBps,
    /// 10^decimals for the oracle's price feed — must match amm-pool's own
    /// PriceScale, since both price the same strike/spot values. Read
    /// once at initialize() via oracle-adapter.decimals(), same as
    /// amm-pool, rather than hardcoded.
    PriceScale,
    /// 10^decimals for the collateral token — must match amm-pool's own
    /// TokenScale. Distinct from PriceScale for the same reason it is in
    /// amm-pool: the oracle feed and the collateral token are different
    /// assets with independent decimal counts, so notional/payout values
    /// computed in PriceScale must be rescaled before any actual fund
    /// movement through vault-accounting or a token transfer.
    TokenScale,
    Settled(u64),
}

/// Converts a value from one fixed-point scale to another, via
/// multiply-then-divide — mirrors amm-pool's math::rescale (kept local
/// here rather than shared, since it's a single three-line function and
/// amm-pool's math module isn't part of its public interface).
fn rescale(value: i128, from_scale: i128, to_scale: i128) -> i128 {
    value.checked_mul(to_scale).expect("rescale overflow") / from_scale
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 400,
    NotYetExpired = 401,
    AlreadySettled = 402,
    SeriesNotFound = 403,
}

#[contract]
pub struct SettlementKeeper;

#[contractimpl]
impl SettlementKeeper {
    pub fn initialize(
        env: Env,
        oracle: Address,
        vault: Address,
        factory: Address,
        amm_pool: Address,
        token: Address,
        keeper_reward_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::OracleAddr) {
            return Err(Error::AlreadyInitialized);
        }
        let decimals = OracleAdapterClient::new(&env, &oracle).decimals();
        let price_scale = 10i128.checked_pow(decimals).expect("price scale overflow");
        let token_decimals = soroban_sdk::token::Client::new(&env, &token).decimals();
        let token_scale = 10i128.checked_pow(token_decimals).expect("token scale overflow");

        env.storage().instance().set(&DataKey::OracleAddr, &oracle);
        env.storage().instance().set(&DataKey::VaultAddr, &vault);
        env.storage().instance().set(&DataKey::FactoryAddr, &factory);
        env.storage().instance().set(&DataKey::AmmPoolAddr, &amm_pool);
        env.storage().instance().set(&DataKey::TokenAddr, &token);
        env.storage().instance().set(&DataKey::PriceScale, &price_scale);
        env.storage().instance().set(&DataKey::TokenScale, &token_scale);
        env.storage()
            .instance()
            .set(&DataKey::KeeperRewardBps, &keeper_reward_bps);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    pub fn is_settleable(env: Env, series_id: u64) -> bool {
        if env.storage().persistent().get(&DataKey::Settled(series_id)).unwrap_or(false) {
            return false;
        }
        let factory_addr: Address = env.storage().instance().get(&DataKey::FactoryAddr).unwrap();
        let factory = OptionsFactoryClient::new(&env, &factory_addr);
        match factory.try_get_series(&series_id) {
            Ok(Ok(info)) => env.ledger().timestamp() >= info.expiry,
            _ => false,
        }
    }

    /// Idempotent-safe: Settled is checked and set before any payout call,
    /// so a second call — even racing against the first — errors rather
    /// than double-paying.
    ///
    /// Errors: SeriesNotFound, NotYetExpired, AlreadySettled
    pub fn settle(env: Env, caller: Address, series_id: u64) -> Result<(), Error> {
        let settled_key = DataKey::Settled(series_id);
        if env.storage().persistent().get(&settled_key).unwrap_or(false) {
            return Err(Error::AlreadySettled);
        }

        let factory_addr: Address = env.storage().instance().get(&DataKey::FactoryAddr).unwrap();
        let factory = OptionsFactoryClient::new(&env, &factory_addr);
        let info = factory
            .try_get_series(&series_id)
            .map_err(|_| Error::SeriesNotFound)?
            .map_err(|_| Error::SeriesNotFound)?;

        if env.ledger().timestamp() < info.expiry {
            return Err(Error::NotYetExpired);
        }

        env.storage().persistent().set(&settled_key, &true);
        env.storage().persistent().extend_ttl(&settled_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        let oracle_addr: Address = env.storage().instance().get(&DataKey::OracleAddr).unwrap();
        let oracle = OracleAdapterClient::new(&env, &oracle_addr);
        let (final_price, _ts) = oracle.get_price(&info.underlying);

        let amm_addr: Address = env.storage().instance().get(&DataKey::AmmPoolAddr).unwrap();
        let amm = AmmPoolClient::new(&env, &amm_addr);
        let vault_addr: Address = env.storage().instance().get(&DataKey::VaultAddr).unwrap();
        let vault = VaultAccountingClient::new(&env, &vault_addr);
        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAddr).unwrap();
        let token = soroban_sdk::token::Client::new(&env, &token_addr);
        let self_addr = env.current_contract_address();
        let price_scale: i128 = env.storage().instance().get(&DataKey::PriceScale).unwrap();
        let token_scale: i128 = env.storage().instance().get(&DataKey::TokenScale).unwrap();

        let holders = amm.holders_of_series(&series_id);
        let mut total_payout: i128 = 0;

        for holder in holders.iter() {
            for side in [Side::Call, Side::Put] {
                let pos = amm.close_position(&self_addr, &holder, &series_id, &side);
                if pos.size <= 0 {
                    continue;
                }

                let notional_price_scale = info.strike.checked_mul(pos.size).expect("notional mul overflow") / price_scale;
                let notional = rescale(notional_price_scale, price_scale, token_scale);
                let intrinsic_per_unit = match side {
                    Side::Call => (final_price - info.strike).max(0),
                    Side::Put => (info.strike - final_price).max(0),
                };
                let raw_payout_price_scale = intrinsic_per_unit.checked_mul(pos.size).expect("payout mul overflow") / price_scale;
                let raw_payout = rescale(raw_payout_price_scale, price_scale, token_scale);
                // MVP cap: a call's true intrinsic value is unbounded above
                // strike, but the pool only ever locked `notional` — see
                // the technical spec's note on amm-pool's full-collateral
                // simplification. Deep ITM payouts are capped here.
                let payout = raw_payout.min(notional).max(0);

                vault.release_collateral(&self_addr, &notional, &payout);
                if payout > 0 {
                    token.transfer(&self_addr, &holder, &payout);
                }
                total_payout = total_payout.checked_add(payout).expect("total payout overflow");
            }
        }

        let keeper_reward_bps: u32 = env.storage().instance().get(&DataKey::KeeperRewardBps).unwrap();
        let keeper_reward = total_payout.checked_mul(keeper_reward_bps as i128).expect("reward mul overflow") / 10_000;
        if keeper_reward > 0 {
            vault.pay_from_free(&self_addr, &caller, &keeper_reward);
        }

        env.events().publish(
            (symbol_short!("keeper"), symbol_short!("settled"), series_id),
            (final_price, total_payout, keeper_reward, caller),
        );
        Ok(())
    }
}

#[cfg(test)]
mod test;
