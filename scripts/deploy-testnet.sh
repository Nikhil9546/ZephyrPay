#!/usr/bin/env bash
# ZephyrPay — one-command testnet deploy.
#
# Reads credentials from .env at repo root, deploys all three contracts to
# HashKey Chain testnet, verifies role wiring on-chain, and writes the
# deployed addresses into app/.env.local so `pnpm dev` just works.
#
# Required env (put in .env at repo root):
#   DEPLOYER_PRIVATE_KEY      funded address on HashKey testnet
#   ATTESTOR_ADDRESS          0x-address of the backend attestor key
#   SCORER_ADDRESS            0x-address of the backend scorer key
#
# Optional env:
#   TREASURY_ADDRESS          defaults to deployer
#   HASHKEY_TESTNET_RPC       defaults to https://hashkeychain-testnet.alt.technology
#   HASHKEY_EXPLORER_API_KEY  for contract verification (if explorer supports it)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY required}"
: "${ATTESTOR_ADDRESS:?ATTESTOR_ADDRESS required (derive from ATTESTOR_PRIVATE_KEY with 'cast wallet address \$PK')}"
: "${SCORER_ADDRESS:?SCORER_ADDRESS required}"

export HASHKEY_TESTNET_RPC="${HASHKEY_TESTNET_RPC:-https://hashkeychain-testnet.alt.technology}"
export HASHKEY_TESTNET_EXPLORER_API="${HASHKEY_TESTNET_EXPLORER_API:-https://hashkeychain-testnet-explorer.alt.technology/api}"
export HASHKEY_MAINNET_RPC="${HASHKEY_MAINNET_RPC:-https://mainnet.hsk.xyz}"
export HASHKEY_EXPLORER_API_KEY="${HASHKEY_EXPLORER_API_KEY:-}"
TREASURY_ADDRESS="${TREASURY_ADDRESS:-$(cast wallet address "$DEPLOYER_PRIVATE_KEY")}"

echo "=== ZephyrPay testnet deploy ==="
echo "RPC      : $HASHKEY_TESTNET_RPC"
echo "Deployer : $(cast wallet address "$DEPLOYER_PRIVATE_KEY")"
echo "Attestor : $ATTESTOR_ADDRESS"
echo "Scorer   : $SCORER_ADDRESS"
echo "Treasury : $TREASURY_ADDRESS"
echo

# 1. Sanity: RPC reachable + deployer has gas
chain_id=$(cast chain-id --rpc-url "$HASHKEY_TESTNET_RPC")
echo "Connected to chain $chain_id"

deployer_addr=$(cast wallet address "$DEPLOYER_PRIVATE_KEY")
balance=$(cast balance "$deployer_addr" --rpc-url "$HASHKEY_TESTNET_RPC")
echo "Deployer balance: $balance wei"
if [[ "$balance" == "0" ]]; then
  echo "ERROR: deployer has 0 balance. Fund $deployer_addr from the HashKey testnet faucet first." >&2
  exit 1
fi

# 2. Build + test before broadcasting
echo
echo "--- forge test ---"
cd "$ROOT/contracts"
forge test >/dev/null
echo "ok"

# 3. Deploy
echo
echo "--- forge script Deploy.s.sol ---"
export DEPLOYER_PRIVATE_KEY ATTESTOR_ADDRESS SCORER_ADDRESS TREASURY_ADDRESS
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$HASHKEY_TESTNET_RPC" \
  --broadcast

# 4. Extract addresses from deployments/<chainId>.json
dfile="$ROOT/contracts/deployments/${chain_id}.json"
if [[ ! -f "$dfile" ]]; then
  echo "ERROR: deployment file not written: $dfile" >&2
  exit 1
fi

HKDM_ADDRESS=$(python3 -c "import json; print(json.load(open('$dfile'))['contracts']['HKDm'])")
POH_ADDRESS=$(python3 -c "import json; print(json.load(open('$dfile'))['contracts']['PoHRegistry'])")
CREDIT_ADDRESS=$(python3 -c "import json; print(json.load(open('$dfile'))['contracts']['CreditLine'])")

echo
echo "=== Deployed ==="
echo "HKDm        : $HKDM_ADDRESS"
echo "PoHRegistry : $POH_ADDRESS"
echo "CreditLine  : $CREDIT_ADDRESS"

# 5. Verify role wiring on-chain
echo
echo "--- verifying roles on-chain ---"
MINTER=$(cast keccak "MINTER_ROLE")
BURNER=$(cast keccak "BURNER_ROLE")
ATT=$(cast keccak "ATTESTOR_ROLE")
SCR=$(cast keccak "SCORER_ROLE")

check() {
  local label=$1 contract=$2 role=$3 account=$4
  local ok
  ok=$(cast call "$contract" "hasRole(bytes32,address)(bool)" "$role" "$account" --rpc-url "$HASHKEY_TESTNET_RPC")
  if [[ "$ok" == "true" ]]; then
    echo "  ✓ $label"
  else
    echo "  ✗ $label -- MISSING" >&2
    exit 1
  fi
}
check "HKDm MINTER_ROLE → CreditLine" "$HKDM_ADDRESS" "$MINTER" "$CREDIT_ADDRESS"
check "HKDm BURNER_ROLE → CreditLine" "$HKDM_ADDRESS" "$BURNER" "$CREDIT_ADDRESS"
check "PoH ATTESTOR_ROLE → attestor"   "$POH_ADDRESS"  "$ATT"    "$ATTESTOR_ADDRESS"
check "Credit SCORER_ROLE → scorer"    "$CREDIT_ADDRESS" "$SCR"  "$SCORER_ADDRESS"

# 6. Stamp app/.env.local with the live addresses
ENV_APP="$ROOT/app/.env.local"
if [[ ! -f "$ENV_APP" ]]; then
  cp "$ROOT/.env.example" "$ENV_APP"
fi

update_env() {
  local key=$1 value=$2 file=$3
  if grep -q "^${key}=" "$file"; then
    # macOS sed needs -i ''
    sed -i '' -e "s|^${key}=.*|${key}=${value}|" "$file" 2>/dev/null || sed -i -e "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

update_env NEXT_PUBLIC_HKDM_ADDRESS "$HKDM_ADDRESS" "$ENV_APP"
update_env NEXT_PUBLIC_POH_REGISTRY_ADDRESS "$POH_ADDRESS" "$ENV_APP"
update_env NEXT_PUBLIC_CREDIT_LINE_ADDRESS "$CREDIT_ADDRESS" "$ENV_APP"
update_env NEXT_PUBLIC_CHAIN_ID "$chain_id" "$ENV_APP"

echo
echo "=== Done ==="
echo "Addresses written to $ENV_APP"
echo
echo "Next:"
echo "  1. Fill DEEPSEEK_API_KEY and NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in $ENV_APP"
echo "  2. pnpm dev"
