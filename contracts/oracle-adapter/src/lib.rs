//! oracle-adapter
//!
//! Normalizes the SEP-40 (Reflector) price feed into Umbra's internal
//! interface. Fails closed on stale or missing prices — nothing downstream
//! should ever see a synthetic "zero" or "last known" price.
#![no_std]

use sep_40_oracle::{Asset, PriceFeedClient};
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env};

/// Ledger-unit TTL constants (assuming ~5s ledgers).
/// threshold: extend once TTL drops below ~1 day of ledgers remaining.
/// bump_to: extend out to ~31 days of ledgers.
const LEDGER_THRESHOLD: u32 = 17_280;
const LEDGER_BUMP_TO: u32 = 535_680;

/// Minimum number of price samples required before realized volatility is
/// computed from them, rather than from a statistically thin sample.
const MIN_VOL_SAMPLES: u32 = 8;

const SECONDS_PER_YEAR: u128 = 31_536_000;

/// Scale for returns / volatility: 1e-6 units (matches get_realized_vol's
/// documented "annualized, 1e-6 scale" return).
const RETURN_SCALE: i128 = 1_000_000;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    ReflectorAddr,
    MaxStaleness,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    StalePrice = 3,
    PriceUnavailable = 4,
    InsufficientHistory = 5,
}

// Cross-contract callers (amm-pool, settlement-keeper) depend on this crate
// with default-features off, pulling in only this trait-generated client —
// never the full `#[contract]` impl below. Both blocks are mutually
// exclusive so exactly one `OracleAdapterClient` type ever exists in a
// given build; keep this trait's signatures in sync with the impl's.
#[cfg(not(feature = "contract"))]
#[soroban_sdk::contractclient(name = "OracleAdapterClient")]
pub trait OracleAdapterInterface {
    fn get_price(env: Env, asset: Asset) -> (i128, u64);
    fn get_realized_vol(env: Env, asset: Asset, window_secs: u64) -> u32;
    fn decimals(env: Env) -> u32;
}

#[cfg(feature = "contract")]
#[contract]
pub struct OracleAdapter;

