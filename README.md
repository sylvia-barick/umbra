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

## Live on testnet

Deployed and verified end-to-end (deposit → create series → quote → buy → settle, including double-settle rejection) against Stellar testnet, using Reflector's real CEX/DEX feed and native XLM as collateral:

| Contract | Address |
|---|---|
| oracle-adapter | `CCJJTPQVX7JQW7FHSCIV5PTKP47ELH6JIYLIDPHFRMPJYX2OFSX2V2II` |
| vault-accounting | `CCUPYEWTZJU7TAVBZBUN4IIWO2GU4YM5VB5L5NHKDBNF25NFZNRTKUB7` |
| amm-pool | `CDYK47SD5OTKUYBUH2LHEQFFP76XDQQONQI6SCJKAEKHMJB6KMQZM7UP` |
| options-factory | `CAEI2FFI4QH6R76PA5SWZB3VQ63T3QQSK2XYWD7KBJK3FVOB4XPUWPZN` |
| settlement-keeper | `CCJDF4AIZDJOGNHN5UTGL5UBXXFZMRAVDEUDT5LIHFHYP34API6NWFLE` |

Reflector feed used: `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` (testnet CEX/DEX, 14 decimals). Collateral token: native XLM's Stellar Asset Contract, `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (7 decimals) — see `deployed_addresses.testnet.env` for a sourceable copy of these addresses.

Three real bugs only surfaced by deploying against the live feed (all fixed and regression-tested — see `TECHNICAL_SPEC.md`'s implementation notes in Sections 05 and 07): a hardcoded 7-decimal price scale where Reflector's testnet feed actually reports 14; a 30-day realized-volatility window that requests more historical records than a single transaction's resource budget allows (~20 records max observed); and an unclamped fixed-point `exp()` that overflows `i128` for the extreme `d1`/`d2` values a near-expiry, moderately-ITM option produces. None of these were reachable by same-scale unit-test mocks — worth remembering for the next oracle integration.
