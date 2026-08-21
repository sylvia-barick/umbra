//! options-factory
//!
//! Creates and registers option series on a fixed strike/expiry grid.
//! Depends on amm-pool: create_series both validates the underlying is
//! supported there and pushes the series' pricing metadata into amm-pool's
//! own storage via register_series (amm-pool has no dependency back on
//! this crate, so it can't read this contract's Series storage directly).
#![no_std]

use amm_pool::AmmPoolClient;
use sep_40_oracle::Asset;
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Vec};

const LEDGER_THRESHOLD: u32 = 17_280;
const LEDGER_BUMP_TO: u32 = 535_680;

#[contracttype]
#[derive(Clone)]
pub struct SeriesInfo {
    pub underlying: Asset,
    pub strike: i128,
    pub expiry: u64,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    AmmPoolAddr,
    NextSeriesId,
    Series(u64),
    SeriesByUnderlying(Asset),
    ApprovedExpiries,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 300,
    NotAuthorized = 301,
    ExpiryNotApproved = 302,
    UnderlyingNotSupported = 303,
    DuplicateSeries = 304,
    SeriesNotFound = 305,
}

// settlement-keeper depends on this crate with default-features off,
// pulling in only this trait-generated client — never the full
// #[contract] impl below (see oracle-adapter's lib.rs for why: avoiding
// duplicate wasm-export symbols).
#[cfg(not(feature = "contract"))]
#[soroban_sdk::contractclient(name = "OptionsFactoryClient")]
pub trait OptionsFactoryInterface {
    fn get_series(env: Env, series_id: u64) -> SeriesInfo;
}

#[cfg(feature = "contract")]
#[contract]
pub struct OptionsFactory;

#[cfg(feature = "contract")]
#[contractimpl]
impl OptionsFactory {
    pub fn initialize(
        env: Env,
        admin: Address,
        amm_pool: Address,
        approved_expiries: Vec<u64>,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AmmPoolAddr, &amm_pool);
        env.storage().instance().set(&DataKey::NextSeriesId, &1u64);
        env.storage().instance().set(&DataKey::ApprovedExpiries, &approved_expiries);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    /// Permissionless: any caller may create a series once its expiry is
    /// on the approved grid — only the grid itself is admin-gated.
    ///
    /// Errors: ExpiryNotApproved, UnderlyingNotSupported, DuplicateSeries
    pub fn create_series(env: Env, underlying: Asset, strike: i128, expiry: u64) -> Result<u64, Error> {
        let grid: Vec<u64> = env.storage().instance().get(&DataKey::ApprovedExpiries).unwrap();
        if !grid.contains(&expiry) {
            return Err(Error::ExpiryNotApproved);
        }

        let amm_addr: Address = env.storage().instance().get(&DataKey::AmmPoolAddr).unwrap();
        let amm = AmmPoolClient::new(&env, &amm_addr);
        if !amm.is_underlying_supported(&underlying) {
            return Err(Error::UnderlyingNotSupported);
        }

        let by_underlying_key = DataKey::SeriesByUnderlying(underlying.clone());
        let mut ids: Vec<u64> = env.storage().persistent().get(&by_underlying_key).unwrap_or(Vec::new(&env));
        for id in ids.iter() {
            let existing: SeriesInfo = env.storage().persistent().get(&DataKey::Series(id)).unwrap();
            if existing.strike == strike && existing.expiry == expiry {
                return Err(Error::DuplicateSeries);
            }
        }

        let series_id: u64 = env.storage().instance().get(&DataKey::NextSeriesId).unwrap();
        env.storage().instance().set(&DataKey::NextSeriesId, &(series_id + 1));

        let self_addr = env.current_contract_address();
        amm.register_series(&self_addr, &series_id, &underlying, &strike, &expiry);

        let created_at = env.ledger().timestamp();
        let info = SeriesInfo { underlying: underlying.clone(), strike, expiry, created_at };
        let series_key = DataKey::Series(series_id);
        env.storage().persistent().set(&series_key, &info);
        env.storage().persistent().extend_ttl(&series_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        ids.push_back(series_id);
        env.storage().persistent().set(&by_underlying_key, &ids);
        env.storage().persistent().extend_ttl(&by_underlying_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        env.events().publish(
            (symbol_short!("factory"), symbol_short!("created")),
            (series_id, underlying, strike, expiry),
        );
        Ok(series_id)
    }

    pub fn list_series(env: Env, underlying: Asset) -> Vec<SeriesInfo> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::SeriesByUnderlying(underlying))
            .unwrap_or(Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            let info: SeriesInfo = env.storage().persistent().get(&DataKey::Series(id)).unwrap();
            out.push_back(info);
        }
        out
    }

    /// Errors: SeriesNotFound
    pub fn get_series(env: Env, series_id: u64) -> Result<SeriesInfo, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Series(series_id))
            .ok_or(Error::SeriesNotFound)
    }

    /// Errors: NotAuthorized
    pub fn approve_expiry(env: Env, admin: Address, expiry: u64) -> Result<(), Error> {
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            return Err(Error::NotAuthorized);
        }
        admin.require_auth();
        let mut grid: Vec<u64> = env.storage().instance().get(&DataKey::ApprovedExpiries).unwrap();
        if !grid.contains(&expiry) {
            grid.push_back(expiry);
        }
        env.storage().instance().set(&DataKey::ApprovedExpiries, &grid);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }
}

#[cfg(test)]
mod test;
