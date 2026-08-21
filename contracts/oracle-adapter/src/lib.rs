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

/// Minimum number of nudge_volatility observations required before the
/// EWMA estimator is trusted, rather than reporting a statistically thin
/// estimate.
const MIN_VOL_SAMPLES: u32 = 8;

const SECONDS_PER_YEAR: u128 = 31_536_000;

/// Scale for returns / volatility: 1e-6 units (matches get_realized_vol's
/// documented "annualized, 1e-6 scale" return).
const RETURN_SCALE: i128 = 1_000_000;

/// Default EWMA decay factor (1e-6 scale), applied per nudge_volatility
/// call. "Effective sample count" for an EWMA is ~1/(1-lambda); at a
/// keeper cadence of one nudge per oracle tick (Reflector's testnet feed
/// resolution, 300s), 8640 effective observations ~= 8640*300s = 30
/// days — the spec's original realized-vol window intent, now reached
/// incrementally instead of by pulling 8640 historical records in one
/// (resource-budget-blowing) call. lambda = 1 - 1/8640 = 0.99988425...,
/// rounded to 999_884 at this scale. Admin-tunable via set_ewma_lambda:
/// this value is only correct for a ~300s nudge cadence — a keeper
/// calling less often needs a smaller effective_N (larger 1-lambda) to
/// reach the same 30-day span in real time, and vice versa.
const DEFAULT_EWMA_LAMBDA: u32 = 999_884;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    ReflectorAddr,
    MaxStaleness,
    EwmaLambda,
    Ewma(Asset),
}

/// Incrementally-updated realized-volatility estimator for one asset.
/// Replaces a fixed-window recompute-from-scratch approach: instead of
/// pulling potentially thousands of historical price records in a single
/// transaction (which exceeds Soroban's per-transaction resource budget
/// well before a 30-day window's worth of 5-minute ticks — see the
/// technical spec's implementation note), nudge_volatility folds in one
/// new price observation at a time, using at most a single lastprice()
/// call.
///
/// var_rate is a *per-second* variance rate (not per-tick, per-window, or
/// annualized), scaled by RETURN_SCALE^2 (1e12). Working in a rate
/// (variance per unit time) rather than a per-tick variance is what lets
/// nudge_volatility tolerate irregular calling intervals: since
/// Var(return over dt) = sigma^2 * dt for a Brownian-motion-style price
/// process, each observation's instantaneous contribution
/// (return^2 / dt_seconds) is already a variance-rate sample, comparable
/// and combinable across nudges regardless of how much real time elapsed
/// between them. Annualizing is then a single multiply by
/// SECONDS_PER_YEAR — no dependence on the feed's resolution() at all.
#[contracttype]
#[derive(Clone)]
struct EwmaState {
    last_price: i128,
    last_update: u64,
    var_rate: i128,
    sample_count: u32,
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
    InvalidParameter = 6,
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
    fn get_realized_vol(env: Env, asset: Asset) -> u32;
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
        env.storage().instance().set(&DataKey::EwmaLambda, &DEFAULT_EWMA_LAMBDA);
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

    /// Folds one new price observation into the asset's EWMA volatility
    /// estimator. Pulls at most a single lastprice() call — never a
    /// historical window — so it stays cheap enough to call as often as a
    /// keeper bot (or any other caller; this is permissionless, like
    /// options-factory's create_series) wants to nudge it forward. Calling
    /// it more often makes the estimator's real-world memory span
    /// *shorter* per unit time (more observations decay the same
    /// per-call lambda faster in wall-clock terms) — see EwmaState's
    /// doc comment for why per-second variance rate makes this
    /// well-defined regardless of calling cadence.
    ///
    /// A no-op (still returns Ok) if the underlying feed hasn't ticked
    /// since the last nudge — repeatedly nudging during a quiet feed
    /// costs a call but never distorts the estimate with a manufactured
    /// zero-return observation.
    ///
    /// Errors: PriceUnavailable
    pub fn nudge_volatility(env: Env, asset: Asset) -> Result<(), Error> {
        let (price, timestamp) = Self::read_lastprice(&env, &asset)?;
        let key = DataKey::Ewma(asset.clone());
        let mut state: EwmaState = env.storage().persistent().get(&key).unwrap_or(EwmaState {
            last_price: 0,
            last_update: 0,
            var_rate: 0,
            sample_count: 0,
        });

        if state.last_price == 0 {
            // First-ever observation for this asset: seed and return —
            // no return can be computed from a single price.
            state.last_price = price;
            state.last_update = timestamp;
        } else {
            let dt = timestamp.saturating_sub(state.last_update);
            if dt > 0 && state.last_price != 0 {
                let r = (price - state.last_price)
                    .checked_mul(RETURN_SCALE)
                    .expect("return overflow")
                    / state.last_price;
                // Instantaneous variance-rate sample: r^2 (scaled 1e12)
                // per second elapsed. See EwmaState's doc comment.
                let sample = r.checked_mul(r).expect("sq overflow") / (dt as i128);

                let lambda: u32 = env.storage().instance().get(&DataKey::EwmaLambda).unwrap();
                let lambda = lambda as i128;
                state.var_rate = (lambda.checked_mul(state.var_rate).expect("ewma decay overflow")
                    + (RETURN_SCALE - lambda).checked_mul(sample).expect("ewma sample overflow"))
                    / RETURN_SCALE;
                state.sample_count = state.sample_count.saturating_add(1);
                state.last_price = price;
                state.last_update = timestamp;
            }
            // dt == 0: feed hasn't ticked since the last nudge — no-op.
        }

        env.storage().persistent().set(&key, &state);
        env.storage().persistent().extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        env.events().publish(
            (symbol_short!("vol"), symbol_short!("nudged")),
            (asset, state.var_rate, state.sample_count),
        );
        Ok(())
    }

    /// Annualized realized volatility, 1e-6 scale (e.g. 500_000 == 50%),
    /// from the EWMA estimator nudge_volatility maintains. Requires at
    /// least MIN_VOL_SAMPLES prior nudge_volatility calls that observed
    /// an actual price change.
    ///
    /// Errors: InsufficientHistory
    pub fn get_realized_vol(env: Env, asset: Asset) -> Result<u32, Error> {
        let state: EwmaState = env
            .storage()
            .persistent()
            .get(&DataKey::Ewma(asset))
            .unwrap_or(EwmaState { last_price: 0, last_update: 0, var_rate: 0, sample_count: 0 });
        if state.sample_count < MIN_VOL_SAMPLES {
            return Err(Error::InsufficientHistory);
        }

        // var_rate is per-second variance * 1e12; annualizing is a single
        // multiply (no resolution() dependence — see EwmaState's doc
        // comment), then isqrt(variance_annual * 1e12) = stdev_annual * 1e6.
        let variance_annual_scaled = (state.var_rate.max(0) as u128)
            .checked_mul(SECONDS_PER_YEAR)
            .expect("annualization overflow");
        Ok(isqrt(variance_annual_scaled) as u32)
    }

    /// Errors: NotAuthorized, InvalidParameter
    pub fn set_ewma_lambda(env: Env, admin: Address, lambda: u32) -> Result<(), Error> {
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            return Err(Error::NotAuthorized);
        }
        admin.require_auth();
        if lambda == 0 || (lambda as i128) >= RETURN_SCALE {
            return Err(Error::InvalidParameter);
        }
        env.storage().instance().set(&DataKey::EwmaLambda, &lambda);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
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