#[cfg(feature = "contract")]
#[contractimpl]
impl OracleAdapter {
    /// Errors: AlreadyInitialized
    pub fn initialize(env: Env, admin: Address, reflector: Address, max_staleness: u64) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ReflectorAddr, &reflector);
        env.storage().instance().set(&DataKey::MaxStaleness, &max_staleness);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    /// Pass-through to the underlying Reflector feed's decimal scale.
    /// Never hardcode a scale for spot/strike values — read this at
    /// integration time, since it differs per asset feed (e.g. Reflector's
    /// CEX/DEX feed uses 14 decimals, its Stellar DEX feed may differ).
    pub fn decimals(env: Env) -> u32 {
        let reflector: Address = env.storage().instance().get(&DataKey::ReflectorAddr).unwrap();
        PriceFeedClient::new(&env, &reflector).decimals()
    }

    /// Errors: StalePrice, PriceUnavailable
    pub fn get_price(env: Env, asset: Asset) -> Result<(i128, u64), Error> {
        let (price, timestamp) = Self::read_lastprice(&env, &asset)?;
        let max_staleness: u64 = env.storage().instance().get(&DataKey::MaxStaleness).unwrap();
        let now = env.ledger().timestamp();
        let age = now.saturating_sub(timestamp);
        if age > max_staleness {
            env.events()
                .publish((symbol_short!("price"), symbol_short!("stale")), (asset, age));
            return Err(Error::StalePrice);
        }
        Ok((price, timestamp))
    }

    /// Arithmetic-mean TWAP over the trailing window. Samples are
    /// (approximately) evenly spaced at the feed's resolution, so a plain
    /// mean is a reasonable v1 stand-in for a true time-weighted average.
    ///
    /// Errors: InsufficientHistory
    pub fn get_twap(env: Env, asset: Asset, window_secs: u64) -> Result<i128, Error> {
        let prices = Self::read_price_window(&env, &asset, window_secs)?;
        if prices.is_empty() {
            return Err(Error::InsufficientHistory);
        }
        let mut sum: i128 = 0;
        for p in prices.iter() {
            sum = sum.checked_add(p).expect("twap sum overflow");
        }
        Ok(sum / prices.len() as i128)
    }

    /// Annualized realized volatility, 1e-6 scale (e.g. 500_000 == 50%).
    ///
    /// MVP simplification: uses simple (not log) returns between
    /// consecutive samples as an approximation of log returns — accurate
    /// for the small per-tick moves typical of the feed's resolution, and
    /// avoids needing a fixed-point ln() in a no-float environment.
    ///
    /// Errors: InsufficientHistory
    pub fn get_realized_vol(env: Env, asset: Asset, window_secs: u64) -> Result<u32, Error> {
        let prices = Self::read_price_window(&env, &asset, window_secs)?;
        if prices.len() < MIN_VOL_SAMPLES {
            return Err(Error::InsufficientHistory);
        }

        let reflector: Address = env.storage().instance().get(&DataKey::ReflectorAddr).unwrap();
        let client = PriceFeedClient::new(&env, &reflector);
        let resolution = client.resolution() as u128;

        // Sum of squared simple returns, scaled by RETURN_SCALE^2 (1e-12).
        let mut sum_sq: i128 = 0;
        let mut n: u32 = 0;
        let mut prev: Option<i128> = None;
        for p in prices.iter() {
            if let Some(prev_p) = prev {
                if prev_p != 0 {
                    let r = (p - prev_p)
                        .checked_mul(RETURN_SCALE)
                        .expect("return overflow")
                        / prev_p;
                    sum_sq = sum_sq.checked_add(r.checked_mul(r).expect("sq overflow")).expect("sum overflow");
                    n += 1;
                }
            }
            prev = Some(p);
        }
        if n == 0 {
            return Err(Error::InsufficientHistory);
        }

        // variance_scaled represents (per-period variance) * 1e12.
        let variance_scaled = sum_sq / (n as i128);

        // Annualize the variance (real math: variance_annual = variance_period * periods_per_year)
        // before taking the square root, so we never need sqrt() of a non-integer ratio.
        let periods_per_year = SECONDS_PER_YEAR / resolution.max(1);
        let variance_annual_scaled = (variance_scaled as u128)
            .checked_mul(periods_per_year)
            .expect("annualization overflow");

        let stdev_annual_scaled = isqrt(variance_annual_scaled);
        Ok(stdev_annual_scaled as u32)
    }

    /// Errors: NotAuthorized
    pub fn set_max_staleness(env: Env, admin: Address, secs: u64) -> Result<(), Error> {
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            return Err(Error::NotAuthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::MaxStaleness, &secs);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    fn read_lastprice(env: &Env, asset: &Asset) -> Result<(i128, u64), Error> {
        let reflector: Address = env.storage().instance().get(&DataKey::ReflectorAddr).unwrap();
        let client = PriceFeedClient::new(env, &reflector);
        let data = client.lastprice(asset).ok_or(Error::PriceUnavailable)?;
        Ok((data.price, data.timestamp))
    }

    fn read_price_window(env: &Env, asset: &Asset, window_secs: u64) -> Result<soroban_sdk::Vec<i128>, Error> {
        let reflector: Address = env.storage().instance().get(&DataKey::ReflectorAddr).unwrap();
        let client = PriceFeedClient::new(env, &reflector);
        let resolution = client.resolution().max(1) as u64;
        let records = ((window_secs / resolution) as u32).max(1);
        let data = client.prices(asset, &records).ok_or(Error::InsufficientHistory)?;
        let mut out = soroban_sdk::Vec::new(env);
        for d in data.iter() {
            out.push_back(d.price);
        }
        Ok(out)
    }
}

/// Integer square root (floor), Babylonian method. Used to keep realized
/// volatility entirely in checked i128/u128 fixed-point arithmetic.
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

#[cfg(test)]
mod test;
