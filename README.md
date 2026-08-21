# Umbra

European-style, cash-settled, fully-collateralized options on Soroban (Stellar). Testnet MVP — five contracts: `oracle-adapter`, `vault-accounting`, `amm-pool`, `options-factory`, `settlement-keeper`.

See [`TECHNICAL_SPEC.md`](./TECHNICAL_SPEC.md) for the full contract-by-contract spec (storage, interfaces, events, pricing math, invariants, test matrix).

## Build

Each contract builds to its own deployable `.wasm` — **build one package at a time**, not `--workspace`, since a combined build unifies Cargo features across contracts and breaks the client/impl split each contract uses to call the others without linker symbol collisions (see any contract's `Cargo.toml` `contract` feature, and the note at the top of `scripts/deploy_testnet.sh`).

```bash
rustup target add wasm32v1-none   # once
for pkg in oracle-adapter vault-accounting amm-pool options-factory settlement-keeper; do
  cargo build -p "$pkg" --target wasm32v1-none --release
done
```

Output: `target/wasm32v1-none/release/{oracle_adapter,vault_accounting,amm_pool,options_factory,settlement_keeper}.wasm`

## Test

Native tests run across the whole workspace at once (this is fine — the feature-unification issue above only affects the wasm cdylib build, not native test binaries):

```bash
cargo test --workspace
```

## Deploy

```bash
NETWORK=testnet \
SOURCE=<your stellar CLI identity> \
REFLECTOR_ADDR=<Reflector SEP-40 contract on the target network> \
TOKEN_ADDR=<SEP-41 collateral token, e.g. testnet USDC> \
  ./scripts/deploy_testnet.sh
```

Deploys and initializes all five contracts in the order their constructors require (Technical Spec §12), wires up the cross-contract authorization (`vault-accounting`'s authorized callers, `amm-pool`'s factory/settlement addresses), and writes the resulting contract IDs to `deployed_addresses.<network>.env`.

**After deploying, `oracle-adapter.nudge_volatility(asset)` must be called at least 9 times (with the underlying feed actually ticking between calls) before `amm-pool.quote`/`buy`/`sell` will work at all** — they read whatever `get_realized_vol` currently reports, and it errors `InsufficientHistory` until enough observations exist. In production this is a keeper bot's job, called on a regular cadence (roughly the oracle feed's own tick rate); nothing else nudges the estimator automatically. See Technical Spec §05 and §10 ("Volatility nudging").

## Live on testnet

Deployed against Stellar testnet, using Reflector's real CEX/DEX feed and native XLM as collateral:

| Contract | Address |
|---|---|
| oracle-adapter | `CC5NKPLHQ3I67PUGVNUQ45SOX3MAFJOKHWPFQWH7AFFK4EJJ3PYDFG6Y` |
| vault-accounting | `CA7EON5GQL5SBHWTXVAGHFHEOTTPTTVANGVAHZ6OILBP6BCMFV26JRCY` |
| amm-pool | `CANLF54KMDB4ITEGUQ6OLXXQOUVW5TVUSQOYO2YIOIYCSGLM6GAM466X` |
| options-factory | `CB746GQWLY4RCJ5SU6HBUPBC5SVINWZXHBQJXSTQY7RXBI5XCTPPTWTE` |
| settlement-keeper | `CDHIHSWYKFLB7ID7MO4YJ3FYHVCIUGEQA2SMYN3T7CJ2CZ2KTKOUOUOH` |

Reflector feed used: `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` (testnet CEX/DEX, 14 decimals). Collateral token: native XLM's Stellar Asset Contract, `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (7 decimals) — see `deployed_addresses.testnet.env` for a sourceable copy of these addresses.

**This deployment** (the current `oracle-adapter`, with the EWMA volatility estimator): verified live that `nudge_volatility` correctly seeds on its first call and correctly folds in a return on its second call once the real feed ticks (`sample_count: 0 → 1`, observed against actual Reflector price movement). Reaching the full 9-observation threshold `get_realized_vol` requires — and therefore a live `quote()`/`buy()` — needs ~40 minutes of real feed ticks at this cadence; not run to completion here, but exhaustively covered by the unit suite (`cargo test -p oracle-adapter` and `-p amm-pool`, 28 tests between them), including the exact 9-nudge threshold and the EWMA-vs-windowed premium-stability comparison.

**A prior deployment** (the fixed-window `get_realized_vol`, since replaced) *did* verify the full deposit → create series → quote → buy → settle lifecycle end-to-end live, including double-settle rejection — see git history for that deployment's addresses if useful as a reference; it's superseded, not currently live.

Four real bugs only surfaced by deploying against the live feed (all fixed and regression-tested — see `TECHNICAL_SPEC.md`'s implementation notes in Sections 05 and 07): a hardcoded 7-decimal price scale where Reflector's testnet feed actually reports 14; a fixed-window realized-vol calculation that requests more historical records than a single transaction's resource budget allows (~20 records max observed) — since replaced with the EWMA estimator described above; an unclamped fixed-point `exp()` that overflows `i128` for the extreme `d1`/`d2` values a near-expiry, moderately-ITM option produces; and a scale-conflation bug where notional/premium values computed in the oracle's price scale were passed directly as collateral-token amounts. None of these were reachable by same-scale unit-test mocks — worth remembering for the next oracle integration.
