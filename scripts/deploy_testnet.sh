#!/usr/bin/env bash
# Deploys and initializes all five Umbra contracts to a network, in the
# strict order required by their constructor dependencies (see
# TECHNICAL_SPEC.md Section 12 — Initialization order).
#
# Usage:
#   NETWORK=testnet SOURCE=alice REFLECTOR_ADDR=C... TOKEN_ADDR=C... \
#     ./scripts/deploy_testnet.sh
#
# Required env vars:
#   SOURCE          stellar CLI identity/key to deploy and sign with
#   REFLECTOR_ADDR  deployed Reflector (SEP-40) price-feed contract address
#   TOKEN_ADDR      SEP-41 collateral token address (e.g. testnet USDC)
#
# Optional env vars (defaults shown):
#   NETWORK=testnet
#   ADMIN=$SOURCE
#   MAX_STALENESS=300          seconds, oracle-adapter
#   FEE_BPS=50                 amm-pool protocol fee, basis points
#   KEEPER_REWARD_BPS=500      settlement-keeper reward, basis points (5%)
#   UNDERLYING_SYMBOL=XLM      Asset::Other(Symbol) registered as supported
#   EXPIRY_OFFSET_SECS=604800  first approved expiry = now + this (default 7d)
#
# Writes deployed contract IDs to deployed_addresses.<network>.env in the
# repo root, sourceable by later scripts (e.g. a demo/settlement runner).

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:?SOURCE is required (stellar CLI identity or key)}"
REFLECTOR_ADDR="${REFLECTOR_ADDR:?REFLECTOR_ADDR is required (Reflector SEP-40 contract address)}"
TOKEN_ADDR="${TOKEN_ADDR:?TOKEN_ADDR is required (SEP-41 collateral token address)}"
ADMIN="${ADMIN:-$SOURCE}"
MAX_STALENESS="${MAX_STALENESS:-300}"
FEE_BPS="${FEE_BPS:-50}"
KEEPER_REWARD_BPS="${KEEPER_REWARD_BPS:-500}"
UNDERLYING_SYMBOL="${UNDERLYING_SYMBOL:-XLM}"
EXPIRY_OFFSET_SECS="${EXPIRY_OFFSET_SECS:-604800}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_DIR="$REPO_ROOT/target/wasm32v1-none/release"
OUT_FILE="$REPO_ROOT/deployed_addresses.$NETWORK.env"

log() { echo ">> $*" >&2; }

deploy() {
    local wasm="$1"
    stellar contract deploy \
        --wasm "$WASM_DIR/$wasm" \
        --source-account "$SOURCE" \
        --network "$NETWORK" \
        2>/dev/null
}

invoke() {
    local id="$1"; shift
    stellar contract invoke \
        --id "$id" \
        --source-account "$SOURCE" \
        --network "$NETWORK" \
        -- "$@"
}

log "Building all 5 contracts to wasm32v1-none release (one package at a time —"
log "a combined --workspace build unifies features across contracts and breaks"
log "the client/impl split; see TECHNICAL_SPEC.md and each Cargo.toml's"
log "'contract' feature for why)."
for pkg in oracle-adapter vault-accounting amm-pool options-factory settlement-keeper; do
    (cd "$REPO_ROOT" && cargo build -p "$pkg" --target wasm32v1-none --release)
done

now_epoch() { date -u +%s; }
NOW="$(now_epoch)"
EXPIRY=$((NOW + EXPIRY_OFFSET_SECS))

log "1/7 Deploying oracle-adapter..."
ORACLE_ADAPTER_ID="$(deploy oracle_adapter.wasm)"
invoke "$ORACLE_ADAPTER_ID" initialize \
    --admin "$ADMIN" --reflector "$REFLECTOR_ADDR" --max_staleness "$MAX_STALENESS"
log "    oracle-adapter: $ORACLE_ADAPTER_ID"

