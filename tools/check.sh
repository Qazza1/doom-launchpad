#!/usr/bin/env bash
set -euo pipefail

if ! command -v forge >/dev/null 2>&1; then
  echo "forge is required; install a reviewed stable Foundry release first" >&2
  exit 1
fi

forge --version
forge fmt --check
forge build --sizes
forge test -vvv
bash tools/check-sizes.sh
