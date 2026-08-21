//! vault-accounting
//!
//! LP deposits, share accounting, and collateral custody backing open
//! option positions. The sole holder of collateral in the system —
//! amm-pool and settlement-keeper only ever call lock_collateral /
//! release_collateral, never touch the token balance directly.
#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Vec};

const LEDGER_THRESHOLD: u32 = 17_280;
const LEDGER_BUMP_TO: u32 = 535_680;

/// Share price is reported at a fixed 7-decimal (stroop) scale, matching
/// the collateral token's native decimals. 1.0 == 10_000_000.
const SHARE_PRICE_SCALE: i128 = 10_000_000;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    TokenAddr,
    AuthorizedCallers,
    Shares(Address),
    TotalShares,
    FreeCollateral,
    LockedCollateral,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 100,
    NotAuthorized = 101,
    ZeroAmount = 102,
    InsufficientFreeCollateral = 103,
    InsufficientShares = 104,
    InsufficientLockedCollateral = 105,
}

// Cross-contract callers (amm-pool, settlement-keeper) depend on this
// crate with default-features off, pulling in only this trait-generated
// client — never the full #[contract] impl below (see oracle-adapter's
// lib.rs for why: avoiding duplicate wasm-export symbols).
#[cfg(not(feature = "contract"))]
#[soroban_sdk::contractclient(name = "VaultAccountingClient")]
pub trait VaultAccountingInterface {
    fn lock_collateral(env: Env, caller: Address, amount: i128);
    fn credit_collateral(env: Env, caller: Address, from: Address, amount: i128);
    fn release_collateral(env: Env, caller: Address, amount: i128, payout: i128);
    fn pay_from_free(env: Env, caller: Address, to: Address, amount: i128);
}

#[cfg(feature = "contract")]
#[contract]
pub struct VaultAccounting;

