//! amm-pool
//!
//! Prices premiums via Black-Scholes and executes buys/sells against
//! vault-accounting's pooled collateral. No dependency on options-factory:
//! this contract stores its own pricing metadata per series, populated by
//! options-factory via register_series when a series is created (that
//! call direction — options-factory depending on amm-pool, never the
//! reverse — is why register_series/is_underlying_supported exist here
//! rather than amm-pool reading options-factory's own storage).
#![no_std]

mod math;

use math::{fp_div, fp_ln, fp_mul, fp_sqrt, normal_cdf, MATH_SCALE};
use oracle_adapter::OracleAdapterClient;
use sep_40_oracle::Asset;
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Vec};
use vault_accounting::VaultAccountingClient;

const LEDGER_THRESHOLD: u32 = 17_280;
const LEDGER_BUMP_TO: u32 = 535_680;

/// Spot/strike/premium scale: 7-decimal, matching stroops. MVP
/// simplification — see the technical spec's "Types & math" section on
/// scale discipline; a production build would read decimals() per asset.
const PRICE_SCALE: i128 = 10_000_000;
const MATH_TO_PRICE: i128 = MATH_SCALE / PRICE_SCALE;

const SECONDS_PER_YEAR: i128 = 31_536_000;
/// Trailing window used for realized-volatility lookups, per spec (30d).
const REALIZED_VOL_WINDOW_SECS: u64 = 30 * 86_400;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Side {
    Call,
    Put,
}

