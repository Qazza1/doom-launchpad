# Stage 4 preparation validation

Validation date: 2026-07-25. No private key, seed phrase, keystore, or hardware
wallet was loaded. No transaction was signed or broadcast.

## Implemented

- Corrected the dependency-safe order to deploy `DoomRewards` before
  `PositionLocker`.
- Added the exact six-transaction constructor and nonce worksheet.
- Added a fail-closed deployment manifest with empty nonce, transaction,
  deployed-address, audit, approval, gas, and verification fields.
- Added a machine gate that rejects broadcast approval, the wrong dependency
  order, populated transaction fields, or premature verification claims.
- Added a one-transaction-at-a-time deployment runbook with stop conditions.
- Added the manifest gate to GitHub Actions and the local verification script.
- Owner selected the hardware-wallet signing path; device-address verification
  and the signing rehearsal remain incomplete.

## Validation results

- Stage 4 canonical manifest validation passed.
- Manifest negative tests passed for:
  - broadcast or mainnet approval enabled;
  - dependency-unsafe deployment order;
  - populated transaction address;
  - premature verification claim.
- Dual-RPC preflight tests passed for independent HTTPS providers and detection
  of chain, head, pending-nonce, and dependency-bytecode disagreement.
- 69 contract tests passed; 2 fork tests were skipped in the normal gate.
- 8 deterministic rewards tests passed.
- 13 keeper-monitoring tests passed.
- 2 opt-in Robinhood mainnet-fork tests passed:
  - approved configuration non-broadcast deployment rehearsal;
  - canonical V3 launch and permanent-lock compatibility.
- Runtime bytecode remains within all frozen size budgets.
- GitHub Actions deployment preparation, Foundry, Slither/Aderyn, rewards, and
  keeper jobs passed:
  `https://github.com/Qazza1/doom-launchpad/actions/runs/30121596609`.

## Still blocking deployment

- Independent review of the exact contract tag.
- Remediation and focused re-review of every resulting contract change.
- Owner choice of hardware wallet or encrypted keystore.
- Dedicated primary and fallback RPC configuration stored locally.
- Fresh nonce, gas, gas-price, balance, and funding worksheet.
- Blockscout verification rehearsal.
- Completed, hashed manifest and explicit final approval immediately before any
  broadcast.
