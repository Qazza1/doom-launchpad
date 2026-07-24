#!/usr/bin/env bash
set -euo pipefail

check_size() {
  local contract_name="$1"
  local maximum_bytes="$2"
  local bytecode
  local byte_count

  bytecode="$(forge inspect "$contract_name" deployedBytecode)"
  bytecode="${bytecode#0x}"
  byte_count=$((${#bytecode} / 2))
  echo "$contract_name runtime: $byte_count bytes (limit: $maximum_bytes)"
  if ((byte_count > maximum_bytes)); then
    echo "$contract_name exceeds the audit-candidate size budget" >&2
    exit 1
  fi
}

check_size DoomLaunchFactory 23500
check_size V3LiquidityManager 12000
check_size PositionLocker 12000