#[cfg(feature = "contract")]
#[contractimpl]
impl VaultAccounting {
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenAddr, &token);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCallers, &Vec::<Address>::new(&env));
        env.storage().instance().set(&DataKey::TotalShares, &0i128);
        env.storage().instance().set(&DataKey::FreeCollateral, &0i128);
        env.storage().instance().set(&DataKey::LockedCollateral, &0i128);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    /// Errors: NotAuthorized
    pub fn add_authorized_caller(env: Env, admin: Address, caller: Address) -> Result<(), Error> {
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            return Err(Error::NotAuthorized);
        }
        admin.require_auth();
        let mut callers: Vec<Address> = env.storage().instance().get(&DataKey::AuthorizedCallers).unwrap();
        if !callers.contains(&caller) {
            callers.push_back(caller);
        }
        env.storage().instance().set(&DataKey::AuthorizedCallers, &callers);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    /// Errors: ZeroAmount
    pub fn deposit(env: Env, from: Address, amount: i128) -> Result<i128, Error> {
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        from.require_auth();

        let total_before = Self::total_collateral(&env);
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap();

        let shares = if total_shares == 0 || total_before == 0 {
            amount
        } else {
            amount
                .checked_mul(total_shares)
                .expect("deposit share mul overflow")
                / total_before
        };

        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAddr).unwrap();
        token::Client::new(&env, &token_addr).transfer(&from, &env.current_contract_address(), &amount);

        let free: i128 = env.storage().instance().get(&DataKey::FreeCollateral).unwrap();
        env.storage()
            .instance()
            .set(&DataKey::FreeCollateral, &(free.checked_add(amount).expect("free overflow")));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares.checked_add(shares).expect("shares overflow")));

        let holder_key = DataKey::Shares(from.clone());
        let held: i128 = env.storage().persistent().get(&holder_key).unwrap_or(0);
        let new_held = held.checked_add(shares).expect("holder shares overflow");
        env.storage().persistent().set(&holder_key, &new_held);
        env.storage().persistent().extend_ttl(&holder_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        env.events()
            .publish((symbol_short!("vault"), symbol_short!("deposit")), (from, amount, shares));
        Ok(shares)
    }

    /// A withdrawal exceeding FreeCollateral never partially executes
    /// against locked funds: it emits withdrawal_queued and errors.
    ///
    /// Errors: InsufficientShares, InsufficientFreeCollateral
    pub fn withdraw(env: Env, from: Address, shares: i128) -> Result<i128, Error> {
        from.require_auth();

        let holder_key = DataKey::Shares(from.clone());
        let held: i128 = env.storage().persistent().get(&holder_key).unwrap_or(0);
        if shares <= 0 || shares > held {
            return Err(Error::InsufficientShares);
        }

        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap();
        let total = Self::total_collateral(&env);
        let amount = shares.checked_mul(total).expect("withdraw amount mul overflow") / total_shares;

        let free: i128 = env.storage().instance().get(&DataKey::FreeCollateral).unwrap();
        if amount > free {
            let shortfall = amount - free;
            env.events().publish(
                (symbol_short!("vault"), symbol_short!("queued")),
                (from, shares, shortfall),
            );
            return Err(Error::InsufficientFreeCollateral);
        }

        env.storage()
            .instance()
            .set(&DataKey::FreeCollateral, &(free - amount));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares - shares));
        let new_held = held - shares;
        env.storage().persistent().set(&holder_key, &new_held);
        env.storage().persistent().extend_ttl(&holder_key, LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAddr).unwrap();
        token::Client::new(&env, &token_addr).transfer(&env.current_contract_address(), &from, &amount);

        env.events()
            .publish((symbol_short!("vault"), symbol_short!("withdraw")), (from, shares, amount));
        Ok(amount)
    }

    /// Pulls `amount` from `from` (e.g. an option buyer paying premium) into
    /// FreeCollateral, without minting LP shares — the premium belongs to
    /// the pool's existing LPs, not to a new depositor. Only an authorized
    /// caller (amm-pool) may invoke this, on behalf of its own caller.
    ///
    /// Errors: NotAuthorized, ZeroAmount
    pub fn credit_collateral(env: Env, caller: Address, from: Address, amount: i128) -> Result<(), Error> {
        Self::require_authorized_caller(&env, &caller)?;
        caller.require_auth();
        from.require_auth();
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAddr).unwrap();
        token::Client::new(&env, &token_addr).transfer(&from, &env.current_contract_address(), &amount);

        let free: i128 = env.storage().instance().get(&DataKey::FreeCollateral).unwrap();
        env.storage()
            .instance()
            .set(&DataKey::FreeCollateral, &(free.checked_add(amount).expect("free overflow")));
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    /// Errors: NotAuthorized, InsufficientFreeCollateral
    pub fn lock_collateral(env: Env, caller: Address, amount: i128) -> Result<(), Error> {
        Self::require_authorized_caller(&env, &caller)?;
        caller.require_auth();

        let free: i128 = env.storage().instance().get(&DataKey::FreeCollateral).unwrap();
        if amount > free {
            return Err(Error::InsufficientFreeCollateral);
        }
        let locked: i128 = env.storage().instance().get(&DataKey::LockedCollateral).unwrap();
        env.storage().instance().set(&DataKey::FreeCollateral, &(free - amount));
        env.storage()
            .instance()
            .set(&DataKey::LockedCollateral, &(locked.checked_add(amount).expect("locked overflow")));
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);
        Ok(())
    }

    /// Releases `amount` of previously-locked collateral: `payout` is
    /// transferred to `caller` (the authorized contract driving
    /// settlement/close-out, responsible for forwarding it to the actual
    /// position holder); the remainder (amount - payout) returns to
    /// FreeCollateral, owned by LPs.
    ///
    /// Errors: NotAuthorized, InsufficientLockedCollateral
    pub fn release_collateral(env: Env, caller: Address, amount: i128, payout: i128) -> Result<(), Error> {
        Self::require_authorized_caller(&env, &caller)?;
        caller.require_auth();

        if payout < 0 || payout > amount {
            return Err(Error::InsufficientLockedCollateral);
        }
        let locked: i128 = env.storage().instance().get(&DataKey::LockedCollateral).unwrap();
        if amount > locked {
            return Err(Error::InsufficientLockedCollateral);
        }
        let returned = amount - payout;
        let free: i128 = env.storage().instance().get(&DataKey::FreeCollateral).unwrap();

        env.storage().instance().set(&DataKey::LockedCollateral, &(locked - amount));
        env.storage()
            .instance()
            .set(&DataKey::FreeCollateral, &(free.checked_add(returned).expect("free overflow")));
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        if payout > 0 {
            let token_addr: Address = env.storage().instance().get(&DataKey::TokenAddr).unwrap();
            token::Client::new(&env, &token_addr).transfer(&env.current_contract_address(), &caller, &payout);
        }
        Ok(())
    }

    /// Pays `amount` out of FreeCollateral directly to `to` — used for
    /// incentive payments (e.g. settlement-keeper's keeper reward) that
    /// aren't tied to releasing a specific locked position.
    ///
    /// Errors: NotAuthorized, InsufficientFreeCollateral
    pub fn pay_from_free(env: Env, caller: Address, to: Address, amount: i128) -> Result<(), Error> {
        Self::require_authorized_caller(&env, &caller)?;
        caller.require_auth();
        if amount <= 0 {
            return Ok(());
        }
        let free: i128 = env.storage().instance().get(&DataKey::FreeCollateral).unwrap();
        if amount > free {
            return Err(Error::InsufficientFreeCollateral);
        }
        env.storage().instance().set(&DataKey::FreeCollateral, &(free - amount));
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP_TO);

        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAddr).unwrap();
        token::Client::new(&env, &token_addr).transfer(&env.current_contract_address(), &to, &amount);
        Ok(())
    }

    /// (Free + Locked) / TotalShares at 7-decimal scale — reflects locked
    /// collateral's exposure, not just idle balance, since LPs still own
    /// the collateral backing open positions.
    pub fn share_price(env: Env) -> i128 {
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0);
        if total_shares == 0 {
            return SHARE_PRICE_SCALE;
        }
        let total = Self::total_collateral(&env);
        total.checked_mul(SHARE_PRICE_SCALE).expect("share price mul overflow") / total_shares
    }

    fn total_collateral(env: &Env) -> i128 {
        let free: i128 = env.storage().instance().get(&DataKey::FreeCollateral).unwrap_or(0);
        let locked: i128 = env.storage().instance().get(&DataKey::LockedCollateral).unwrap_or(0);
        free.checked_add(locked).expect("total collateral overflow")
    }

    fn require_authorized_caller(env: &Env, caller: &Address) -> Result<(), Error> {
        let callers: Vec<Address> = env.storage().instance().get(&DataKey::AuthorizedCallers).unwrap();
        if !callers.contains(caller) {
            return Err(Error::NotAuthorized);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
