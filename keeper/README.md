# Umbra keeper

Off-chain automation for the Umbra options protocol. It has two jobs, run on
a loop every `POLL_INTERVAL_SECS`:

1. **`nudge_volatility`** on `oracle-adapter` for the configured underlying —
   folds the latest Reflector price tick into the EWMA realized-volatility
   estimator. Without this running continuously, `amm-pool.quote()` never
   accumulates the minimum sample count and every buy/sell reverts with
   `InsufficientHistory` forever. This is why a fresh deployment's frontend
   shows "warming up" indefinitely until a keeper is running.
2. **`settle`** any option series past its expiry, via `settlement-keeper`.
   Both calls are permissionless — the keeper account needs no admin rights,
   just enough XLM to pay transaction fees. It collects `keeper_reward_bps`
   of each settlement's payout as a fee, so a keeper watching real volume is
   roughly self-funding over time.

## Setup

```bash
cd keeper
npm install
cp .env.example .env
npm run fund          # generates + friendbot-funds a fresh testnet keypair,
                       # prints a KEEPER_SECRET_KEY to paste into .env
```

Fill in the contract addresses in `.env` from the repo root's
`deployed_addresses.testnet.env` (or your own deployment).

## Run

```bash
npm run dev            # ts directly, restarts on file changes
# or
npm run build && npm start   # compiled
```

Logs one line per action (`nudge_volatility(XLM) ok`, `settled series #3 (tx ...)`,
`is_settleable(#2) check failed: ...`) so it's easy to tail in any process
manager (systemd, pm2, a container's own log driver, etc.) — this is a plain
long-running Node process with no persistent state of its own; every cycle
re-derives what needs doing directly from chain state, so it's safe to
restart at any time without a recovery step.
