# Stage 4 preparation validation

Validation date: 2026-07-25. No private key, seed phrase, keystore, or wallet
signer was loaded. No transaction was signed or broadcast.

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
- Owner selected the existing dedicated Rabby account at the unchanged deployer
  address for the capped canary. Signature-based address verification and the
  transaction-preview rehearsal remain incomplete.
- Owner reported that the secret-safe dual-provider RPC preflight passed on
  2026-07-25. Provider secrets and the transient JSON result were deliberately
  not committed.

## Validation results

- Stage 4 canonical manifest validation passed.
- Manifest negative tests passed for:
  - broadcast or mainnet approval enabled;
  - dependency-unsafe deployment order;
  - populated transaction address;
  - premature verification claim.
- Dual-RPC preflight tests passed for independent HTTPS providers and detection
  of chain, head, pending-nonce, and dependency-bytecode disagreement.
- The secret-safe fork-rehearsal helper completed against current Robinhood
  mainnet state without loading a signer or broadcasting.
- 69 contract tests passed; 2 fork tests were skipped in the normal gate.
- 8 deterministic rewards tests passed.
- 13 keeper-monitoring tests passed.
- 2 opt-in Robinhood mainnet-fork tests passed:
  - approved configuration non-broadcast deployment rehearsal;
  - canonical V3 launch and permanent-lock compatibility.
- Runtime bytecode remains within all frozen size budgets.
- GitHub Actions deployment preparation, Foundry, Slither/Aderyn, rewards, and
  keeper jobs passed for the wallet/rehearsal setup commit:
  `https://github.com/Qazza1/doom-launchpad/actions/runs/30154877910`.

## Still blocking deployment

- Independent review of the exact contract tag.
- Remediation and focused re-review of every resulting contract change.
- Rabby address verification by locally recovered control-message signature.
- Six-transaction Rabby preview rehearsal against localhost only.
- Fresh nonce, gas, gas-price, balance, and funding worksheet.
- Blockscout verification rehearsal.
- Completed, hashed manifest and explicit final approval immediately before any
  broadcast.