#[contracttype]
#[derive(Clone)]
pub struct SeriesInfo {
    pub underlying: Asset,
    pub strike: i128,
    pub expiry: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Position {
    pub size: i128,
    pub premium_paid: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    OracleAddr,
    VaultAddr,
    TokenAddr,
    FactoryAddr,
    SettlementAddr,
    FeeBps,
    SupportedUnderlyings,
    SeriesMeta(u64),
    Position(Address, u64, Side),
    OpenInterest(u64),
    HoldersBySeries(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized = 200,
    AlreadyInitialized = 201,
    SeriesNotFound = 202,
    SeriesExpired = 203,
    SlippageExceeded = 204,
    InsufficientFreeCollateral = 205,
    NoOpenPosition = 206,
    UnderlyingNotSupported = 207,
    DuplicateSeries = 208,
}

// Cross-contract callers (options-factory, settlement-keeper) depend on
// this crate with default-features off, pulling in only this
// trait-generated client — never the full #[contract] impl below (see
// oracle-adapter's lib.rs for why: avoiding duplicate wasm-export symbols).
#[cfg(not(feature = "contract"))]
#[soroban_sdk::contractclient(name = "AmmPoolClient")]
pub trait AmmPoolInterface {
    fn is_underlying_supported(env: Env, underlying: Asset) -> bool;
    fn register_series(env: Env, caller: Address, series_id: u64, underlying: Asset, strike: i128, expiry: u64);
    fn holders_of_series(env: Env, series_id: u64) -> Vec<Address>;
    fn close_position(env: Env, caller: Address, holder: Address, series_id: u64, side: Side) -> Position;
}

#[cfg(feature = "contract")]
#[contract]
pub struct AmmPool;

#[cfg(feature = "contract")]
#[contractimpl]
impl AmmPool {
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle: Address,
        vault: Address,
        token: Address,
        fee_bps: u32,
        underlyings: Vec<Asset>,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::OracleAddr, &oracle);
        env.storage().instance().set(&DataKey::VaultAddr, &vault);
        env.storage().instance().set(&DataKey::TokenAddr, &token);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::SupportedUnderlyings, &underlyings);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    /// Registers options-factory's address as the sole caller of
    /// register_series. Called post-deployment, since amm-pool is
    /// deployed before options-factory exists (see deployment order).
    ///
    /// Errors: NotAuthorized
    pub fn set_factory(env: Env, admin: Address, factory: Address) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::FactoryAddr, &factory);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    /// Registers settlement-keeper's address as the sole caller of
    /// close_position. Called post-deployment, mirroring set_factory.
    ///
    /// Errors: NotAuthorized
    pub fn set_settlement(env: Env, admin: Address, settlement: Address) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::SettlementAddr, &settlement);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    pub fn get_position(env: Env, holder: Address, series_id: u64, side: Side) -> Position {
        env.storage()
            .persistent()
            .get(&DataKey::Position(holder, series_id, side))
            .unwrap_or(Position { size: 0, premium_paid: 0 })
    }

    /// Every distinct address that has ever bought either side of this
    /// series — settlement-keeper's only way to discover who to pay out,
    /// since Soroban storage has no native enumeration.
    pub fn holders_of_series(env: Env, series_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::HoldersBySeries(series_id))
            .unwrap_or(Vec::new(&env))
    }

    /// Zeroes out a holder's position during settlement and returns what
    /// it was, so settlement-keeper knows how much notional to release
    /// and how large a payout to compute. Settlement-only: amm-pool has
    /// no dependency on settlement-keeper, so this is the reverse edge —
    /// settlement-keeper calls in, gated by the registered SettlementAddr.
    ///
    /// Errors: NotAuthorized
    pub fn close_position(
        env: Env,
        caller: Address,
        holder: Address,
        series_id: u64,
        side: Side,
    ) -> Result<Position, Error> {
        let settlement: Address = env
            .storage()
            .instance()
            .get(&DataKey::SettlementAddr)
            .ok_or(Error::NotAuthorized)?;
        if caller != settlement {
            return Err(Error::NotAuthorized);
        }
        caller.require_auth();

        let pos_key = DataKey::Position(holder, series_id, side);
        let pos: Position = env.storage().persistent().get(&pos_key).unwrap_or(Position { size: 0, premium_paid: 0 });
        if pos.size > 0 {
            env.storage().persistent().set(&pos_key, &Position { size: 0, premium_paid: 0 });
            env.storage().persistent().extend_ttl(&pos_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);

            let oi_key = DataKey::OpenInterest(series_id);
            let oi: i128 = env.storage().persistent().get(&oi_key).unwrap_or(0);
            env.storage().persistent().set(&oi_key, &(oi - pos.size));
            env.storage().persistent().extend_ttl(&oi_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        }
        Ok(pos)
    }

    pub fn is_underlying_supported(env: Env, underlying: Asset) -> bool {
        let list: Vec<Asset> = env.storage().instance().get(&DataKey::SupportedUnderlyings).unwrap();
        list.iter().any(|a| assets_eq(&a, &underlying))
    }

    /// Errors: NotAuthorized, UnderlyingNotSupported, DuplicateSeries
    pub fn register_series(
        env: Env,
        caller: Address,
        series_id: u64,
        underlying: Asset,
        strike: i128,
        expiry: u64,
    ) -> Result<(), Error> {
        let factory: Address = env
            .storage()
            .instance()
            .get(&DataKey::FactoryAddr)
            .ok_or(Error::NotAuthorized)?;
        if caller != factory {
            return Err(Error::NotAuthorized);
        }
        caller.require_auth();

        if !Self::is_underlying_supported(env.clone(), underlying.clone()) {
            return Err(Error::UnderlyingNotSupported);
        }
        let key = DataKey::SeriesMeta(series_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::DuplicateSeries);
        }
        let info = SeriesInfo { underlying, strike, expiry };
        env.storage().persistent().set(&key, &info);
        env.storage().persistent().extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    /// Errors: SeriesNotFound, SeriesExpired
    pub fn quote(env: Env, series_id: u64, side: Side) -> Result<i128, Error> {
        let info = Self::series_info(&env, series_id)?;
        let now = env.ledger().timestamp();
        if now >= info.expiry {
            return Err(Error::SeriesExpired);
        }
        Ok(Self::price_premium(&env, &info, now, side))
    }

    /// Errors: SeriesNotFound, SeriesExpired, SlippageExceeded, InsufficientFreeCollateral
    pub fn buy(
        env: Env,
        buyer: Address,
        series_id: u64,
        side: Side,
        size: i128,
        max_premium: i128,
    ) -> Result<i128, Error> {
        buyer.require_auth();
        let info = Self::series_info(&env, series_id)?;
        let now = env.ledger().timestamp();
        if now >= info.expiry {
            return Err(Error::SeriesExpired);
        }

        let premium_per_unit = Self::price_premium(&env, &info, now, side);
        let premium_paid = premium_per_unit.checked_mul(size).expect("premium mul overflow") / PRICE_SCALE;
        if premium_paid > max_premium {
            return Err(Error::SlippageExceeded);
        }

        let notional = info.strike.checked_mul(size).expect("notional mul overflow") / PRICE_SCALE;

        let vault_addr: Address = env.storage().instance().get(&DataKey::VaultAddr).unwrap();
        let vault = VaultAccountingClient::new(&env, &vault_addr);
        let self_addr = env.current_contract_address();

        vault
            .try_lock_collateral(&self_addr, &notional)
            .map_err(|_| Error::InsufficientFreeCollateral)?
            .map_err(|_| Error::InsufficientFreeCollateral)?;

        if premium_paid > 0 {
            vault.credit_collateral(&self_addr, &buyer, &premium_paid);
        }

        let pos_key = DataKey::Position(buyer.clone(), series_id, side);
        let mut pos: Position = env.storage().persistent().get(&pos_key).unwrap_or(Position { size: 0, premium_paid: 0 });
        if pos.size == 0 {
            let holders_key = DataKey::HoldersBySeries(series_id);
            let mut holders: Vec<Address> = env.storage().persistent().get(&holders_key).unwrap_or(Vec::new(&env));
            if !holders.contains(&buyer) {
                holders.push_back(buyer.clone());
                env.storage().persistent().set(&holders_key, &holders);
                env.storage().persistent().extend_ttl(&holders_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);
            }
        }
        pos.size = pos.size.checked_add(size).expect("position size overflow");
        pos.premium_paid = pos.premium_paid.checked_add(premium_paid).expect("position premium overflow");
        env.storage().persistent().set(&pos_key, &pos);
        env.storage().persistent().extend_ttl(&pos_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        let oi_key = DataKey::OpenInterest(series_id);
        let oi: i128 = env.storage().persistent().get(&oi_key).unwrap_or(0);
        env.storage().persistent().set(&oi_key, &(oi.checked_add(size).expect("oi overflow")));
        env.storage().persistent().extend_ttl(&oi_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        env.events()
            .publish((symbol_short!("amm"), symbol_short!("buy"), series_id), (buyer, side, size, premium_paid));
        Ok(premium_paid)
    }

    /// Errors: SeriesNotFound, SlippageExceeded, NoOpenPosition
    pub fn sell(
        env: Env,
        seller: Address,
        series_id: u64,
        side: Side,
        size: i128,
        min_premium: i128,
    ) -> Result<i128, Error> {
        seller.require_auth();
        let info = Self::series_info(&env, series_id)?;
        let now = env.ledger().timestamp();

        let pos_key = DataKey::Position(seller.clone(), series_id, side);
        let mut pos: Position = env.storage().persistent().get(&pos_key).unwrap_or(Position { size: 0, premium_paid: 0 });
        if size <= 0 || size > pos.size {
            return Err(Error::NoOpenPosition);
        }

        let premium_per_unit = if now >= info.expiry {
            let oracle_addr: Address = env.storage().instance().get(&DataKey::OracleAddr).unwrap();
            let oracle = OracleAdapterClient::new(&env, &oracle_addr);
            let (spot, _ts) = oracle.get_price(&info.underlying);
            match side {
                Side::Call => (spot - info.strike).max(0),
                Side::Put => (info.strike - spot).max(0),
            }
        } else {
            Self::price_premium(&env, &info, now, side)
        };
        let proceeds = premium_per_unit.checked_mul(size).expect("proceeds mul overflow") / PRICE_SCALE;
        if proceeds < min_premium {
            return Err(Error::SlippageExceeded);
        }

        let notional_release = info.strike.checked_mul(size).expect("notional mul overflow") / PRICE_SCALE;

        let vault_addr: Address = env.storage().instance().get(&DataKey::VaultAddr).unwrap();
        let vault = VaultAccountingClient::new(&env, &vault_addr);
        let self_addr = env.current_contract_address();
        vault.release_collateral(&self_addr, &notional_release, &proceeds);

        if proceeds > 0 {
            let token_addr: Address = env.storage().instance().get(&DataKey::TokenAddr).unwrap();
            soroban_sdk::token::Client::new(&env, &token_addr).transfer(&self_addr, &seller, &proceeds);
        }

        pos.size -= size;
        env.storage().persistent().set(&pos_key, &pos);
        env.storage().persistent().extend_ttl(&pos_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        let oi_key = DataKey::OpenInterest(series_id);
        let oi: i128 = env.storage().persistent().get(&oi_key).unwrap_or(0);
        env.storage().persistent().set(&oi_key, &(oi - size));
        env.storage().persistent().extend_ttl(&oi_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        env.events()
            .publish((symbol_short!("amm"), symbol_short!("sell"), series_id), (seller, side, size, proceeds));
        Ok(proceeds)
    }

    fn require_admin(env: &Env, admin: &Address) -> Result<(), Error> {
        let stored: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if *admin != stored {
            return Err(Error::NotAuthorized);
        }
        Ok(())
    }

    fn series_info(env: &Env, series_id: u64) -> Result<SeriesInfo, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::SeriesMeta(series_id))
            .ok_or(Error::SeriesNotFound)
    }

    fn price_premium(env: &Env, info: &SeriesInfo, now: u64, side: Side) -> i128 {
        let oracle_addr: Address = env.storage().instance().get(&DataKey::OracleAddr).unwrap();
        let oracle = OracleAdapterClient::new(env, &oracle_addr);
        let (spot, _ts) = oracle.get_price(&info.underlying);
        let sigma = oracle.get_realized_vol(&info.underlying, &REALIZED_VOL_WINDOW_SECS);
        black_scholes(spot, info.strike, sigma, info.expiry, now, side)
    }
}

fn assets_eq(a: &Asset, b: &Asset) -> bool {
    match (a, b) {
        (Asset::Stellar(x), Asset::Stellar(y)) => x == y,
        (Asset::Other(x), Asset::Other(y)) => x == y,
        _ => false,
    }
}

/// Black-Scholes premium in PRICE_SCALE fixed point. r = 0 for v1 (no
/// yield-curve integration yet) — an MVP simplification per the technical
/// spec's pricing model section.
fn black_scholes(spot: i128, strike: i128, sigma_1e6: u32, expiry: u64, now: u64, side: Side) -> i128 {
    let intrinsic = match side {
        Side::Call => (spot - strike).max(0),
        Side::Put => (strike - spot).max(0),
    };
    if now >= expiry {
        return intrinsic;
    }

    let t_secs = (expiry - now) as i128;
    let sigma_m = (sigma_1e6 as i128) * 1000; // 1e-6 scale -> MATH_SCALE (1e9)
    let t_m = t_secs.checked_mul(MATH_SCALE).expect("T overflow") / SECONDS_PER_YEAR;
    let sigma_sqrt_t = fp_mul(sigma_m, fp_sqrt(t_m));

    // Volatility (or time) approaching zero: premium approaches intrinsic
    // value rather than dividing by a near-zero sigma*sqrt(T).
    const EPS: i128 = 1000;
    if sigma_sqrt_t <= EPS {
        return intrinsic;
    }

    let spot_m = spot.checked_mul(MATH_TO_PRICE).expect("spot scale overflow");
    let strike_m = strike.checked_mul(MATH_TO_PRICE).expect("strike scale overflow");
    let ln_ratio = fp_ln(fp_div(spot_m, strike_m));
    let sigma_sq_half_t = fp_mul(fp_mul(sigma_m, sigma_m) / 2, t_m);
    let d1 = fp_div(ln_ratio + sigma_sq_half_t, sigma_sqrt_t);
    let d2 = d1 - sigma_sqrt_t;

    let premium_m = match side {
        Side::Call => fp_mul(spot_m, normal_cdf(d1)) - fp_mul(strike_m, normal_cdf(d2)),
        Side::Put => fp_mul(strike_m, normal_cdf(-d2)) - fp_mul(spot_m, normal_cdf(-d1)),
    };

    (premium_m / MATH_TO_PRICE).max(0)
}

#[cfg(test)]
mod test;