log "2/7 Deploying vault-accounting..."
VAULT_ACCOUNTING_ID="$(deploy vault_accounting.wasm)"
invoke "$VAULT_ACCOUNTING_ID" initialize --admin "$ADMIN" --token "$TOKEN_ADDR"
log "    vault-accounting: $VAULT_ACCOUNTING_ID"

log "3/7 Deploying amm-pool..."
AMM_POOL_ID="$(deploy amm_pool.wasm)"
invoke "$AMM_POOL_ID" initialize \
    --admin "$ADMIN" \
    --oracle "$ORACLE_ADAPTER_ID" \
    --vault "$VAULT_ACCOUNTING_ID" \
    --token "$TOKEN_ADDR" \
    --fee_bps "$FEE_BPS" \
    --underlyings "[{\"Other\":\"$UNDERLYING_SYMBOL\"}]"
log "    amm-pool: $AMM_POOL_ID"

log "4/7 Registering amm-pool as an authorized caller on vault-accounting..."
invoke "$VAULT_ACCOUNTING_ID" add_authorized_caller --admin "$ADMIN" --caller "$AMM_POOL_ID"

log "5/7 Deploying options-factory (approved-expiry grid: now + ${EXPIRY_OFFSET_SECS}s = $EXPIRY)..."
OPTIONS_FACTORY_ID="$(deploy options_factory.wasm)"
invoke "$OPTIONS_FACTORY_ID" initialize \
    --admin "$ADMIN" --amm_pool "$AMM_POOL_ID" --approved_expiries "[$EXPIRY]"
log "    options-factory: $OPTIONS_FACTORY_ID"

log "    Registering options-factory as amm-pool's series-registration caller..."
invoke "$AMM_POOL_ID" set_factory --admin "$ADMIN" --factory "$OPTIONS_FACTORY_ID"

log "6/7 Deploying settlement-keeper..."
SETTLEMENT_KEEPER_ID="$(deploy settlement_keeper.wasm)"
invoke "$SETTLEMENT_KEEPER_ID" initialize \
    --oracle "$ORACLE_ADAPTER_ID" \
    --vault "$VAULT_ACCOUNTING_ID" \
    --factory "$OPTIONS_FACTORY_ID" \
    --amm_pool "$AMM_POOL_ID" \
    --token "$TOKEN_ADDR" \
    --keeper_reward_bps "$KEEPER_REWARD_BPS"
log "    settlement-keeper: $SETTLEMENT_KEEPER_ID"

log "7/7 Registering settlement-keeper as an authorized caller on vault-accounting"
log "    and as amm-pool's position-closing caller..."
invoke "$VAULT_ACCOUNTING_ID" add_authorized_caller --admin "$ADMIN" --caller "$SETTLEMENT_KEEPER_ID"
invoke "$AMM_POOL_ID" set_settlement --admin "$ADMIN" --settlement "$SETTLEMENT_KEEPER_ID"

cat > "$OUT_FILE" <<EOF
# Generated by scripts/deploy_testnet.sh on $(date -u +%FT%TZ)
export NETWORK="$NETWORK"
export ORACLE_ADAPTER_ID="$ORACLE_ADAPTER_ID"
export VAULT_ACCOUNTING_ID="$VAULT_ACCOUNTING_ID"
export AMM_POOL_ID="$AMM_POOL_ID"
export OPTIONS_FACTORY_ID="$OPTIONS_FACTORY_ID"
export SETTLEMENT_KEEPER_ID="$SETTLEMENT_KEEPER_ID"
export TOKEN_ADDR="$TOKEN_ADDR"
export REFLECTOR_ADDR="$REFLECTOR_ADDR"
EOF

log "Done. Addresses written to $OUT_FILE"
log ""
log "oracle-adapter:     $ORACLE_ADAPTER_ID"
log "vault-accounting:   $VAULT_ACCOUNTING_ID"
log "amm-pool:           $AMM_POOL_ID"
log "options-factory:    $OPTIONS_FACTORY_ID"
log "settlement-keeper:  $SETTLEMENT_KEEPER_ID"
