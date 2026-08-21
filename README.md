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
